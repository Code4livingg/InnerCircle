import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ExplorerRequestError } from "../services/aleoExplorerService.js";
import { verifyPpvPayment, verifySubscriptionPayment } from "../services/proofVerificationService.js";
import {
  ensureWalletRoleByHash,
  toClientRole,
  walletHashForAddress,
  WalletRoleConflictError,
} from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const verifySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("subscription"),
    txId: z.string().min(10),
    creatorHandle: z.string().min(3),
    walletAddressHint: z.string().min(10).optional(),
  }),
  z.object({
    kind: z.literal("ppv"),
    txId: z.string().min(10),
    contentId: z.string().min(1),
    walletAddressHint: z.string().min(10).optional(),
  }),
]);

const subscriptionStatusSchema = z.object({
  creatorHandle: z.string().min(3),
  walletAddress: z.string().min(10),
});

const SUBSCRIPTION_TERM_MS = 30 * 24 * 60 * 60 * 1000;

const getSubscriptionActiveUntil = (verifiedAt: Date): Date =>
  new Date(verifiedAt.getTime() + SUBSCRIPTION_TERM_MS);

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

export const verifySubscriptionOrPpvPurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = verifySchema.parse(req.body);
    if (isUuidLike(payload.txId) || !isOnChainAleoTxId(payload.txId)) {
      res.status(409).json({
        error: "Wallet returned a temporary request ID. Wait for transaction finalization and retry with an on-chain tx id (at1...).",
        code: "TX_PENDING",
      });
      return;
    }

    if (payload.kind === "subscription") {
      const creator = await prisma.creator.findUnique({
        where: { handle: payload.creatorHandle.toLowerCase() },
      });

      if (!creator) {
        res.status(404).json({ error: "Creator not found" });
        return;
      }

      const verified = await verifySubscriptionPayment({
        creatorFieldId: creator.creatorFieldId,
        purchaseTxId: payload.txId,
        walletAddressHint: payload.walletAddressHint,
        expectedPriceMicrocredits: creator.subscriptionPriceMicrocredits,
        expectedRecipientAddress: creator.walletAddress,
      });

      if (verified.walletHash === creator.walletHash) {
        res.status(409).json({
          error: "Creator wallets cannot subscribe. Use a separate fan wallet.",
          code: "ROLE_CONFLICT",
          existingRole: "creator",
          requestedRole: "user",
        });
        return;
      }

      await ensureWalletRoleByHash(verified.walletHash, "FAN");

      await prisma.$executeRaw`
        INSERT INTO "SubscriptionPurchase" (
          "id",
          "txId",
          "walletHash",
          "creatorId",
          "creatorFieldId",
          "priceMicrocredits",
          "verifiedAt",
          "createdAt"
        )
        VALUES (
          CAST(${randomUUID()} AS UUID),
          ${payload.txId},
          ${verified.walletHash},
          CAST(${creator.id} AS UUID),
          ${creator.creatorFieldId},
          ${creator.subscriptionPriceMicrocredits},
          NOW(),
          NOW()
        )
        ON CONFLICT ("txId")
        DO UPDATE SET
          "walletHash" = EXCLUDED."walletHash",
          "creatorId" = EXCLUDED."creatorId",
          "creatorFieldId" = EXCLUDED."creatorFieldId",
          "priceMicrocredits" = EXCLUDED."priceMicrocredits",
          "verifiedAt" = NOW()
      `;

      const records = await prisma.$queryRaw<Array<{ txId: string; verifiedAt: Date }>>`
        SELECT "txId", "verifiedAt"
        FROM "SubscriptionPurchase"
        WHERE "txId" = ${payload.txId}
        LIMIT 1
      `;
      const record = records[0];
      if (!record) {
        throw new Error("Failed to persist subscription verification record");
      }

      res.json({
        ok: true,
        kind: payload.kind,
        txId: record.txId,
        creatorHandle: creator.handle,
        creatorFieldId: creator.creatorFieldId,
        priceMicrocredits: creator.subscriptionPriceMicrocredits.toString(),
        verifiedAt: record.verifiedAt.toISOString(),
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

export const getSubscriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = subscriptionStatusSchema.parse(req.query);
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
      select: {
        txId: true,
        verifiedAt: true,
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
      });
      return;
    }

    const activeUntil = getSubscriptionActiveUntil(latestPurchase.verifiedAt);
    res.json({
      ok: true,
      creatorHandle: creator.handle,
      active: activeUntil.getTime() > Date.now(),
      txId: latestPurchase.txId,
      verifiedAt: latestPurchase.verifiedAt.toISOString(),
      activeUntil: activeUntil.toISOString(),
      priceMicrocredits: creator.subscriptionPriceMicrocredits.toString(),
    });
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
