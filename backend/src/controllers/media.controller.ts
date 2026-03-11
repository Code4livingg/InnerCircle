import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import type { SessionRequest } from "../middleware/requireSession.js";
import { generateMediaUrl } from "../services/mediaStorageService.js";
import { createWatermarkId } from "../services/watermarkService.js";

const canAccessContentWithSession = (
  session: NonNullable<SessionRequest["session"]>,
  contentId: string,
  creatorHandle: string,
): boolean => {
  if (session.scope.type === "ppv") {
    return session.scope.contentId === contentId;
  }

  return session.scope.creatorId === creatorHandle;
};

export const getMediaAccessUrl = async (req: SessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.session;
    const contentId = req.params.id;

    if (!session) {
      res.status(401).json({ error: "Missing access token" });
      return;
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        baseObjectKey: true,
        mimeType: true,
        creator: {
          select: {
            handle: true,
          },
        },
      },
    });

    if (!content || !content.baseObjectKey) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    if (!canAccessContentWithSession(session, content.id, content.creator.handle)) {
      res.status(403).json({ error: "Invalid session scope" });
      return;
    }

    const url = await generateMediaUrl(content.baseObjectKey);
    const expiresAt = new Date(Date.now() + env.signedUrlExpirationSeconds * 1000).toISOString();
    const watermarkId = createWatermarkId(session.wh, content.id, "signed-url");

    await prisma.streamEvent.create({
      data: {
        walletHash: session.wh,
        contentId: content.id,
        sessionId: session.sid,
        watermarkId,
        bytesServed: 0n,
      },
    });

    res.json({
      url,
      expiresAt,
      expiresIn: env.signedUrlExpirationSeconds,
      mimeType: content.mimeType,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
