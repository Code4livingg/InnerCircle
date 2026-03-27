import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";

const keySchema = z.object({
  publicKeyB64: z.string().min(16),
});

const commentSchema = z.object({
  ciphertextB64: z.string().min(8),
  nonceB64: z.string().min(8),
  senderPublicKeyB64: z.string().min(8),
  senderLabel: z.string().max(64).optional().nullable(),
});

export const registerCreatorKey = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = keySchema.parse(req.body);
    const creator = await prisma.creator.findUnique({
      where: { walletHash: session.wh },
      select: { id: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    await prisma.creatorMessagingKey.upsert({
      where: { creatorId: creator.id },
      update: { publicKeyB64: payload.publicKeyB64 },
      create: { creatorId: creator.id, publicKeyB64: payload.publicKeyB64 },
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const getCreatorKey = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const creatorId = String(req.params.creatorId ?? "").trim();
    if (!creatorId) {
      res.status(400).json({ error: "Missing creator id" });
      return;
    }

    const key = await prisma.creatorMessagingKey.findUnique({
      where: { creatorId },
      select: { publicKeyB64: true },
    });

    if (!key) {
      res.status(404).json({ error: "Creator messaging key not found" });
      return;
    }

    res.json({ publicKeyB64: key.publicKeyB64 });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const postPrivateComment = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const liveStreamId = String(req.params.liveStreamId ?? "").trim();
    if (!liveStreamId) {
      res.status(400).json({ error: "Missing live stream id" });
      return;
    }

    const payload = commentSchema.parse(req.body);
    const liveStream = await prisma.liveStream.findUnique({
      where: { id: liveStreamId },
      select: { id: true, creatorId: true },
    });

    if (!liveStream) {
      res.status(404).json({ error: "Live stream not found" });
      return;
    }

    await prisma.liveComment.create({
      data: {
        liveStreamId: liveStream.id,
        creatorId: liveStream.creatorId,
        ciphertextB64: payload.ciphertextB64,
        nonceB64: payload.nonceB64,
        senderPublicKeyB64: payload.senderPublicKeyB64,
        senderLabel: payload.senderLabel ?? null,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const listPrivateComments = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const liveStreamId = String(req.params.liveStreamId ?? "").trim();
    if (!liveStreamId) {
      res.status(400).json({ error: "Missing live stream id" });
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

    const liveStream = await prisma.liveStream.findUnique({
      where: { id: liveStreamId },
      select: { creatorId: true },
    });

    if (!liveStream || liveStream.creatorId !== creator.id) {
      res.status(403).json({ error: "Not authorized to view comments for this stream" });
      return;
    }

    const sinceRaw = String(req.query.since ?? "").trim();
    const since = sinceRaw ? new Date(sinceRaw) : null;

    const comments = await prisma.liveComment.findMany({
      where: {
        liveStreamId,
        ...(since && !Number.isNaN(since.getTime()) ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    res.json({
      comments: comments.map((comment) => ({
        id: comment.id,
        ciphertextB64: comment.ciphertextB64,
        nonceB64: comment.nonceB64,
        senderPublicKeyB64: comment.senderPublicKeyB64,
        senderLabel: comment.senderLabel,
        createdAt: comment.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};
