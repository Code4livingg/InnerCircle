import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const submitSchema = z.object({
  documentsSubmitted: z.array(z.string().min(3)).max(10).optional(),
  notes: z.string().max(500).optional(),
});

const handleSchema = z.object({
  handle: z.string().min(3),
});

const reviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
});

const normalizeStatus = (value: string): "PENDING" | "APPROVED" | "REJECTED" => {
  switch (value) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    default:
      return "PENDING";
  }
};

export const submitCreatorVerification = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = submitSchema.parse(req.body);
    const creator = await prisma.creator.findUnique({
      where: { walletHash: session.wh },
      select: { id: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const documents = payload.documentsSubmitted?.length
      ? JSON.stringify(payload.documentsSubmitted)
      : payload.notes
        ? JSON.stringify([payload.notes])
        : null;

    const verification = await prisma.creatorVerification.upsert({
      where: { creatorId: creator.id },
      update: {
        verificationStatus: "PENDING",
        documentsSubmitted: documents,
        reviewedAt: null,
      },
      create: {
        creatorId: creator.id,
        verificationStatus: "PENDING",
        documentsSubmitted: documents,
      },
    });

    await prisma.creator.update({
      where: { id: creator.id },
      data: { isVerified: false },
    });

    res.json({
      verification: {
        id: verification.id,
        status: verification.verificationStatus,
        submittedAt: verification.createdAt.toISOString(),
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

export const getCreatorVerificationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = handleSchema.parse(req.params);
    const creator = await prisma.creator.findUnique({
      where: { handle: payload.handle.toLowerCase() },
      select: { id: true, isVerified: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const verification = await prisma.creatorVerification.findUnique({
      where: { creatorId: creator.id },
      select: { verificationStatus: true, reviewedAt: true, createdAt: true },
    });

    res.json({
      status: verification?.verificationStatus ?? (creator.isVerified ? "APPROVED" : "PENDING"),
      submittedAt: verification?.createdAt.toISOString() ?? null,
      reviewedAt: verification?.reviewedAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const reviewCreatorVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = handleSchema.parse(req.params);
    const body = reviewSchema.parse(req.body);

    const creator = await prisma.creator.findUnique({
      where: { handle: payload.handle.toLowerCase() },
      select: { id: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const status = normalizeStatus(body.status);
    const verification = await prisma.creatorVerification.upsert({
      where: { creatorId: creator.id },
      update: { verificationStatus: status, reviewedAt: new Date() },
      create: { creatorId: creator.id, verificationStatus: status, reviewedAt: new Date() },
    });

    await prisma.creator.update({
      where: { id: creator.id },
      data: { isVerified: status === "APPROVED" },
    });

    res.json({
      verification: {
        id: verification.id,
        status: verification.verificationStatus,
        reviewedAt: verification.reviewedAt?.toISOString() ?? null,
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
