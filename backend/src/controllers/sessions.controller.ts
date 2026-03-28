import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { createFingerprintSession } from "../services/fingerprintSessionService.js";
import { createSessionToken, validateSessionToken } from "../services/sessionService.js";
import { ExplorerRequestError } from "../services/aleoExplorerService.js";
import {
  verifyContentAccessProof,
  verifySubscriptionProof,
  verifyPpvPayment,
  verifySubscriptionPayment,
  verifyAccessPassPayment,
  verifyAccessPassProof,
  verifyZKProof,
} from "../services/proofVerificationService.js";
import {
  getNullifierStatus,
  verifyMembershipProof,
  verifyPaymentProof,
} from "../services/proofStoreService.js";
import {
  AnonymousSessionExpiredError,
  AnonymousSessionNotFoundError,
  normalizeAnonymousSessionId,
  resolveActiveAnonSession,
  type ActiveAnonSession,
} from "../services/anonymousSessionService.js";
import { ensureWalletRoleByHash, toClientRole, WalletRoleConflictError } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";
import { walletHashForAddress } from "../services/walletRoleService.js";
import {
  approximateExpiryDateFromBlockHeights,
  getSubscriptionActiveUntil,
  tierFromPriceMicrocredits,
} from "../services/subscriptionService.js";
import { ensureNotSelfDestructed, incrementViewsAndMaybeDelete } from "../services/selfDestructService.js";
import type { AnonOrWalletRequest } from "../middleware/requireAnonOrWallet.js";

const proofSchema = z.union([
  z.string().min(10),
  z.object({
    txId: z.string().min(10),
    programId: z.string().min(3).optional(),
    functionName: z.string().min(3).optional(),
  }),
]);

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

const sessionSchema = z.discriminatedUnion("mode", [
  // Original proof-based modes (kept for backward compat)
  z.object({
    mode: z.literal("subscription"),
    creatorHandle: z.string().min(3),
    proofTxId: z.string().min(10).optional(),
    proof: proofSchema.optional(),
    walletAddressHint: z.string().min(10).optional(),
  }),
  z.object({
    mode: z.literal("ppv"),
    contentId: z.string().min(1),
    proofTxId: z.string().min(10).optional(),
    proof: proofSchema.optional(),
    walletAddressHint: z.string().min(10).optional(),
  }),
  z.object({
    mode: z.literal("access-pass"),
    contentId: z.string().min(1),
    proofTxId: z.string().min(10).optional(),
    proof: proofSchema.optional(),
    walletAddressHint: z.string().min(10).optional(),
  }),
  // Hash-based mock ZK proof modes
  z.object({
    mode: z.literal("subscription-proof"),
    creatorHandle: z.string().min(3),
    proof: z.string().min(8),
  }),
  z.object({
    mode: z.literal("ppv-proof"),
    contentId: z.string().min(1),
    proof: z.string().min(8),
  }),
  z.object({
    mode: z.literal("subscription-zk"),
    circleId: z.string().min(1),
    nullifier: z.string().min(8),
    executionProof: zkProofSchema,
  }),
  // Direct purchase-tx modes — no separate prove_ call needed
  z.object({
    mode: z.literal("subscription-anon"),
    creatorHandle: z.string().min(3),
  }),
  z.object({
    mode: z.literal("subscription-direct"),
    creatorHandle: z.string().min(3),
    purchaseTxId: z.string().min(10),
    walletAddressHint: z.string().min(10).optional(),
    tierId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal("ppv-direct"),
    contentId: z.string().min(1),
    purchaseTxId: z.string().min(10),
    walletAddressHint: z.string().min(10).optional(),
  }),
  z.object({
    mode: z.literal("access-pass-direct"),
    contentId: z.string().min(1),
    purchaseTxId: z.string().min(10),
    walletAddressHint: z.string().min(10).optional(),
  }),
]);

const startFingerprintSessionSchema = z.object({
  contentId: z.string().min(1),
  // Keep the old field optional so older clients can continue posting it, but
  // new anonymous-viewing flows no longer need to send the raw wallet address.
  walletAddress: z.string().min(10).optional(),
  sessionToken: z.string().min(20),
});

const extractProofTxId = (payload: { proofTxId?: string; proof?: z.infer<typeof proofSchema> }): string | undefined => {
  if (payload.proofTxId) return payload.proofTxId;
  if (!payload.proof) return undefined;
  if (typeof payload.proof === "string") return payload.proof;
  return payload.proof.txId;
};

const extractProofFunctionName = (payload: { proof?: z.infer<typeof proofSchema> }): string | undefined => {
  if (!payload.proof || typeof payload.proof === "string") return undefined;
  return payload.proof.functionName;
};

const isOnChainAleoTxId = (value: string): boolean =>
  /^at1[0-9a-z]{20,}$/i.test(value.trim());

const isPendingTxError = (error: unknown): boolean => {
  if (error instanceof ExplorerRequestError) {
    return error.status === 404 || error.status >= 500;
  }

  return /not accepted yet/i.test((error as Error).message ?? "");
};

const canAccessContentWithSession = (
  session: ReturnType<typeof validateSessionToken>,
  contentId: string,
  creatorHandle: string,
): boolean => {
  if (session.scope.type === "ppv") {
    return session.scope.contentId === contentId;
  }

  return session.scope.creatorId === creatorHandle;
};

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");
const toStoredFieldLiteral = (value: string): string => `${normalizeFieldId(value)}field`;

const issueAnonymousSubscriptionSession = (
  anonSession: ActiveAnonSession,
  creatorHandle: string,
  currentBlock: number,
  verifiedBy: "payment" | "zk-proof",
) =>
  createSessionToken({
    identitySeed: `anon:${anonSession.sessionId}`,
    anonymousSessionId: anonSession.sessionId,
    scope: {
      type: "subscription",
      creatorId: creatorHandle,
      verifiedBy,
      tier: anonSession.tier,
      expiresAt: approximateExpiryDateFromBlockHeights(currentBlock, anonSession.expiresAtBlock).getTime(),
      entitlementBound: true,
    },
  });

export const createAccessSession = async (req: AnonOrWalletRequest, res: Response): Promise<void> => {
  try {
    const payload = sessionSchema.parse(req.body);

    if (payload.mode === "subscription-anon") {
      const anonSessionId = normalizeAnonymousSessionId(req.header("X-Anonymous-Session"));
      if (!anonSessionId) {
        res.status(401).json({ error: "Missing anonymous session" });
        return;
      }

      const { session: anonSession, currentBlock } = await resolveActiveAnonSession(anonSessionId);
      const creator = await prisma.creator.findUnique({
        where: { handle: payload.creatorHandle.toLowerCase() },
        select: { handle: true, creatorFieldId: true },
      });
      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      if (normalizeFieldId(anonSession.circleId) !== normalizeFieldId(creator.creatorFieldId)) {
        res.status(403).json({ error: "Anonymous session does not match this creator circle." });
        return;
      }

      const session = issueAnonymousSubscriptionSession(anonSession, creator.handle, currentBlock, "payment");
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    if (payload.mode === "subscription-zk") {
      const walletSession = req.walletSession;
      const anonSessionId = normalizeAnonymousSessionId(req.header("X-Anonymous-Session"));
      const anonResolution = !walletSession && anonSessionId
        ? await resolveActiveAnonSession(anonSessionId)
        : null;
      if (!walletSession && !anonResolution) {
        res.status(401).json({ error: "Missing wallet session token or anonymous session" });
        return;
      }

      const verified = await verifyZKProof(payload.executionProof);
      const requestedCircleId = normalizeFieldId(payload.circleId);
      if (verified.circleId !== requestedCircleId) {
        res.status(400).json({ error: "circleId does not match the verified proof." });
        return;
      }

      const status = await getNullifierStatus(payload.nullifier);
      if (!status.exists) {
        res.status(403).json({ error: "Subscription invoice nullifier is not registered." });
        return;
      }

      if (!status.usable) {
        res.status(409).json({ error: "Subscription invoice proof has expired." });
        return;
      }

      if (status.circleId !== verified.circleId) {
        res.status(400).json({ error: "Stored nullifier circle does not match the verified proof." });
        return;
      }

      const creator = await prisma.creator.findUnique({
        where: { creatorFieldId: toStoredFieldLiteral(verified.circleId) },
        select: { handle: true, walletHash: true },
      });
      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      if (anonResolution) {
        if (normalizeFieldId(anonResolution.session.circleId) !== verified.circleId) {
          res.status(403).json({ error: "Anonymous session does not match the verified creator circle." });
          return;
        }

        if (anonResolution.session.tier < verified.tier) {
          res.status(403).json({ error: "Anonymous session tier is too low for this proof." });
          return;
        }

        if (anonResolution.session.expiresAtBlock !== verified.expiresAtBlock) {
          res.status(403).json({ error: "Anonymous session expiry does not match the verified proof." });
          return;
        }

        const session = issueAnonymousSubscriptionSession(
          anonResolution.session,
          creator.handle,
          Math.max(anonResolution.currentBlock, verified.currentBlock),
          "zk-proof",
        );
        res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
        return;
      }

      if (!walletSession) {
        res.status(401).json({ error: "Missing wallet session token" });
        return;
      }

      if (walletSession.wh === creator.walletHash) {
        res.status(409).json({
          error: "Creator wallets cannot open fan subscription sessions.",
          code: "ROLE_CONFLICT",
          existingRole: "creator",
          requestedRole: "user",
        });
        return;
      }

      await ensureWalletRoleByHash(walletSession.wh, "FAN");

      const session = createSessionToken({
        identitySeed: walletSession.wh,
        scope: {
          type: "subscription",
          creatorId: creator.handle,
          verifiedBy: "zk-proof",
          tier: verified.tier,
          expiresAt: verified.expiresAt.getTime(),
          entitlementBound: true,
        },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    if (payload.mode === "subscription-proof") {
      const creator = await prisma.creator.findUnique({
        where: { handle: payload.creatorHandle.toLowerCase() },
        select: { id: true, handle: true },
      });

      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      const valid = await verifyMembershipProof(payload.proof, creator.id);
      if (!valid) {
        res.status(403).json({ error: "Invalid membership proof." });
        return;
      }

      const proofHash = walletHashForAddress(payload.proof);
      const session = createSessionToken({
        identitySeed: proofHash,
        scope: { type: "subscription", creatorId: creator.handle, verifiedBy: "proof" },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    if (payload.mode === "ppv-proof") {
      const content = await prisma.content.findUnique({
        where: { id: payload.contentId },
        select: { id: true, creator: { select: { handle: true } }, expiresAt: true, viewLimit: true, views: true },
      });

      if (!content) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      await ensureNotSelfDestructed(content.id, {
        expiresAt: content.expiresAt ?? null,
        viewLimit: content.viewLimit ?? null,
        views: content.views ?? 0,
      });

      const valid = await verifyPaymentProof(payload.proof, content.id);
      if (!valid) {
        res.status(403).json({ error: "Invalid payment proof." });
        return;
      }

      const proofHash = walletHashForAddress(payload.proof);
      const session = createSessionToken({
        identitySeed: proofHash,
        scope: { type: "ppv", contentId: content.id, verifiedBy: "proof" },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    // ── subscription-direct: session from subscribe tx, no prove_subscription needed ──
    if (payload.mode === "subscription-direct") {
      if (!isOnChainAleoTxId(payload.purchaseTxId)) {
        res.status(409).json({ error: "Purchase tx not finalized yet.", code: "TX_PENDING" });
        return;
      }

      const creator = await prisma.creator.findUnique({
        where: { handle: payload.creatorHandle.toLowerCase() },
        select: {
          id: true,
          handle: true,
          creatorFieldId: true,
          walletAddress: true,
          walletHash: true,
          subscriptionPriceMicrocredits: true,
        },
      });
      if (!creator) { res.status(404).json({ error: "Creator not found" }); return; }

      let tierRecord: { id: string; priceMicrocredits: bigint; creatorId: string } | null = null;
      if (payload.tierId) {
        tierRecord = await prisma.subscriptionTier.findUnique({
          where: { id: payload.tierId },
          select: { id: true, priceMicrocredits: true, creatorId: true },
        });
        if (!tierRecord || tierRecord.creatorId !== creator.id) {
          res.status(404).json({ error: "Subscription tier not found" });
          return;
        }
      }

      const expectedPriceMicrocredits = tierRecord?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits;

      const verified = await verifySubscriptionPayment({
        creatorFieldId: creator.creatorFieldId,
        purchaseTxId: payload.purchaseTxId,
        walletAddressHint: payload.walletAddressHint,
        expectedPriceMicrocredits,
        expectedRecipientAddress: creator.walletAddress,
      });

      if (verified.walletHash === creator.walletHash) {
        res.status(409).json({ error: "Creator wallets cannot open fan subscription sessions.", code: "ROLE_CONFLICT", existingRole: "creator", requestedRole: "user" });
        return;
      }
      await ensureWalletRoleByHash(verified.walletHash, "FAN");

      const purchase = await prisma.subscriptionPurchase.findFirst({
        where: {
          txId: payload.purchaseTxId,
          walletHash: verified.walletHash,
          creatorId: creator.id,
        },
        select: {
          verifiedAt: true,
          expiresAt: true,
          subscriptionTierId: true,
        },
      });
      if (!purchase) {
        res.status(409).json({ error: "Subscription payment has not been verified yet.", code: "TX_PENDING" });
        return;
      }

      if (payload.tierId && purchase.subscriptionTierId !== payload.tierId) {
        res.status(409).json({ error: "Subscription tier does not match verified purchase.", code: "TIER_MISMATCH" });
        return;
      }

      if (getSubscriptionActiveUntil(purchase.verifiedAt, purchase.expiresAt ?? null).getTime() <= Date.now()) {
        res.status(409).json({ error: "Subscription expired. Purchase again to continue.", code: "SUBSCRIPTION_EXPIRED" });
        return;
      }

      const session = createSessionToken({
        identitySeed: verified.walletHash,
        scope: {
          type: "subscription",
          creatorId: creator.handle,
          verifiedBy: "payment",
          tier: tierFromPriceMicrocredits(expectedPriceMicrocredits),
          expiresAt: getSubscriptionActiveUntil(purchase.verifiedAt, purchase.expiresAt ?? null).getTime(),
          entitlementBound: true,
        },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    // ── ppv-direct: session from buy_content tx, no prove_content_access needed ──
    if (payload.mode === "ppv-direct") {
      if (!isOnChainAleoTxId(payload.purchaseTxId)) {
        res.status(409).json({ error: "Purchase tx not finalized yet.", code: "TX_PENDING" });
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
      if (!content) { res.status(404).json({ error: "Content not found" }); return; }

      const verified = await verifyPpvPayment({
        contentFieldId: content.contentFieldId,
        purchaseTxId: payload.purchaseTxId,
        walletAddressHint: payload.walletAddressHint,
        expectedPriceMicrocredits: content.ppvPriceMicrocredits ?? 0n,
        expectedRecipientAddress: content.creator.walletAddress,
      });
      await ensureWalletRoleByHash(verified.walletHash, "FAN");

      const purchase = await prisma.ppvPurchase.findFirst({
        where: {
          txId: payload.purchaseTxId,
          walletHash: verified.walletHash,
          contentId: content.id,
        },
        select: {
          txId: true,
        },
      });
      if (!purchase) {
        res.status(409).json({ error: "PPV payment has not been verified yet.", code: "TX_PENDING" });
        return;
      }

      const session = createSessionToken({
        identitySeed: verified.walletHash,
        scope: { type: "ppv", contentId: content.id, verifiedBy: "payment" },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    if (payload.mode === "access-pass-direct") {
      if (!isOnChainAleoTxId(payload.purchaseTxId)) {
        res.status(409).json({ error: "Purchase tx not finalized yet.", code: "TX_PENDING" });
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
              creatorFieldId: true,
              walletAddress: true,
              walletHash: true,
            },
          },
        },
      });
      if (!content) { res.status(404).json({ error: "Content not found" }); return; }

      const verified = await verifyAccessPassPayment({
        creatorFieldId: content.creator.creatorFieldId,
        contentFieldId: content.contentFieldId,
        purchaseTxId: payload.purchaseTxId,
        walletAddressHint: payload.walletAddressHint,
        expectedPriceMicrocredits: content.ppvPriceMicrocredits ?? undefined,
        expectedRecipientAddress: content.creator.walletAddress,
      });

      if (verified.walletHash === content.creator.walletHash) {
        res.status(409).json({ error: "Creator wallets cannot open fan access sessions.", code: "ROLE_CONFLICT", existingRole: "creator", requestedRole: "user" });
        return;
      }

      await ensureWalletRoleByHash(verified.walletHash, "FAN");
      const session = createSessionToken({
        identitySeed: verified.walletHash,
        scope: { type: "ppv", contentId: content.id, verifiedBy: "payment" },
      });
      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    // ── Legacy proof-based modes ──────────────────────────────────────────────
    const proofTxId = extractProofTxId(payload as { proofTxId?: string; proof?: z.infer<typeof proofSchema> });
    const proofFunctionName = extractProofFunctionName(payload as { proof?: z.infer<typeof proofSchema> });

    if (!proofTxId) {
      res.status(400).json({ error: "Missing proofTxId (or proof.txId)." });
      return;
    }

    if (!isOnChainAleoTxId(proofTxId)) {
      res.status(409).json({
        error: "Proof transaction is not finalized yet. Provide an on-chain tx id (at1...).",
        code: "TX_PENDING",
      });
      return;
    }

    if (payload.mode === "subscription") {
      const creator = await prisma.creator.findUnique({
        where: { handle: payload.creatorHandle.toLowerCase() },
        select: { handle: true, creatorFieldId: true, walletHash: true },
      });

      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      const verified = await verifySubscriptionProof({
        creatorFieldId: creator.creatorFieldId,
        proveTxId: proofTxId,
        functionName: proofFunctionName,
        walletAddressHint: payload.walletAddressHint,
      });

      if (verified.walletHash === creator.walletHash) {
        res.status(409).json({
          error: "Creator wallets cannot open fan subscription sessions.",
          code: "ROLE_CONFLICT",
          existingRole: "creator",
          requestedRole: "user",
        });
        return;
      }
      await ensureWalletRoleByHash(verified.walletHash, "FAN");

      const session = createSessionToken({
        identitySeed: verified.walletHash,
        scope: { type: "subscription", creatorId: creator.handle, verifiedBy: "proof" },
      });

      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    if (payload.mode === "access-pass") {
      const content = await prisma.content.findUnique({
        where: { id: payload.contentId },
        select: {
          id: true,
          contentFieldId: true,
          creator: {
            select: {
              creatorFieldId: true,
              walletHash: true,
            },
          },
        },
      });

      if (!content) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      const verified = await verifyAccessPassProof({
        creatorFieldId: content.creator.creatorFieldId,
        contentFieldId: content.contentFieldId,
        proveTxId: proofTxId,
        walletAddressHint: payload.walletAddressHint,
      });

      if (verified.walletHash === content.creator.walletHash) {
        res.status(409).json({
          error: "Creator wallets cannot open fan access sessions.",
          code: "ROLE_CONFLICT",
          existingRole: "creator",
          requestedRole: "user",
        });
        return;
      }

      await ensureWalletRoleByHash(verified.walletHash, "FAN");

      const session = createSessionToken({
        identitySeed: verified.walletHash,
        scope: { type: "ppv", contentId: content.id, verifiedBy: "proof" },
      });

      res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
      return;
    }

    const content = await prisma.content.findUnique({
      where: { id: payload.contentId },
      select: { id: true, contentFieldId: true },
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const verified = await verifyContentAccessProof({
      contentFieldId: content.contentFieldId,
      proveTxId: proofTxId,
      walletAddressHint: payload.walletAddressHint,
    });
    await ensureWalletRoleByHash(verified.walletHash, "FAN");

    const session = createSessionToken({
      identitySeed: verified.walletHash,
      scope: { type: "ppv", contentId: content.id, verifiedBy: "proof" },
    });

    res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
  } catch (error) {
    if (error instanceof AnonymousSessionNotFoundError) {
      res.status(401).json({ error: "Anonymous session not found" });
      return;
    }

    if (error instanceof AnonymousSessionExpiredError) {
      res.status(401).json({ error: "Anonymous session expired" });
      return;
    }

    if (error instanceof ExplorerRequestError && /block height/i.test(error.message)) {
      res.status(502).json({ error: "Failed to verify Aleo block height" });
      return;
    }

    if (isPendingTxError(error)) {
      res.status(409).json({ error: (error as Error).message, code: "TX_PENDING" });
      return;
    }

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
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    if (/expired|view limit/i.test((error as Error).message ?? "")) {
      res.status(410).json({ error: (error as Error).message });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const startFingerprintSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = startFingerprintSessionSchema.parse(req.body);
    const session = validateSessionToken(payload.sessionToken);
    const sessionSubject = session.aid ? `anon:${session.aid}` : (session.ssh ?? session.wh);

    const content = await prisma.content.findUnique({
      where: { id: payload.contentId },
      select: {
        id: true,
        expiresAt: true,
        viewLimit: true,
        views: true,
        creator: {
          select: {
            handle: true,
          },
        },
      },
    });

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    if (!canAccessContentWithSession(session, content.id, content.creator.handle)) {
      res.status(403).json({ error: "Session scope does not allow fingerprinting this content." });
      return;
    }

    await ensureNotSelfDestructed(content.id, {
      expiresAt: content.expiresAt ?? null,
      viewLimit: content.viewLimit ?? null,
      views: content.views ?? 0,
    });

    await incrementViewsAndMaybeDelete(content.id);

    const fingerprintSession = createFingerprintSession({
      sessionSubject,
      contentId: content.id,
      accessSessionId: session.sid,
    });

    res.json({
      sessionId: fingerprintSession.sessionId,
      fingerprint: fingerprintSession.fingerprint,
      shortWallet: fingerprintSession.shortWallet,
      contentId: fingerprintSession.contentId,
      startedAt: new Date(fingerprintSession.createdAt).toISOString(),
      expiresAt: new Date(fingerprintSession.expiresAt).toISOString(),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    if (/expired|view limit/i.test((error as Error).message ?? "")) {
      res.status(410).json({ error: (error as Error).message });
      return;
    }

    if ((error as Error).name === "JsonWebTokenError" || (error as Error).name === "TokenExpiredError") {
      res.status(401).json({ error: (error as Error).message });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

