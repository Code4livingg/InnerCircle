import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";

const createReportSchema = z.object({
  reporterWalletAddress: z.string().min(10).optional(),
  contentId: z.string().min(1).optional(),
  creatorId: z.string().min(1).optional(),
  reason: z.string().min(3).max(160),
  details: z.string().max(2000).optional(),
});

const walletHash = (address: string): string => sha256Hex(address.toLowerCase());

export const createReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = createReportSchema.parse(req.body);
    const reporterWalletHash = payload.reporterWalletAddress ? walletHash(payload.reporterWalletAddress) : undefined;

    if (!payload.contentId && !payload.creatorId) {
      res.status(400).json({ error: "Provide contentId or creatorId" });
      return;
    }

    const id = randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "Report" (
        "id",
        "reporterWalletHash",
        "contentId",
        "creatorId",
        "reason",
        "details",
        "createdAt"
      )
      VALUES (
        CAST(${id} AS UUID),
        ${reporterWalletHash ?? null},
        CAST(${payload.contentId ?? null} AS UUID),
        CAST(${payload.creatorId ?? null} AS UUID),
        ${payload.reason},
        ${payload.details ?? null},
        NOW()
      )
    `;

    const reports = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT *
      FROM "Report"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    const report = reports[0] ?? null;

    res.json({ report });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const listReports = async (_req: Request, res: Response): Promise<void> => {
  const reports = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
    FROM "Report"
    ORDER BY "createdAt" DESC
    LIMIT 200
  `;
  res.json({ reports });
};
