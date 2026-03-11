import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";
import { deleteMedia, uploadMedia } from "../services/mediaStorageService.js";
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

const readUploadedThumbnail = (req: Request): Express.Multer.File | undefined => {
  const files = req.files as
    | Express.Multer.File[]
    | {
      [fieldname: string]: Express.Multer.File[];
    }
    | undefined;

  if (!files || Array.isArray(files)) {
    return undefined;
  }

  return files.thumbnail?.[0];
};

export const uploadContent = async (req: Request, res: Response): Promise<void> => {
  let uploadedMediaKey: string | null = null;
  let uploadedThumbnailKey: string | null = null;

  try {
    const uploadedFile = readUploadedFile(req);
    if (!uploadedFile?.buffer) {
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

    uploadedMediaKey = await uploadMedia(
      uploadedFile.buffer,
      uploadedFile.originalname,
      uploadedFile.mimetype || "application/octet-stream",
      creator.id,
    );

    const thumbnail = readUploadedThumbnail(req);
    if (thumbnail?.buffer) {
      uploadedThumbnailKey = await uploadMedia(
        thumbnail.buffer,
        thumbnail.originalname,
        thumbnail.mimetype || "application/octet-stream",
        creator.id,
      );
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
        storageProvider: "S3",
        baseObjectKey: uploadedMediaKey,
        thumbObjectKey: uploadedThumbnailKey,
        mimeType: uploadedFile.mimetype,
        sizeBytes: BigInt(uploadedFile.size),
        chunkSizeBytes: 0,
        chunkCount: 1,
        wrappedKeyCiphertextB64: "",
        wrappedKeyIvB64: "",
        wrappedKeyAuthTagB64: "",
      },
    });

    res.json({
      content,
    });
  } catch (error) {
    if (uploadedMediaKey) {
      await deleteMedia(uploadedMediaKey).catch(() => undefined);
    }

    if (uploadedThumbnailKey) {
      await deleteMedia(uploadedThumbnailKey).catch(() => undefined);
    }

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
