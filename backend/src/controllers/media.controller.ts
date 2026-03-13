import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import type { SessionRequest } from "../middleware/requireSession.js";
import { generateMediaUrl, signedUrlTtlSeconds } from "../services/mediaStorageService.js";
import { getSubscriptionActiveUntil } from "../services/subscriptionService.js";
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
        subscriptionTier: {
          select: {
            id: true,
            priceMicrocredits: true,
          },
        },
        creator: {
          select: {
            handle: true,
            id: true,
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

    if (session.scope.type === "subscription") {
      const latestPurchase = await prisma.subscriptionPurchase.findFirst({
        where: {
          creatorId: content.creator.id,
          walletHash: session.wh,
        },
        orderBy: { verifiedAt: "desc" },
        select: {
          verifiedAt: true,
          priceMicrocredits: true,
        },
      });

      if (!latestPurchase) {
        res.status(403).json({ error: "No active subscription for this creator." });
        return;
      }

      const activeUntil = getSubscriptionActiveUntil(latestPurchase.verifiedAt);
      if (activeUntil.getTime() <= Date.now()) {
        res.status(403).json({ error: "Subscription expired. Please renew to continue." });
        return;
      }

      if (content.subscriptionTier?.priceMicrocredits && latestPurchase.priceMicrocredits < content.subscriptionTier.priceMicrocredits) {
        res.status(403).json({ error: "Subscription tier upgrade required to access this content." });
        return;
      }
    }

    const url = await generateMediaUrl(content.baseObjectKey);
    const ttlSeconds = signedUrlTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
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

    res.setHeader("Cache-Control", "no-store");
    res.json({
      url,
      expiresAt,
      expiresIn: ttlSeconds,
      mimeType: content.mimeType,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
