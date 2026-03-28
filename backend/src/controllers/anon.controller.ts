import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ExplorerRequestError, fetchLatestBlockHeight } from "../services/aleoExplorerService.js";
import { approximateExpiryDateFromBlockHeights } from "../services/subscriptionService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const registerAnonSessionSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    anonSessionId: z.string().min(1).optional(),
    nullifier: z.string().min(1).optional(),
    invoiceNullifier: z.string().min(1).optional(),
    circleId: z.string().min(1),
    tier: z.number().int().min(1).max(2),
    expiresAtBlock: z.number().int().positive().optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.sessionId && !value.anonSessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sessionId is required",
        path: ["sessionId"],
      });
    }

    if (!value.nullifier && !value.invoiceNullifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nullifier is required",
        path: ["nullifier"],
      });
    }

    if (!value.expiresAtBlock && !value.expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAtBlock is required",
        path: ["expiresAtBlock"],
      });
    }
  });

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");

export const registerAnonSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = registerAnonSessionSchema.parse(req.body);
    const sessionId = String(payload.sessionId ?? payload.anonSessionId ?? "").trim();
    const nullifier = String(payload.nullifier ?? payload.invoiceNullifier ?? "").trim();
    const circleId = normalizeFieldId(payload.circleId);
    const expiresAtBlock = payload.expiresAtBlock ?? payload.expiresAt ?? 0;

    const existingSession = await prisma.$queryRaw<Array<{ sessionId: string }>>`
      SELECT "sessionId" AS "sessionId"
      FROM "anon_sessions"
      WHERE "sessionId" = ${sessionId}
      LIMIT 1
    `;
    if (existingSession[0]) {
      res.json({ ok: true });
      return;
    }

    const existingNullifier = await prisma.subscriptionNullifier.findUnique({
      where: { nullifier },
      select: { id: true },
    });
    if (existingNullifier) {
      res.status(409).json({ error: "Nullifier already used" });
      return;
    }

    const currentBlock = await fetchLatestBlockHeight();
    if (expiresAtBlock <= currentBlock) {
      res.status(401).json({ error: "Subscription expired" });
      return;
    }

    const expiresAt = approximateExpiryDateFromBlockHeights(currentBlock, expiresAtBlock);

    await prisma.$transaction(async (tx) => {
      await tx.subscriptionNullifier.create({
        data: {
          nullifier,
          circleId,
          expiresAt,
        },
      });

      await tx.$executeRaw`
        INSERT INTO "anon_sessions" (
          "id",
          "sessionId",
          "circleId",
          "tier",
          "expiresAtBlock",
          "nullifierHash",
          "createdAt"
        ) VALUES (
          ${`anon_${randomUUID().replace(/-/g, "")}`},
          ${sessionId},
          ${circleId},
          ${payload.tier},
          ${expiresAtBlock},
          ${nullifier},
          NOW()
        )
      `;
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ExplorerRequestError && /block height/i.test(error.message)) {
      res.status(502).json({ error: "Failed to verify Aleo block height" });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta?.target.map(String) : [];
      if (target.includes("sessionId")) {
        res.json({ ok: true });
        return;
      }

      if (target.includes("nullifier") || target.includes("nullifierHash")) {
        res.status(409).json({ error: "Nullifier already used" });
        return;
      }
    }

    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};
