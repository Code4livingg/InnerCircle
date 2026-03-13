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
} from "../services/proofVerificationService.js";
import { ensureWalletRoleByHash, toClientRole, WalletRoleConflictError } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";
import { walletHashForAddress } from "../services/walletRoleService.js";

const proofSchema = z.union([
  z.string().min(10),
  z.object({
    txId: z.string().min(10),
    programId: z.string().min(3).optional(),
    functionName: z.string().min(3).optional(),
  }),
]);

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
  // Direct purchase-tx modes — no separate prove_ call needed
  z.object({
    mode: z.literal("subscription-direct"),
    creatorHandle: z.string().min(3),
    purchaseTxId: z.string().min(10),
    walletAddressHint: z.string().min(10).optional(),
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
  walletAddress: z.string().min(10),
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

const SUBSCRIPTION_TERM_MS = 30 * 24 * 60 * 60 * 1000;

const getSubscriptionActiveUntil = (verifiedAt: Date): Date =>
  new Date(verifiedAt.getTime() + SUBSCRIPTION_TERM_MS);

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

export const createAccessSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = sessionSchema.parse(req.body);

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

      const verified = await verifySubscriptionPayment({
        creatorFieldId: creator.creatorFieldId,
        purchaseTxId: payload.purchaseTxId,
        walletAddressHint: payload.walletAddressHint,
        expectedPriceMicrocredits: creator.subscriptionPriceMicrocredits,
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
        },
      });
      if (!purchase) {
        res.status(409).json({ error: "Subscription payment has not been verified yet.", code: "TX_PENDING" });
        return;
      }

      if (getSubscriptionActiveUntil(purchase.verifiedAt).getTime() <= Date.now()) {
        res.status(409).json({ error: "Subscription expired. Purchase again to continue.", code: "SUBSCRIPTION_EXPIRED" });
        return;
      }

      const session = createSessionToken({ walletHash: verified.walletHash, scope: { type: "subscription", creatorId: creator.handle } });
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

      const session = createSessionToken({ walletHash: verified.walletHash, scope: { type: "ppv", contentId: content.id } });
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
      const session = createSessionToken({ walletHash: verified.walletHash, scope: { type: "ppv", contentId: content.id } });
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
        walletHash: verified.walletHash,
        scope: { type: "subscription", creatorId: creator.handle },
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
        walletHash: verified.walletHash,
        scope: { type: "ppv", contentId: content.id },
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
      walletHash: verified.walletHash,
      scope: { type: "ppv", contentId: content.id },
    });

    res.json({ sessionToken: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt });
  } catch (error) {
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

    res.status(400).json({ error: (error as Error).message });
  }
};

export const startFingerprintSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = startFingerprintSessionSchema.parse(req.body);
    const session = validateSessionToken(payload.sessionToken);
    const walletHash = walletHashForAddress(payload.walletAddress);

    if (walletHash !== session.wh) {
      res.status(403).json({ error: "Wallet address does not match the authorized session." });
      return;
    }

    const content = await prisma.content.findUnique({
      where: { id: payload.contentId },
      select: {
        id: true,
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

    const fingerprintSession = createFingerprintSession({
      walletAddress: payload.walletAddress,
      walletHash,
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

    if ((error as Error).name === "JsonWebTokenError" || (error as Error).name === "TokenExpiredError") {
      res.status(401).json({ error: (error as Error).message });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};
