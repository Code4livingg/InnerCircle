import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import type { SessionRequest } from "../middleware/requireSession.js";
import { generateMediaUrl, signedUrlTtlSeconds } from "../services/mediaStorageService.js";
import { getSubscriptionActiveUntil, tierFromPriceMicrocredits } from "../services/subscriptionService.js";
import { buildWatermarkHeaders, createWatermarkId } from "../services/watermarkService.js";
import { deleteContentRecord, hasReachedViewLimit, isExpired } from "../services/selfDestructService.js";

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
        expiresAt: true,
        viewLimit: true,
        views: true,
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

    const expired = isExpired(content.expiresAt ?? null);
    const limitReached = hasReachedViewLimit(content.views ?? 0, content.viewLimit ?? null);
    if (expired || limitReached) {
      await deleteContentRecord(content.id);
      res.status(410).json({ error: "Content has expired or reached its view limit." });
      return;
    }

    if (!canAccessContentWithSession(session, content.id, content.creator.handle)) {
      res.status(403).json({ error: "Invalid session scope" });
      return;
    }

    if (session.scope.type === "subscription" && session.scope.verifiedBy === "zk-proof") {
      if (!session.scope.expiresAt || session.scope.expiresAt <= Date.now()) {
        res.status(403).json({ error: "Subscription proof expired. Generate a fresh proof to continue." });
        return;
      }

      const requiredTier = tierFromPriceMicrocredits(content.subscriptionTier?.priceMicrocredits ?? null);
      if ((session.scope.tier ?? 1) < requiredTier) {
        res.status(403).json({ error: "Subscription tier upgrade required to access this content." });
        return;
      }
    }

    if (session.scope.type === "subscription" && session.scope.verifiedBy !== "proof" && session.scope.verifiedBy !== "zk-proof") {
      // New anonymous sessions carry a scoped entitlement so playback does not
      // have to look up purchases by a stable wallet identifier.
      if (session.scope.entitlementBound && session.scope.expiresAt) {
        if (session.scope.expiresAt <= Date.now()) {
          res.status(403).json({ error: "Subscription expired. Please renew to continue." });
          return;
        }

        const requiredTier = tierFromPriceMicrocredits(content.subscriptionTier?.priceMicrocredits ?? null);
        if ((session.scope.tier ?? 1) < requiredTier) {
          res.status(403).json({ error: "Subscription tier upgrade required to access this content." });
          return;
        }
      } else {
        const latestPurchase = await prisma.subscriptionPurchase.findFirst({
          where: {
            creatorId: content.creator.id,
            walletHash: session.wh,
          },
          orderBy: { verifiedAt: "desc" },
          select: {
            verifiedAt: true,
            expiresAt: true,
            priceMicrocredits: true,
          },
        });

        if (!latestPurchase) {
          res.status(403).json({ error: "No active subscription for this creator." });
          return;
        }

        const activeUntil = getSubscriptionActiveUntil(latestPurchase.verifiedAt, latestPurchase.expiresAt ?? null);
        if (activeUntil.getTime() <= Date.now()) {
          res.status(403).json({ error: "Subscription expired. Please renew to continue." });
          return;
        }

        if (content.subscriptionTier?.priceMicrocredits && latestPurchase.priceMicrocredits < content.subscriptionTier.priceMicrocredits) {
          res.status(403).json({ error: "Subscription tier upgrade required to access this content." });
          return;
        }
      }
    }

    const url = await generateMediaUrl(content.baseObjectKey);
    const ttlSeconds = signedUrlTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const watermarkId = createWatermarkId(session.wh, content.id, "signed-url");

    await prisma.streamEvent.create({
      data: {
        // New access sessions persist the unlinkable session subject here so
        // watermark tracing does not point back to a stable wallet hash.
        walletHash: session.wh,
        contentId: content.id,
        sessionId: session.sid,
        watermarkId,
        bytesServed: 0n,
      },
    });

    res.setHeader("Cache-Control", "no-store");
    const watermarkHeaders = buildWatermarkHeaders(session.sid, watermarkId);
    for (const [header, value] of Object.entries(watermarkHeaders)) {
      res.setHeader(header, value);
    }
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
