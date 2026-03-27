import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { getSubscriptionActiveUntil } from "../services/subscriptionService.js";
import {
  getMembershipProofStatus,
  getPaymentProofStatus,
  storeMembershipProof,
  storePaymentProof,
} from "../services/proofStoreService.js";

const paymentSchema = z.object({
  contentId: z.string().min(1),
  proof: z.string().min(8),
  txHash: z.string().min(8).optional(),
});

const membershipSchema = z.object({
  circleId: z.string().min(1),
  proof: z.string().min(8),
});

export const submitPaymentProof = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = paymentSchema.parse(req.body);
    const content = await prisma.content.findUnique({ where: { id: payload.contentId }, select: { id: true } });
    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const purchase = await prisma.ppvPurchase.findFirst({
      where: {
        contentId: payload.contentId,
        walletHash: session.wh,
        ...(payload.txHash ? { txId: payload.txHash } : {}),
      },
      orderBy: { verifiedAt: "desc" },
      select: { txId: true },
    });

    if (!purchase) {
      res.status(403).json({ error: "Verified PPV purchase required before storing a proof." });
      return;
    }

    await storePaymentProof({
      contentId: payload.contentId,
      proof: payload.proof,
      txHash: payload.txHash ?? purchase.txId,
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const verifyPaymentProofStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = paymentSchema.omit({ txHash: true }).parse(req.body);
    const status = await getPaymentProofStatus(payload.proof, payload.contentId);
    res.json({
      valid: status.valid,
      timestamp: status.createdAt?.toISOString() ?? null,
      txHash: status.txHash,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const submitMembershipProof = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = membershipSchema.parse(req.body);
    const creator = await prisma.creator.findUnique({ where: { id: payload.circleId }, select: { id: true } });
    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const latestPurchase = await prisma.subscriptionPurchase.findFirst({
      where: {
        creatorId: payload.circleId,
        walletHash: session.wh,
      },
      orderBy: { verifiedAt: "desc" },
      select: { verifiedAt: true },
    });

    if (!latestPurchase) {
      res.status(403).json({ error: "Active subscription required before storing a membership proof." });
      return;
    }

    if (getSubscriptionActiveUntil(latestPurchase.verifiedAt).getTime() <= Date.now()) {
      res.status(403).json({ error: "Subscription expired. Renew before generating a new membership proof." });
      return;
    }

    await storeMembershipProof({ circleId: payload.circleId, proof: payload.proof });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const verifyMembershipProofStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = membershipSchema.parse(req.body);
    const status = await getMembershipProofStatus(payload.proof, payload.circleId);
    res.json({
      valid: status.valid,
      timestamp: status.createdAt?.toISOString() ?? null,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};
