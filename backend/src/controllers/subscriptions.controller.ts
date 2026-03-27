import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  ExplorerRequestError,
  extractFeePayerAddress,
  fetchExplorerTx,
  isExecuteTx,
} from "../services/aleoExplorerService.js";
import {
  verifyPpvPayment,
  verifyZKProof,
} from "../services/proofVerificationService.js";
import { storeNullifier, storePaymentProof } from "../services/proofStoreService.js";
import {
  ensureWalletRoleByHash,
  toClientRole,
  walletHashForAddress,
  WalletRoleConflictError,
} from "../services/walletRoleService.js";
import {
  approximateExpiryDateFromBlockHeights,
  getSubscriptionActiveUntil,
  tierFromPriceMicrocredits,
} from "../services/subscriptionService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";

const zkProofSchema = z.object({
  programId: z.string().min(3),
  transitionName: z.string().min(3),
  publicInputs: z.object({
    circleId: z.string().min(1),
    currentBlock: z.number().int().nonnegative().optional(),
    expiresAt: z.number().int().nonnegative(),
    tier: z.number().int().min(1),
  }),
  executionProof: z.string().min(10),
  verifyingKey: z.string().min(10).optional(),
  programSource: z.string().min(10).optional(),
});

const verifySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("subscription"),
    executionProof: zkProofSchema,
    nullifier: z.string().min(8),
    circleId: z.string().min(1),
    tierId: z.string().uuid().optional(),
    paymentTxId: z.string().min(10).optional(),
  }),
  z.object({
    kind: z.literal("ppv"),
    txId: z.string().min(10),
    contentId: z.string().min(1),
    walletAddressHint: z.string().min(10).optional(),
    paymentProof: z.string().min(8).optional(),
  }),
]);

const subscriptionStatusSchema = z.object({
  creatorHandle: z.string().min(3),
  walletAddress: z.string().regex(/^aleo1[0-9a-z]{20,}$/i, "walletAddress must be a valid Aleo address"),
});

const verifyByTxSchema = z.object({
  txId: z.string().min(10),
  circleId: z.string().min(1),
  nullifier: z.string().min(8).optional(),
  tierId: z.string().uuid().optional(),
  paymentTxId: z.string().min(10).optional(),
});

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

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");
const toStoredFieldLiteral = (value: string): string => {
  const normalized = normalizeFieldId(value);
  return `${normalized}field`;
};

const getSingleQueryParam = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = getSingleQueryParam(entry);
      if (normalized) return normalized;
    }
  }

  return undefined;
};

const stripVisibilitySuffix = (value: string): string => value.trim().replace(/\.(public|private)$/i, "");

const parseUnsignedLiteral = (value: string, suffix: "u8" | "u32"): number => {
  const normalized = stripVisibilitySuffix(value);
  const match = new RegExp(`^(\\d+)${suffix}$`, "i").exec(normalized);
  if (!match) {
    throw new Error(`Expected ${suffix} literal, received "${value}"`);
  }

  return Number.parseInt(match[1], 10);
};

const stringifyTransitionValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }
  return String(value ?? "");
};

const extractTransitionIoValues = (ioEntries: unknown[]): string[] =>
  ioEntries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return { type: "", value: stringifyTransitionValue(entry) };
      }

      const io = entry as { type?: unknown; value?: unknown };
      return {
        type: typeof io.type === "string" ? io.type : "",
        value: stringifyTransitionValue(io.value ?? entry),
      };
    })
    .filter((entry) => entry.type.toLowerCase().includes("public"))
    .map((entry) => entry.value);

const isWalletSessionSigner = (candidate: string | undefined, walletAddress: string): boolean =>
  typeof candidate === "string" && candidate.trim().toLowerCase() === walletAddress.trim().toLowerCase();

const computeSubscriptionFallbackNullifier = (
  ownerAddress: string,
  circleId: string,
  expiresAtBlock: number,
): string => sha256Hex(`${ownerAddress.trim().toLowerCase()}:${circleId.trim()}:${expiresAtBlock}`);

const normalizeMappingValue = (value: string): string => value.replace(/^"+|"+$/g, "").trim();

const parseLatestBlockHeightPayload = (value: unknown, depth = 0): number | undefined => {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    const match = trimmed.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseLatestBlockHeightPayload(item, depth + 1);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const parsed = parseLatestBlockHeightPayload(nested, depth + 1);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
};

const fetchExplorerLatestBlockHeight = async (): Promise<number> => {
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const response = await fetch(`${base}/${env.aleoNetwork}/block/height/latest`, {
    headers: { Accept: "application/json, text/plain" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExplorerRequestError(response.status, `Explorer latest block fetch failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
  const parsed = parseLatestBlockHeightPayload(payload);
  if (parsed === undefined) {
    throw new Error("Explorer returned an invalid latest block height.");
  }
  return parsed;
};

const extractSubscriptionKeyFromTx = (tx: unknown): string | undefined => {
  const serialized = JSON.stringify(tx);
  const labelled = /subscription_key[^0-9]*([0-9]+field)/i.exec(serialized);
  if (labelled?.[1]) return labelled[1];

  const future = /finalize_verify_subscription[^0-9]*([0-9]+field)/i.exec(serialized);
  return future?.[1];
};

const verifyPaymentTxForSubscriptionFallback = async (input: {
  paymentTxId?: string;
  creatorFieldId: string;
  creatorAddress: string;
  expectedPriceMicrocredits: bigint;
}): Promise<boolean> => {
  if (!input.paymentTxId || isUuidLike(input.paymentTxId) || !isOnChainAleoTxId(input.paymentTxId)) {
    return false;
  }

  const paymentTx = await fetchExplorerTx(input.paymentTxId);
  if (!isExecuteTx(paymentTx)) {
    return false;
  }

  const paymentTransition = paymentTx.execution.transitions.find(
    (entry) => entry.program === env.paymentProofProgramId && entry.function === "pay_and_subscribe_public",
  );
  if (!paymentTransition) {
    return false;
  }

  const paymentInputs = extractTransitionIoValues(paymentTransition.inputs);
  if (paymentInputs.length < 4) {
    return false;
  }

  const paidCircleId = normalizeFieldId(paymentInputs[0]);
  const paidAmount = stripVisibilitySuffix(paymentInputs[1]);
  const paidCreatorAddress = stripVisibilitySuffix(paymentInputs[3]);

  return (
    paidCircleId === normalizeFieldId(input.creatorFieldId) &&
    paidAmount === `${input.expectedPriceMicrocredits}u64` &&
    paidCreatorAddress.toLowerCase() === input.creatorAddress.trim().toLowerCase()
  );
};

const fetchActiveSubscriptionExpiryBlock = async (subscriptionKey: string): Promise<number | null> => {
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const url =
    `${base}/${env.aleoNetwork}/program/${env.paymentProofProgramId}/mapping/active_subscriptions/${subscriptionKey}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain" },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExplorerRequestError(response.status, `Explorer mapping fetch failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = normalizeMappingValue(await response.text());
  const match = payload.match(/(\d+)u32/i);
  return match ? Number.parseInt(match[1], 10) : null;
};

export const verifySubscriptionOrPpvPurchase = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const payload = verifySchema.parse(req.body);

    if (payload.kind === "subscription") {
      const walletSession = req.walletSession;
      if (!walletSession) {
        res.status(401).json({ error: "Missing wallet session token" });
        return;
      }

      const verified = await verifyZKProof(payload.executionProof);
      const requestedCircleId = normalizeFieldId(payload.circleId);
      if (verified.circleId !== requestedCircleId) {
        res.status(400).json({ error: "circleId does not match the verified proof." });
        return;
      }

      const creator = await prisma.creator.findUnique({
        where: { creatorFieldId: toStoredFieldLiteral(verified.circleId) },
      });

      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      let tierRecord: { id: string; tierName: string; priceMicrocredits: bigint; creatorId: string } | null = null;
      if (payload.tierId) {
        tierRecord = await prisma.subscriptionTier.findUnique({
          where: { id: payload.tierId },
          select: { id: true, tierName: true, priceMicrocredits: true, creatorId: true },
        });
        if (!tierRecord || tierRecord.creatorId !== creator.id) {
          res.status(404).json({ error: "Subscription tier not found" });
          return;
        }
      }

      const expectedTier = tierRecord ? tierFromPriceMicrocredits(tierRecord.priceMicrocredits) : undefined;
      if (expectedTier && verified.tier < expectedTier) {
        res.status(403).json({ error: "Verified subscription tier is below the requested creator tier." });
        return;
      }

      if (walletSession.wh === creator.walletHash) {
        res.status(409).json({
          error: "Creator wallets cannot subscribe. Use a separate fan wallet.",
          code: "ROLE_CONFLICT",
          existingRole: "creator",
          requestedRole: "user",
        });
        return;
      }

      await ensureWalletRoleByHash(walletSession.wh, "FAN");
      await storeNullifier(payload.nullifier, verified.circleId, verified.expiresAt.getTime());

      const analyticsTxId = payload.paymentTxId ?? `zk:${payload.nullifier}`;
      const analyticsPriceMicrocredits = tierRecord?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits;

      await prisma.$executeRaw`
        INSERT INTO "SubscriptionPurchase" (
          "id",
          "txId",
          "walletHash",
          "creatorId",
          "creatorFieldId",
          "subscriptionTierId",
          "priceMicrocredits",
          "verifiedAt",
          "expires_at",
          "createdAt"
        )
        VALUES (
          CAST(${randomUUID()} AS UUID),
          ${analyticsTxId},
          ${walletSession.wh},
          CAST(${creator.id} AS UUID),
          ${creator.creatorFieldId},
          ${tierRecord?.id ?? null},
          ${analyticsPriceMicrocredits},
          NOW(),
          ${verified.expiresAt},
          NOW()
        )
        ON CONFLICT ("txId")
        DO UPDATE SET
          "walletHash" = EXCLUDED."walletHash",
          "creatorId" = EXCLUDED."creatorId",
          "creatorFieldId" = EXCLUDED."creatorFieldId",
          "subscriptionTierId" = EXCLUDED."subscriptionTierId",
          "priceMicrocredits" = EXCLUDED."priceMicrocredits",
          "verifiedAt" = NOW(),
          "expires_at" = EXCLUDED."expires_at"
      `;

      const records = await prisma.$queryRaw<Array<{ txId: string; verifiedAt: Date; expires_at: Date | null }>>`
        SELECT "txId", "verifiedAt", "expires_at"
        FROM "SubscriptionPurchase"
        WHERE "txId" = ${analyticsTxId}
        LIMIT 1
      `;
      const record = records[0];
      if (!record) {
        throw new Error("Failed to persist subscription verification record");
      }

      res.json({
        success: true,
        ok: true,
        kind: "subscription",
        txId: record.txId,
        creatorHandle: creator.handle,
        creatorFieldId: creator.creatorFieldId,
        circleId: verified.circleId,
        priceMicrocredits: analyticsPriceMicrocredits.toString(),
        tierId: tierRecord?.id ?? null,
        tierName: tierRecord?.tierName ?? null,
        tier: verified.tier,
        verifiedAt: record.verifiedAt.toISOString(),
        expiresAt: (record.expires_at ?? verified.expiresAt).toISOString(),
      });
      return;
    }

    if (isUuidLike(payload.txId) || !isOnChainAleoTxId(payload.txId)) {
      res.status(409).json({
        error: "Wallet returned a temporary request ID. Wait for transaction finalization and retry with an on-chain tx id (at1...).",
        code: "TX_PENDING",
      });
      return;
    }

    const content = await prisma.content.findUnique({
      where: { id: payload.contentId },
      select: {
        id: true,
        contentFieldId: true,
        ppvPriceMicrocredits: true,
        creator: {
          select: {
            walletAddress: true,
          },
        },
      },
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const verified = await verifyPpvPayment({
      contentFieldId: content.contentFieldId,
      purchaseTxId: payload.txId,
      walletAddressHint: payload.walletAddressHint,
      expectedPriceMicrocredits: content.ppvPriceMicrocredits ?? 0n,
      expectedRecipientAddress: content.creator.walletAddress,
    });
    await ensureWalletRoleByHash(verified.walletHash, "FAN");

    const priceMicrocredits = content.ppvPriceMicrocredits ?? 0n;

    await prisma.$executeRaw`
      INSERT INTO "PpvPurchase" (
        "id",
        "txId",
        "walletHash",
        "contentId",
        "contentFieldId",
        "priceMicrocredits",
        "verifiedAt",
        "createdAt"
      )
      VALUES (
        CAST(${randomUUID()} AS UUID),
        ${payload.txId},
        ${verified.walletHash},
        CAST(${content.id} AS UUID),
        ${content.contentFieldId},
        ${priceMicrocredits},
        NOW(),
        NOW()
      )
      ON CONFLICT ("txId")
      DO UPDATE SET
        "walletHash" = EXCLUDED."walletHash",
        "contentId" = EXCLUDED."contentId",
        "contentFieldId" = EXCLUDED."contentFieldId",
        "priceMicrocredits" = EXCLUDED."priceMicrocredits",
        "verifiedAt" = NOW()
    `;

    const records = await prisma.$queryRaw<Array<{ txId: string; verifiedAt: Date }>>`
      SELECT "txId", "verifiedAt"
      FROM "PpvPurchase"
      WHERE "txId" = ${payload.txId}
      LIMIT 1
    `;
    const record = records[0];
    if (!record) {
      throw new Error("Failed to persist PPV verification record");
    }

    if (payload.paymentProof) {
      await storePaymentProof({ contentId: content.id, proof: payload.paymentProof, txHash: payload.txId });
    }

    res.json({
      ok: true,
      kind: payload.kind,
      txId: record.txId,
      contentId: content.id,
      contentFieldId: content.contentFieldId,
      priceMicrocredits: priceMicrocredits.toString(),
      verifiedAt: record.verifiedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof WalletRoleConflictError) {
      res.status(409).json({
        error: `This wallet is already locked as ${toClientRole(error.existingRole)}. Use a different wallet for ${toClientRole(error.requestedRole)} actions.`,
        code: "ROLE_CONFLICT",
        existingRole: toClientRole(error.existingRole),
        requestedRole: toClientRole(error.requestedRole),
      });
      return;
    }

    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
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

export const verifySubscriptionByTx = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const walletSession = req.walletSession;
    if (!walletSession) {
      res.status(401).json({ error: "Missing wallet session token" });
      return;
    }

    const payload = verifyByTxSchema.parse(req.body);
    if (isUuidLike(payload.txId) || !isOnChainAleoTxId(payload.txId)) {
      res.status(409).json({
        error: "Wallet returned a temporary request ID. Wait for transaction finalization and retry with an on-chain tx id (at1...).",
        code: "TX_PENDING",
      });
      return;
    }

    const tx = await fetchExplorerTx(payload.txId);
    if (!isExecuteTx(tx)) {
      res.status(400).json({ error: "Subscription fallback requires an execute transaction." });
      return;
    }

    const transition = tx.execution.transitions.find(
      (entry) => entry.program === env.paymentProofProgramId && entry.function === "verify_subscription",
    );
    if (!transition) {
      res.status(400).json({ error: `Transaction is not a ${env.paymentProofProgramId}/verify_subscription execution.` });
      return;
    }

    const feePayer = extractFeePayerAddress(tx);
    const signerMatchesSession =
      !feePayer ||
      (typeof walletSession.addr === "string" && isWalletSessionSigner(feePayer, walletSession.addr)) ||
      walletHashForAddress(feePayer) === walletSession.wh;

    const publicInputs = extractTransitionIoValues(transition.inputs);
    if (publicInputs.length < 2) {
      res.status(400).json({ error: "verify_subscription transaction did not expose the expected public inputs." });
      return;
    }

    const verifiedCircleId = normalizeFieldId(publicInputs[0]);
    const verifiedTier = parseUnsignedLiteral(publicInputs[1], "u8");
    const requestedCircleId = normalizeFieldId(payload.circleId);
    if (verifiedCircleId !== requestedCircleId) {
      res.status(400).json({ error: "circleId does not match the finalized verify_subscription transaction." });
      return;
    }

    const creator = await prisma.creator.findUnique({
      where: { creatorFieldId: toStoredFieldLiteral(verifiedCircleId) },
    });
    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    let tierRecord: { id: string; tierName: string; priceMicrocredits: bigint; creatorId: string } | null = null;
    if (payload.tierId) {
      tierRecord = await prisma.subscriptionTier.findUnique({
        where: { id: payload.tierId },
        select: { id: true, tierName: true, priceMicrocredits: true, creatorId: true },
      });
      if (!tierRecord || tierRecord.creatorId !== creator.id) {
        res.status(404).json({ error: "Subscription tier not found" });
        return;
      }
    }

    const expectedTier = tierRecord ? tierFromPriceMicrocredits(tierRecord.priceMicrocredits) : undefined;
    if (expectedTier && verifiedTier < expectedTier) {
      res.status(403).json({ error: "Verified subscription tier is below the requested creator tier." });
      return;
    }

    if (walletSession.wh === creator.walletHash) {
      res.status(409).json({
        error: "Creator wallets cannot subscribe. Use a separate fan wallet.",
        code: "ROLE_CONFLICT",
        existingRole: "creator",
        requestedRole: "user",
      });
      return;
    }

    await ensureWalletRoleByHash(walletSession.wh, "FAN");

    const subscriptionKey = extractSubscriptionKeyFromTx(tx);
    const latestBlockHeight = await fetchExplorerLatestBlockHeight();
    const expiryBlock = subscriptionKey ? await fetchActiveSubscriptionExpiryBlock(subscriptionKey) : null;
    if (expiryBlock !== null && expiryBlock <= latestBlockHeight) {
      res.status(409).json({ error: "Subscription invoice proof has expired." });
      return;
    }

    const expiresAt = expiryBlock !== null
      ? approximateExpiryDateFromBlockHeights(latestBlockHeight, expiryBlock)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const analyticsPriceMicrocredits = tierRecord?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits;
    const fallbackNullifierMatches =
      typeof payload.nullifier === "string" &&
      expiryBlock !== null &&
      typeof walletSession.addr === "string" &&
      computeSubscriptionFallbackNullifier(walletSession.addr, verifiedCircleId, expiryBlock) === payload.nullifier;
    const paymentTxMatchesFallback = await verifyPaymentTxForSubscriptionFallback({
      paymentTxId: payload.paymentTxId,
      creatorFieldId: creator.creatorFieldId,
      creatorAddress: creator.walletAddress,
      expectedPriceMicrocredits: analyticsPriceMicrocredits,
    });

    if (!signerMatchesSession && !fallbackNullifierMatches && !paymentTxMatchesFallback) {
      res.status(403).json({ error: "Finalized transaction signer does not match the active wallet session." });
      return;
    }

    if (payload.nullifier) {
      await storeNullifier(payload.nullifier, verifiedCircleId, expiresAt.getTime());
    }

    const analyticsTxId = payload.paymentTxId ?? payload.txId;

    await prisma.$executeRaw`
      INSERT INTO "SubscriptionPurchase" (
        "id",
        "txId",
        "walletHash",
        "creatorId",
        "creatorFieldId",
        "subscriptionTierId",
        "priceMicrocredits",
        "verifiedAt",
        "expires_at",
        "createdAt"
      )
      VALUES (
        CAST(${randomUUID()} AS UUID),
        ${analyticsTxId},
        ${walletSession.wh},
        CAST(${creator.id} AS UUID),
        ${creator.creatorFieldId},
        ${tierRecord?.id ?? null},
        ${analyticsPriceMicrocredits},
        NOW(),
        ${expiresAt},
        NOW()
      )
      ON CONFLICT ("txId")
      DO UPDATE SET
        "walletHash" = EXCLUDED."walletHash",
        "creatorId" = EXCLUDED."creatorId",
        "creatorFieldId" = EXCLUDED."creatorFieldId",
        "subscriptionTierId" = EXCLUDED."subscriptionTierId",
        "priceMicrocredits" = EXCLUDED."priceMicrocredits",
        "verifiedAt" = NOW(),
        "expires_at" = EXCLUDED."expires_at"
    `;

    res.json({
      verified: true,
      ok: true,
      txId: analyticsTxId,
      circleId: verifiedCircleId,
      tier: verifiedTier,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof WalletRoleConflictError) {
      res.status(409).json({
        error: `This wallet is already locked as ${toClientRole(error.existingRole)}. Use a different wallet for ${toClientRole(error.requestedRole)} actions.`,
        code: "ROLE_CONFLICT",
        existingRole: toClientRole(error.existingRole),
        requestedRole: toClientRole(error.requestedRole),
      });
      return;
    }

    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
      return;
    }

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues[0]?.message ?? "Invalid fallback verification payload.",
        code: "INVALID_QUERY",
        issues: error.issues,
      });
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

export const getSubscriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = subscriptionStatusSchema.parse({
      creatorHandle: getSingleQueryParam(req.query.creatorHandle),
      walletAddress: getSingleQueryParam(req.query.walletAddress),
    });
    const creator = await prisma.creator.findUnique({
      where: { handle: payload.creatorHandle.toLowerCase() },
      select: {
        id: true,
        handle: true,
        subscriptionPriceMicrocredits: true,
      },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const walletHash = walletHashForAddress(payload.walletAddress);
    const latestPurchase = await prisma.subscriptionPurchase.findFirst({
      where: {
        creatorId: creator.id,
        walletHash,
      },
      orderBy: { verifiedAt: "desc" },
      include: {
        subscriptionTier: {
          select: {
            id: true,
            tierName: true,
            priceMicrocredits: true,
          },
        },
      },
    });

    if (!latestPurchase) {
      res.json({
        ok: true,
        creatorHandle: creator.handle,
        active: false,
        txId: null,
        verifiedAt: null,
        activeUntil: null,
        priceMicrocredits: creator.subscriptionPriceMicrocredits.toString(),
        tierId: null,
        tierName: null,
        tierPriceMicrocredits: null,
      });
      return;
    }

    const activeUntil = getSubscriptionActiveUntil(latestPurchase.verifiedAt, latestPurchase.expiresAt ?? null);
    const tierPriceMicrocredits = latestPurchase.subscriptionTier?.priceMicrocredits ?? latestPurchase.priceMicrocredits;
    res.json({
      ok: true,
      creatorHandle: creator.handle,
      active: activeUntil.getTime() > Date.now(),
      txId: latestPurchase.txId,
      verifiedAt: latestPurchase.verifiedAt.toISOString(),
      activeUntil: activeUntil.toISOString(),
      priceMicrocredits: creator.subscriptionPriceMicrocredits.toString(),
      tierId: latestPurchase.subscriptionTier?.id ?? null,
      tierName: latestPurchase.subscriptionTier?.tierName ?? null,
      tierPriceMicrocredits: tierPriceMicrocredits.toString(),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
      return;
    }

    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Invalid subscription status query.",
        code: "INVALID_QUERY",
        issues: error.issues,
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const listMySubscriptions = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const walletSession = req.walletSession;
    if (!walletSession) {
      res.status(401).json({ error: "Missing wallet session token" });
      return;
    }

    const purchases = await prisma.subscriptionPurchase.findMany({
      where: {
        walletHash: walletSession.wh,
      },
      orderBy: { verifiedAt: "desc" },
      include: {
        creator: {
          select: {
            handle: true,
            displayName: true,
            avatarObjectKey: true,
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

    const seenCreators = new Set<string>();
    const subscriptions = purchases
      .filter((purchase) => {
        if (seenCreators.has(purchase.creatorId)) {
          return false;
        }
        seenCreators.add(purchase.creatorId);
        return true;
      })
      .map((purchase) => {
        const activeUntil = getSubscriptionActiveUntil(purchase.verifiedAt, purchase.expiresAt ?? null);
        const tierPriceMicrocredits = purchase.subscriptionTier?.priceMicrocredits ?? purchase.priceMicrocredits;
        return {
          txId: purchase.txId,
          creatorHandle: purchase.creator.handle,
          creatorDisplayName: purchase.creator.displayName,
          creatorAvatarObjectKey: purchase.creator.avatarObjectKey,
          creatorFieldId: purchase.creatorFieldId,
          active: activeUntil.getTime() > Date.now(),
          verifiedAt: purchase.verifiedAt.toISOString(),
          activeUntil: activeUntil.toISOString(),
          tierId: purchase.subscriptionTier?.id ?? null,
          tierName: purchase.subscriptionTier?.tierName ?? null,
          tierPriceMicrocredits: tierPriceMicrocredits.toString(),
          priceMicrocredits: purchase.priceMicrocredits.toString(),
        };
      });

    res.json({ subscriptions });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};
