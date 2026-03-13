import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { ensureWalletRoleByHash } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const tipSchema = z.object({
  creatorHandle: z.string().min(3),
  amountMicrocredits: z.coerce.bigint().positive(),
  message: z.string().max(280).optional(),
  isAnonymous: z.coerce.boolean().optional().default(false),
});

const tipHistoryQuery = z.object({
  handle: z.string().min(3),
});

const tipLeaderboardQuery = z.object({
  handle: z.string().min(3),
});

const shortHash = (value: string): string => `${value.slice(0, 6)}…${value.slice(-4)}`;

export const createTip = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = tipSchema.parse(req.body);
    await ensureWalletRoleByHash(session.wh, "FAN");

    const creator = await prisma.creator.findUnique({
      where: { handle: payload.creatorHandle.toLowerCase() },
      select: { id: true, handle: true, walletHash: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    if (creator.walletHash === session.wh) {
      res.status(409).json({ error: "Creators cannot tip themselves." });
      return;
    }

    const tip = await prisma.tip.create({
      data: {
        creatorId: creator.id,
        walletHash: session.wh,
        amountMicrocredits: payload.amountMicrocredits,
        message: payload.message?.trim() || null,
        isAnonymous: payload.isAnonymous ?? false,
      },
    });

    res.json({
      tip: {
        id: tip.id,
        creatorHandle: creator.handle,
        amountMicrocredits: tip.amountMicrocredits.toString(),
        message: tip.message,
        isAnonymous: tip.isAnonymous,
        createdAt: tip.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const getCreatorTipHistory = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = tipHistoryQuery.parse(req.params);
    const creator = await prisma.creator.findUnique({
      where: { handle: payload.handle.toLowerCase() },
      select: { id: true, walletHash: true, handle: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    if (creator.walletHash !== session.wh) {
      res.status(403).json({ error: "Not authorized to view creator tips" });
      return;
    }

    const tips = await prisma.tip.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json({
      tips: tips.map((tip) => ({
        id: tip.id,
        amountMicrocredits: tip.amountMicrocredits.toString(),
        message: tip.message,
        isAnonymous: tip.isAnonymous,
        supporter: tip.isAnonymous ? "Anonymous" : shortHash(tip.walletHash),
        createdAt: tip.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const getTipHistoryForFan = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const tips = await prisma.tip.findMany({
      where: { walletHash: session.wh },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { creator: { select: { handle: true, displayName: true } } },
    });

    res.json({
      tips: tips.map((tip) => ({
        id: tip.id,
        creatorHandle: tip.creator.handle,
        creatorName: tip.creator.displayName ?? tip.creator.handle,
        amountMicrocredits: tip.amountMicrocredits.toString(),
        message: tip.message,
        isAnonymous: tip.isAnonymous,
        createdAt: tip.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const getTipLeaderboard = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const payload = tipLeaderboardQuery.parse(req.params);
    const creator = await prisma.creator.findUnique({
      where: { handle: payload.handle.toLowerCase() },
      select: { id: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const topSupporters = await prisma.tip.groupBy({
      by: ["walletHash"],
      where: { creatorId: creator.id, isAnonymous: false },
      _sum: { amountMicrocredits: true },
      _count: { _all: true },
      orderBy: { _sum: { amountMicrocredits: "desc" } },
      take: 10,
    });

    res.json({
      supporters: topSupporters.map((row) => ({
        supporter: shortHash(row.walletHash),
        tipCount: row._count._all,
        totalMicrocredits: (row._sum.amountMicrocredits ?? 0n).toString(),
      })),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};
