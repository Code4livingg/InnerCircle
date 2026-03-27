import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { ExplorerRequestError } from "../services/aleoExplorerService.js";
import { verifyTipPayment, verifyTipProof } from "../services/proofVerificationService.js";
import { validateWalletSessionToken, type WalletSessionClaims } from "../services/walletSessionService.js";
import { ensureWalletRoleByHash } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const publicTipSchema = z.object({
  creatorHandle: z.string().min(3),
  amountMicrocredits: z.coerce.bigint().positive(),
  message: z.string().max(280).optional(),
  txId: z.string().min(10),
});

const anonymousTipSchema = z.object({
  creatorHandle: z.string().min(3),
  amountMicrocredits: z.coerce.bigint().positive(),
  message: z.string().max(280).optional(),
  txId: z.string().min(10),
});

const tipHistoryQuery = z.object({
  handle: z.string().min(3),
});

const tipLeaderboardQuery = z.object({
  handle: z.string().min(3),
});

const shortHash = (value: string): string => `${value.slice(0, 6)}...${value.slice(-4)}`;

const isPendingTxError = (error: unknown): boolean => {
  if (error instanceof ExplorerRequestError) {
    return error.status === 404 || error.status >= 500;
  }
  return /not accepted yet/i.test((error as Error).message ?? "");
};

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof (error as { code?: string })?.code === "string" &&
  (error as { code?: string }).code === "P2002";

const resolveOptionalWalletSession = (req: Request): WalletSessionClaims | null => {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  if (Array.isArray(header)) {
    throw new Error("Invalid wallet session token");
  }

  if (!header.startsWith("Bearer ")) {
    throw new Error("Invalid wallet session token");
  }

  return validateWalletSessionToken(header.slice("Bearer ".length));
};

export const createTip = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    let session: WalletSessionClaims | null = null;
    try {
      session = resolveOptionalWalletSession(req);
    } catch (error) {
      res.status(401).json({ error: (error as Error).message });
      return;
    }

    const payload = publicTipSchema.parse(req.body);

    const creator = await prisma.creator.findUnique({
      where: { handle: payload.creatorHandle.toLowerCase() },
      select: { id: true, handle: true, walletHash: true, walletAddress: true, creatorFieldId: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    if (!creator.walletAddress || !creator.walletAddress.startsWith("aleo1")) {
      res.status(400).json({ error: "Creator wallet address is missing." });
      return;
    }

    const verified = await verifyTipPayment({
      creatorFieldId: creator.creatorFieldId,
      purchaseTxId: payload.txId,
      expectedPriceMicrocredits: payload.amountMicrocredits,
      expectedRecipientAddress: creator.walletAddress,
      walletAddressHint: session?.addr,
    });

    if (session && verified.walletHash !== session.wh) {
      res.status(403).json({ error: "Tip transaction does not belong to the signed-in wallet." });
      return;
    }

    if (creator.walletHash === verified.walletHash) {
      res.status(409).json({ error: "Creators cannot tip themselves." });
      return;
    }

    await ensureWalletRoleByHash(verified.walletHash, "FAN");

    const tip = await prisma.tip.create({
      data: {
        creatorId: creator.id,
        txId: payload.txId,
        walletHash: verified.walletHash,
        amountMicrocredits: payload.amountMicrocredits,
        message: payload.message?.trim() || null,
        isAnonymous: false,
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
    if (isPendingTxError(error)) {
      res.status(409).json({ error: "Transaction is still pending on Aleo explorer. Wait and retry.", code: "TX_PENDING" });
      return;
    }
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "Tip transaction already recorded." });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const createAnonymousTip = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const payload = anonymousTipSchema.parse(req.body);

    const creator = await prisma.creator.findUnique({
      where: { handle: payload.creatorHandle.toLowerCase() },
      select: { id: true, handle: true, creatorFieldId: true, walletAddress: true, walletHash: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    if (!creator.walletAddress || !creator.walletAddress.startsWith("aleo1")) {
      res.status(400).json({ error: "Creator wallet address is missing." });
      return;
    }

    const verified = await verifyTipProof({
      creatorFieldId: creator.creatorFieldId,
      creatorAddress: creator.walletAddress,
      amountMicrocredits: payload.amountMicrocredits,
      txId: payload.txId,
    });

    if (creator.walletHash && creator.walletHash === verified.walletHash) {
      res.status(409).json({ error: "Creators cannot tip themselves." });
      return;
    }

    const tip = await prisma.tip.create({
      data: {
        creatorId: creator.id,
        txId: payload.txId,
        walletHash: verified.walletHash,
        amountMicrocredits: payload.amountMicrocredits,
        message: payload.message?.trim() || null,
        isAnonymous: true,
      },
    });

    res.json({
      tip: {
        id: tip.id,
        creatorHandle: creator.handle,
        amountMicrocredits: tip.amountMicrocredits.toString(),
        message: tip.message,
        isAnonymous: true,
        createdAt: tip.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    if (isPendingTxError(error)) {
      res.status(409).json({ error: "Transaction is still pending on Aleo explorer. Wait and retry.", code: "TX_PENDING" });
      return;
    }
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "Tip transaction already recorded." });
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
        // Keep the response shape stable, but stop exposing any identifier that
        // lets creators correlate repeated viewers across sessions.
        supporter: tip.isAnonymous ? "Anonymous" : "Supporter",
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
        // Rank-only output preserves dashboard functionality without exposing a
        // stable supporter fingerprint to creators.
        supporter: "Supporter",
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
