import { z } from "zod";
import type { Request, Response } from "express";
import { createSessionToken } from "../services/sessionService.js";
import { verifyContentAccessProof, verifySubscriptionProof } from "../services/proofVerificationService.js";
import type { SessionRequest } from "../middleware/requireSession.js";
import { getEncryptedContent } from "../services/contentCatalogService.js";
import { decryptAndWatermarkRange } from "../services/streamingService.js";
import { prisma } from "../db/prisma.js";
import { ensureWalletRoleByHash, toClientRole, WalletRoleConflictError } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const subscriptionUnlockSchema = z.object({
  creatorHandle: z.string().min(3),
  proveTxId: z.string().min(10).optional(),
  walletAddressHint: z.string().min(10).optional(),
});

const contentUnlockSchema = z.object({
  contentId: z.string().min(1),
  proveTxId: z.string().min(10).optional(),
  walletAddressHint: z.string().min(10).optional(),
});

export const unlockSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = subscriptionUnlockSchema.parse(req.body);
    const creator = await prisma.creator.findUnique({ where: { handle: payload.creatorHandle.toLowerCase() } });
    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const verified = await verifySubscriptionProof({
      creatorFieldId: creator.creatorFieldId,
      proveTxId: payload.proveTxId,
      walletAddressHint: payload.walletAddressHint,
    });

    const session = createSessionToken({
      identitySeed: verified.walletHash,
      scope: { type: "subscription", creatorId: creator.handle },
    });

    res.json({
      sessionToken: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
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

    res.status(400).json({ error: (error as Error).message });
  }
};

export const unlockContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = contentUnlockSchema.parse(req.body);
    const content = await prisma.content.findUnique({ where: { id: payload.contentId } });
    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const verified = await verifyContentAccessProof({
      contentFieldId: content.contentFieldId,
      proveTxId: payload.proveTxId,
      walletAddressHint: payload.walletAddressHint,
    });

    const session = createSessionToken({
      identitySeed: verified.walletHash,
      scope: { type: "ppv", contentId: content.id },
    });

    res.json({
      sessionToken: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      streamPath: `/api/media/${content.id}`,
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

    res.status(400).json({ error: (error as Error).message });
  }
};

export const getStreamManifest = (req: SessionRequest, res: Response): void => {
  const { contentId } = req.params;
  const session = req.session;

  if (!session || session.scope.type !== "ppv" || session.scope.contentId !== contentId) {
    res.status(403).json({ error: "Invalid session scope" });
    return;
  }

  const item = getEncryptedContent(contentId);
  if (!item) {
    res.status(404).json({ error: "Content not found" });
    return;
  }

  res.json({
    contentId,
    mimeType: item.mimeType,
    chunkEndpoint: `/api/access/stream/${contentId}/chunk`,
  });
};

export const streamChunk = async (req: SessionRequest, res: Response): Promise<void> => {
  try {
    const { contentId } = req.params;
    const session = req.session;

    if (!session || session.scope.type !== "ppv" || session.scope.contentId !== contentId) {
      res.status(403).json({ error: "Invalid session scope" });
      return;
    }

    const item = getEncryptedContent(contentId);
    if (!item) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const start = Number.parseInt(String(req.query.start ?? "0"), 10);
    const end = Number.parseInt(String(req.query.end ?? start + 1_000_000), 10);

    const chunk = await decryptAndWatermarkRange(
      item,
      session.wh,
      session.sid,
      session.exp,
      Number.isNaN(start) ? 0 : start,
      Number.isNaN(end) ? start + 1_000_000 : end,
    );

    res.status(206);
    res.setHeader("Content-Type", chunk.mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Accept-Ranges", "bytes");
    // The response metadata carries the session watermark without mutating the
    // binary chunk payload.
    res.setHeader("X-Watermark-Id", chunk.watermarkId);
    res.setHeader("X-Session-Watermark", session.sid);
    res.send(chunk.chunk);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
