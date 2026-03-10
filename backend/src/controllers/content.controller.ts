import type { Request, Response } from "express";
import { z } from "zod";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";
import { ingestFileToEncryptedChunks } from "../services/contentIngestService.js";
import { objectStore } from "../services/objectStoreService.js";
import type { SessionRequest } from "../middleware/requireSession.js";
import { applyInvisibleWatermark, createWatermarkId } from "../services/watermarkService.js";
import { decryptBuffer, unwrapContentKey } from "../services/encryptionService.js";
import { randomFieldLiteral } from "../utils/aleo.js";

const uploadSchema = z.object({
  walletAddress: z.string().min(10),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["VIDEO", "IMAGE", "AUDIO"]).default("VIDEO"),
  accessType: z.enum(["PUBLIC", "SUBSCRIPTION", "PPV"]).optional().default("SUBSCRIPTION"),
  ppvPriceMicrocredits: z.coerce.bigint().nonnegative().optional().default(0n),
  isPublished: z.coerce.boolean().optional().default(false),
});

const walletHash = (address: string): string => sha256Hex(address.toLowerCase());

const readUploadedFile = (req: Request): Express.Multer.File | undefined => {
  if (req.file) {
    return req.file;
  }

  const files = req.files as
    | Express.Multer.File[]
    | {
      [fieldname: string]: Express.Multer.File[];
    }
    | undefined;

  if (!files) {
    return undefined;
  }

  if (Array.isArray(files)) {
    return files[0];
  }

  return files.file?.[0];
};

export const uploadContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const uploadedFile = readUploadedFile(req);
    if (!uploadedFile?.path) {
      res.status(400).json({ error: "Missing file upload" });
      return;
    }

    const payload = uploadSchema.parse(req.body);
    const wh = walletHash(payload.walletAddress);
    const priceMicrocredits = payload.accessType === "PPV" ? payload.ppvPriceMicrocredits : 0n;

    if (payload.accessType === "PPV" && priceMicrocredits <= 0n) {
      res.status(400).json({ error: "PPV content must have a price greater than zero." });
      return;
    }

    const creator = await prisma.creator.findUnique({ where: { walletHash: wh } });
    if (!creator) {
      res.status(400).json({ error: "Creator not registered. Call /api/creators/register first." });
      return;
    }

    const content = await prisma.content.create({
      data: {
        creatorId: creator.id,
        contentFieldId: randomFieldLiteral(),
        title: payload.title,
        description: payload.description,
        kind: payload.kind,
        accessType: payload.accessType,
        ppvPriceMicrocredits: priceMicrocredits,
        isPublished: payload.isPublished,
        storageProvider: "LOCAL",
        baseObjectKey: `content/${randomUUID()}`,
        mimeType: uploadedFile.mimetype,
        sizeBytes: 0,
        chunkSizeBytes: 0,
        chunkCount: 0,
        wrappedKeyCiphertextB64: "",
        wrappedKeyIvB64: "",
        wrappedKeyAuthTagB64: "",
      },
    });

    const ingest = await ingestFileToEncryptedChunks(uploadedFile.path, content.id);

    await prisma.$transaction([
      prisma.content.update({
        where: { id: content.id },
        data: {
          baseObjectKey: `content/${content.id}`,
          mimeType: uploadedFile.mimetype,
          sizeBytes: BigInt(ingest.sizeBytes),
          chunkSizeBytes: ingest.chunkSizeBytes,
          chunkCount: ingest.chunkCount,
          wrappedKeyCiphertextB64: ingest.wrappedContentKey.ciphertextB64,
          wrappedKeyIvB64: ingest.wrappedContentKey.ivB64,
          wrappedKeyAuthTagB64: ingest.wrappedContentKey.authTagB64,
        },
      }),
      prisma.contentChunk.createMany({
        data: ingest.chunks.map((c) => ({
          contentId: content.id,
          idx: c.idx,
          objectKey: c.objectKey,
          ivB64: c.ivB64,
          authTagB64: c.authTagB64,
          ciphertextSizeBytes: c.ciphertextSizeBytes,
        })),
      }),
    ]);

    await unlink(uploadedFile.path).catch(() => undefined);

    res.json({
      content: await prisma.content.findUnique({
        where: { id: content.id },
        select: {
          id: true,
          creatorId: true,
          title: true,
          description: true,
          kind: true,
          accessType: true,
          ppvPriceMicrocredits: true,
          isPublished: true,
          mimeType: true,
          sizeBytes: true,
          chunkSizeBytes: true,
          chunkCount: true,
          createdAt: true,
        },
      }),
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const getContent = async (req: Request, res: Response): Promise<void> => {
  const { contentId } = req.params;
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      contentFieldId: true,
      creatorId: true,
      title: true,
      description: true,
      kind: true,
      accessType: true,
      ppvPriceMicrocredits: true,
      isPublished: true,
      mimeType: true,
      sizeBytes: true,
      chunkSizeBytes: true,
      chunkCount: true,
      createdAt: true,
      creator: {
        select: {
          handle: true,
          displayName: true,
          creatorFieldId: true,
          walletAddress: true,
          subscriptionPriceMicrocredits: true,
          isVerified: true,
        },
      },
    },
  });

  if (!content) {
    res.status(404).json({ error: "Content not found" });
    return;
  }

  res.json({ content });
};

const parseRange = (
  rangeHeader: string | undefined,
  sizeBytes: number,
): { start: number; end: number; partial: boolean } => {
  if (!rangeHeader) {
    return { start: 0, end: sizeBytes - 1, partial: false };
  }
  const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
  if (!match) {
    return { start: 0, end: sizeBytes - 1, partial: false };
  }

  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : Math.min(sizeBytes - 1, start + 2_000_000);
  return {
    start: Number.isNaN(start) ? 0 : start,
    end: Number.isNaN(end) ? Math.min(sizeBytes - 1, start + 2_000_000) : Math.min(sizeBytes - 1, end),
    partial: true,
  };
};

const sendDecryptedContent = async ({
  contentId,
  content,
  req,
  res,
  watermarkMaterial,
}: {
  contentId: string;
  content: {
    mimeType: string;
    sizeBytes: bigint;
    chunkSizeBytes: number;
    wrappedKeyCiphertextB64: string;
    wrappedKeyIvB64: string;
    wrappedKeyAuthTagB64: string;
  };
  req: Request;
  res: Response;
  watermarkMaterial: string;
}): Promise<{ body: Buffer; watermarkId: string }> => {
  const sizeBytes = Number(content.sizeBytes);
  const range = parseRange(req.headers.range, sizeBytes);
  const { start, end, partial } = range;

  const chunkSize = content.chunkSizeBytes;
  const startChunk = Math.floor(start / chunkSize);
  const endChunk = Math.floor(end / chunkSize);
  const startOffset = start % chunkSize;
  const endOffset = end % chunkSize;

  const wrapped = {
    ciphertextB64: content.wrappedKeyCiphertextB64,
    ivB64: content.wrappedKeyIvB64,
    authTagB64: content.wrappedKeyAuthTagB64,
  };

  const contentKey = unwrapContentKey(wrapped);
  const plaintextParts: Buffer[] = [];

  for (let idx = startChunk; idx <= endChunk; idx += 1) {
    const chunkMeta = await prisma.contentChunk.findUnique({
      where: { contentId_idx: { contentId, idx } },
    });

    if (!chunkMeta) {
      throw new Error(`Missing chunk metadata idx=${idx}`);
    }

    const absPath = objectStore.getAbsolutePath(chunkMeta.objectKey);
    const ciphertext = await readFile(absPath);

    const plaintext = decryptBuffer(
      {
        ciphertext,
        iv: Buffer.from(chunkMeta.ivB64, "base64"),
        authTag: Buffer.from(chunkMeta.authTagB64, "base64"),
      },
      contentKey,
    );

    const sliceStart = idx === startChunk ? startOffset : 0;
    const sliceEnd = idx === endChunk ? endOffset + 1 : plaintext.length;
    plaintextParts.push(plaintext.subarray(sliceStart, sliceEnd));
  }

  const combined = Buffer.concat(plaintextParts);
  const watermarkId = createWatermarkId(watermarkMaterial, contentId, partial ? `${start}-${end}` : "full");
  const watermarked = applyInvisibleWatermark(combined, watermarkId);

  res.status(partial ? 206 : 200);
  res.setHeader("Content-Type", content.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", watermarked.length);
  res.setHeader("X-Watermark-Id", watermarkId);
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (partial) {
    res.setHeader("Content-Range", `bytes ${start}-${end}/${sizeBytes}`);
  }
  res.send(watermarked);
  return { body: watermarked, watermarkId };
};

export const streamContent = async (req: SessionRequest, res: Response): Promise<void> => {
  try {
    const { contentId } = req.params;
    const session = req.session;

    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        creator: {
          select: {
            handle: true,
          },
        },
        accessType: true,
        isPublished: true,
        mimeType: true,
        sizeBytes: true,
        chunkSizeBytes: true,
        chunkCount: true,
        wrappedKeyCiphertextB64: true,
        wrappedKeyIvB64: true,
        wrappedKeyAuthTagB64: true,
      },
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const canAccessWithSession =
      !!session &&
      ((session.scope.type === "ppv" && session.scope.contentId === contentId) ||
        (session.scope.type === "subscription" && session.scope.creatorId === content.creator.handle));

    if (!canAccessWithSession) {
      res.status(403).json({ error: "Invalid session scope" });
      return;
    }

    const streamed = await sendDecryptedContent({
      contentId: content.id,
      content,
      req,
      res,
      watermarkMaterial: session.wh,
    });

    await prisma.streamEvent.create({
      data: {
        walletHash: session.wh,
        contentId,
        sessionId: session.sid,
        watermarkId: streamed.watermarkId,
        bytesServed: BigInt(streamed.body.length),
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const streamPublicContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contentId } = req.params;
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        accessType: true,
        isPublished: true,
        mimeType: true,
        sizeBytes: true,
        chunkSizeBytes: true,
        wrappedKeyCiphertextB64: true,
        wrappedKeyIvB64: true,
        wrappedKeyAuthTagB64: true,
      },
    });

    if (!content || !content.isPublished) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    if (content.accessType !== "PUBLIC") {
      res.status(403).json({ error: "Public access is not enabled for this content" });
      return;
    }

    await sendDecryptedContent({
      contentId: content.id,
      content,
      req,
      res,
      watermarkMaterial: "public",
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
