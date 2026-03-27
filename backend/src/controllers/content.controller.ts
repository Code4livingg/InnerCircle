import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";
import { deleteMedia, uploadMedia } from "../services/mediaStorageService.js";
import { randomFieldLiteral } from "../utils/aleo.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { ensureWalletRoleByHash } from "../services/walletRoleService.js";

const accessTypeSchema = z
  .enum(["PUBLIC", "SUBSCRIPTION", "PPV", "public", "subscription", "ppv"])
  .transform((value) => value.toUpperCase() as "PUBLIC" | "SUBSCRIPTION" | "PPV");

const uploadSchema = z.object({
  walletAddress: z.string().min(10),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["VIDEO", "IMAGE", "AUDIO"]).default("VIDEO"),
  accessType: accessTypeSchema.optional().default("SUBSCRIPTION"),
  ppvPriceMicrocredits: z.coerce.bigint().nonnegative().optional().default(0n),
  subscriptionTierId: z.string().uuid().optional(),
  isPublished: z.coerce.boolean().optional().default(false),
  expiresAt: z.string().datetime().optional(),
  viewLimit: z.coerce.number().int().positive().optional(),
  encryptedData: z.string().optional(),
});

const updateSchema = z.object({
  subscriptionTierId: z.string().uuid().nullable().optional(),
  isPublished: z.coerce.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  viewLimit: z.coerce.number().int().positive().nullable().optional(),
  encryptedData: z.string().nullable().optional(),
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

export const uploadContent = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  let uploadedMediaKey: string | null = null;
  let uploadedThumbnailKey: string | null = null;

  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const uploadedFile = readUploadedFile(req);
    if (!uploadedFile?.buffer) {
      res.status(400).json({ error: "Missing file upload" });
      return;
    }

    const payload = uploadSchema.parse(req.body);
    const wh = walletHash(payload.walletAddress);
    if (wh !== session.wh) {
      res.status(403).json({ error: "Wallet session does not match the upload wallet address." });
      return;
    }
    const priceMicrocredits = payload.accessType === "PPV" ? payload.ppvPriceMicrocredits : 0n;

    if (payload.accessType === "PPV" && priceMicrocredits <= 0n) {
      res.status(400).json({ error: "PPV content must have a price greater than zero." });
      return;
    }

    await ensureWalletRoleByHash(session.wh, "CREATOR");

    const creator = await prisma.creator.findUnique({ where: { walletHash: wh } });
    if (!creator) {
      res.status(400).json({ error: "Creator not registered. Call /api/creators/register first." });
      return;
    }

    let subscriptionTierId: string | null = null;
    if (payload.subscriptionTierId) {
      if (payload.accessType !== "SUBSCRIPTION") {
        res.status(400).json({ error: "Subscription tiers can only be assigned to subscription content." });
        return;
      }

      const tier = await prisma.subscriptionTier.findUnique({
        where: { id: payload.subscriptionTierId },
        select: { id: true, creatorId: true },
      });
      if (!tier || tier.creatorId !== creator.id) {
        res.status(400).json({ error: "Invalid subscription tier for this creator." });
        return;
      }
      subscriptionTierId = tier.id;
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
        subscriptionTierId,
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
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        viewLimit: payload.viewLimit ?? null,
        views: 0,
        encryptedData: payload.encryptedData ?? null,
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
      encryptedData: true,
      expiresAt: true,
      viewLimit: true,
      views: true,
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
      subscriptionTier: {
        select: {
          id: true,
          tierName: true,
          priceMicrocredits: true,
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

export const updateContent = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = updateSchema.parse(req.body);
    const contentId = String(req.params.contentId ?? "").trim();
    if (!contentId) {
      res.status(400).json({ error: "Missing content id" });
      return;
    }

    const creator = await prisma.creator.findUnique({
      where: { walletHash: session.wh },
      select: { id: true },
    });
    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, creatorId: true },
    });
    if (!content || content.creatorId !== creator.id) {
      res.status(404).json({ error: "Content not found for this creator" });
      return;
    }

    let subscriptionTierId = payload.subscriptionTierId;
    if (subscriptionTierId) {
      const tier = await prisma.subscriptionTier.findUnique({
        where: { id: subscriptionTierId },
        select: { id: true, creatorId: true },
      });
      if (!tier || tier.creatorId !== creator.id) {
        res.status(400).json({ error: "Invalid subscription tier for this creator." });
        return;
      }
    }
    const updateData: {
      subscriptionTierId?: string | null;
      isPublished?: boolean;
      expiresAt?: Date | null;
      viewLimit?: number | null;
      encryptedData?: string | null;
    } = {};
    if ("subscriptionTierId" in payload) {
      updateData.subscriptionTierId = subscriptionTierId ?? null;
    }
    if (typeof payload.isPublished === "boolean") {
      updateData.isPublished = payload.isPublished;
    }
    if ("expiresAt" in payload) {
      updateData.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    }
    if ("viewLimit" in payload) {
      updateData.viewLimit = payload.viewLimit ?? null;
    }
    if ("encryptedData" in payload) {
      updateData.encryptedData = payload.encryptedData ?? null;
    }

    const updated = await prisma.content.update({
      where: { id: content.id },
      data: updateData,
      select: {
        id: true,
        subscriptionTierId: true,
        isPublished: true,
      },
    });

    res.json({ content: updated });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};
