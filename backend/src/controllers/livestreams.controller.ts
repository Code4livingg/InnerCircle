import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { createIvsChannel, endIvsChannel, getLiveStreamById, issuePlaybackToken, listLiveStreams } from "../services/ivsService.js";
import { ExplorerRequestError } from "../services/aleoExplorerService.js";
import { verifyPpvPayment } from "../services/proofVerificationService.js";
import { ensureWalletRoleByHash } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const createLiveStreamSchema = z.object({
  title: z.string().min(3).max(120),
  accessType: z.enum(["SUBSCRIPTION", "PPV"]).default("SUBSCRIPTION"),
  ppvPriceMicrocredits: z.coerce.bigint().nonnegative().optional(),
});

const tokenQuerySchema = z.object({
  durationSeconds: z.coerce.number().int().positive().max(env.ivsTokenTtlSeconds).optional(),
});

const verifyPurchaseSchema = z.object({
  txId: z.string().min(10),
  walletAddressHint: z.string().min(10).optional(),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const getActiveSubscriptionCutoff = (): Date => new Date(Date.now() - THIRTY_DAYS_MS);

const isUuidLike = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isOnChainAleoTxId = (value: string): boolean =>
  /^at1[0-9a-z]{20,}$/i.test(value.trim());

const isPendingTxError = (error: unknown): boolean => {
  if (error instanceof ExplorerRequestError) {
    return error.status === 404 || error.status >= 500;
  }

  return /not accepted yet/i.test((error as Error).message ?? "");
};

const getWalletSession = (req: WalletSessionRequest) => {
  if (!req.walletSession) {
    throw new Error("Missing wallet session.");
  }

  return req.walletSession;
};

const serializeLiveStream = <
  T extends {
    id: string;
    title: string;
    accessType: string;
    status: string;
    creatorId: string;
    ppvPriceMicrocredits: bigint | null;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
    creator: {
      handle: string;
      displayName: string | null;
      isVerified: boolean;
      walletAddress?: string | null;
      subscriptionPriceMicrocredits?: bigint | null;
    };
  },
>(liveStream: T) => ({
  id: liveStream.id,
  title: liveStream.title,
  accessType: liveStream.accessType,
  status: liveStream.status,
  creatorId: liveStream.creatorId,
  ppvPriceMicrocredits: liveStream.ppvPriceMicrocredits?.toString() ?? null,
  startedAt: liveStream.startedAt?.toISOString() ?? null,
  endedAt: liveStream.endedAt?.toISOString() ?? null,
  createdAt: liveStream.createdAt.toISOString(),
  creator: {
    handle: liveStream.creator.handle,
    displayName: liveStream.creator.displayName,
    isVerified: liveStream.creator.isVerified,
    walletAddress: liveStream.creator.walletAddress ?? null,
    subscriptionPriceMicrocredits: liveStream.creator.subscriptionPriceMicrocredits?.toString() ?? null,
  },
});

export const createLiveStream = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = getWalletSession(req);
    const payload = createLiveStreamSchema.parse(req.body);

    const creator = await prisma.creator.findUnique({
      where: { walletHash: session.wh },
      select: { id: true },
    });

    if (!creator) {
      res.status(403).json({ error: "Only registered creator wallets can start live streams." });
      return;
    }

    if (payload.accessType === "PPV" && (!payload.ppvPriceMicrocredits || payload.ppvPriceMicrocredits <= 0n)) {
      res.status(400).json({ error: "PPV live streams require a price greater than zero." });
      return;
    }

    const liveStream = await createIvsChannel({
      creatorId: creator.id,
      title: payload.title,
      accessType: payload.accessType,
      ppvPriceMicrocredits: payload.accessType === "PPV" ? payload.ppvPriceMicrocredits ?? 0n : null,
    });

    res.json(liveStream);
  } catch (error) {
    console.error("CreateLiveStream failed", error);

    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(500).json({ error: (error as Error).message || "Failed to create live stream" });
  }
};

export const listActiveLiveStreams = async (_req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const liveStreams = await listLiveStreams();
    res.json({
      liveStreams: liveStreams.map((liveStream) => serializeLiveStream(liveStream)),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const getActiveLiveStream = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const liveStream = await getLiveStreamById(req.params.id);
    if (!liveStream || liveStream.status !== "live") {
      res.status(404).json({ error: "Live stream not found." });
      return;
    }

    res.json({ liveStream: serializeLiveStream(liveStream) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const getLiveStreamPlaybackToken = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = getWalletSession(req);
    const query = tokenQuerySchema.parse(req.query);
    const liveStream = await getLiveStreamById(req.params.id);

    if (!liveStream || liveStream.status !== "live") {
      res.status(404).json({ error: "Live stream not found." });
      return;
    }

    let hasAccess = liveStream.creator.walletHash === session.wh;

    if (!hasAccess && liveStream.accessType === "SUBSCRIPTION") {
      const subscription = await prisma.subscriptionPurchase.findFirst({
        where: {
          creatorId: liveStream.creatorId,
          walletHash: session.wh,
          verifiedAt: {
            gte: getActiveSubscriptionCutoff(),
          },
        },
        orderBy: { verifiedAt: "desc" },
        select: { txId: true },
      });
      hasAccess = !!subscription;
    }

    if (!hasAccess && liveStream.accessType === "PPV") {
      const purchase = await prisma.liveStreamPurchase.findFirst({
        where: {
          liveStreamId: liveStream.id,
          walletHash: session.wh,
        },
        orderBy: { verifiedAt: "desc" },
        select: { txId: true },
      });
      hasAccess = !!purchase;
    }

    if (!hasAccess) {
      res.status(403).json({ error: "Wallet is not entitled to this live stream." });
      return;
    }

    const playback = await issuePlaybackToken(liveStream.id, session.wh, query.durationSeconds);
    res.json({
      url: `${playback.playbackUrl}${playback.playbackUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(playback.token)}`,
      expiresAt: playback.expiresAt,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const endLiveStream = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = getWalletSession(req);
    const liveStream = await prisma.liveStream.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        creator: {
          select: { walletHash: true },
        },
      },
    });

    if (!liveStream) {
      res.status(404).json({ error: "Live stream not found." });
      return;
    }

    if (liveStream.creator.walletHash !== session.wh) {
      res.status(403).json({ error: "You can only end your own live stream." });
      return;
    }

    await endIvsChannel(liveStream.id);
    res.json({ ok: true, liveStreamId: liveStream.id, status: "offline" });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const verifyLiveStreamPpvPurchase = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = getWalletSession(req);
    const payload = verifyPurchaseSchema.parse(req.body);

    if (isUuidLike(payload.txId) || !isOnChainAleoTxId(payload.txId)) {
      res.status(409).json({
        error: "Wallet returned a temporary request ID. Wait for finalization and retry with an on-chain tx id (at1...).",
        code: "TX_PENDING",
      });
      return;
    }

    const liveStream = await getLiveStreamById(req.params.id);
    if (!liveStream) {
      res.status(404).json({ error: "Live stream not found." });
      return;
    }

    if (liveStream.accessType !== "PPV") {
      res.status(400).json({ error: "This live stream is not PPV-gated." });
      return;
    }

    if (!liveStream.purchaseFieldId) {
      res.status(400).json({ error: "Live stream purchase field is missing." });
      return;
    }

    const priceMicrocredits = liveStream.ppvPriceMicrocredits ?? 0n;
    const verified = await verifyPpvPayment({
      contentFieldId: liveStream.purchaseFieldId,
      purchaseTxId: payload.txId,
      walletAddressHint: payload.walletAddressHint ?? session.addr,
      expectedPriceMicrocredits: priceMicrocredits,
      expectedRecipientAddress: liveStream.creator.walletAddress,
    });

    if (verified.walletHash !== session.wh) {
      res.status(403).json({ error: "Verified purchase does not belong to the signed-in wallet." });
      return;
    }

    if (verified.walletHash === liveStream.creator.walletHash) {
      res.status(409).json({
        error: "Creator wallets already own this live stream. Use a separate viewer wallet for PPV purchases.",
        code: "ROLE_CONFLICT",
        existingRole: "creator",
        requestedRole: "user",
      });
      return;
    }

    await ensureWalletRoleByHash(verified.walletHash, "FAN");

    await prisma.$executeRaw`
      INSERT INTO "LiveStreamPurchase" (
        "id",
        "txId",
        "walletHash",
        "liveStreamId",
        "purchaseFieldId",
        "priceMicrocredits",
        "verifiedAt",
        "createdAt"
      )
      VALUES (
        CAST(${randomUUID()} AS UUID),
        ${payload.txId},
        ${verified.walletHash},
        CAST(${liveStream.id} AS UUID),
        ${liveStream.purchaseFieldId},
        ${priceMicrocredits},
        NOW(),
        NOW()
      )
      ON CONFLICT ("txId")
      DO UPDATE SET
        "walletHash" = EXCLUDED."walletHash",
        "liveStreamId" = EXCLUDED."liveStreamId",
        "purchaseFieldId" = EXCLUDED."purchaseFieldId",
        "priceMicrocredits" = EXCLUDED."priceMicrocredits",
        "verifiedAt" = NOW()
    `;

    const record = await prisma.liveStreamPurchase.findUnique({
      where: { txId: payload.txId },
      select: {
        txId: true,
        verifiedAt: true,
      },
    });

    if (!record) {
      throw new Error("Failed to persist live-stream purchase verification.");
    }

    res.json({
      ok: true,
      txId: record.txId,
      liveStreamId: liveStream.id,
      purchaseFieldId: liveStream.purchaseFieldId,
      priceMicrocredits: priceMicrocredits.toString(),
      verifiedAt: record.verifiedAt.toISOString(),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    if (isPendingTxError(error)) {
      res.status(409).json({
        error: "Transaction is still pending on Aleo explorer. Wait for finalization and retry verification.",
        code: "TX_PENDING",
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};
