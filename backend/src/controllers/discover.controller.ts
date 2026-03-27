import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";
import { walletHashForAddress } from "../services/walletRoleService.js";

const serializeCreator = <T extends {
  _count?: { followers?: number };
}>(creator: T): T & { followerCount: number } => ({
  ...creator,
  followerCount: creator._count?.followers ?? 0,
});

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const walletAddress =
      typeof req.query.walletAddress === "string" && req.query.walletAddress.trim().length > 0
        ? req.query.walletAddress.trim()
        : undefined;
    const walletHash = walletAddress ? walletHashForAddress(walletAddress) : undefined;
    const fanProfile = walletHash
      ? await prisma.fanProfile.findUnique({
          where: { walletHash },
          select: {
            monthlyBudgetMicrocredits: true,
          },
        })
      : null;
    const followedCreatorIds = walletHash
      ? (
          await prisma.creatorFollow.findMany({
            where: { walletHash },
            select: { creatorId: true },
          })
        ).map((follow) => follow.creatorId)
      : [];

    const creators = await prisma.creator.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        walletAddress: true,
        creatorFieldId: true,
        handle: true,
        displayName: true,
        bio: true,
        avatarObjectKey: true,
        subscriptionPriceMicrocredits: true,
        acceptedPaymentAssets: true,
        acceptedPaymentVisibilities: true,
        isVerified: true,
        createdAt: true,
        _count: {
          select: {
            followers: true,
          },
        },
      },
    });

    const contents = await prisma.content.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      where: {
        isPublished: true,
        accessType: "PUBLIC",
      },
      select: {
        id: true,
        contentFieldId: true,
        title: true,
        description: true,
        kind: true,
        accessType: true,
        ppvPriceMicrocredits: true,
        thumbObjectKey: true,
        createdAt: true,
        creator: {
          select: { handle: true, displayName: true, creatorFieldId: true, isVerified: true },
        },
      },
    });

    const ppvContents = await prisma.content.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      where: {
        isPublished: true,
        accessType: "PPV",
      },
      select: {
        id: true,
        contentFieldId: true,
        title: true,
        description: true,
        kind: true,
        accessType: true,
        ppvPriceMicrocredits: true,
        thumbObjectKey: true,
        createdAt: true,
        creator: {
          select: { handle: true, displayName: true, creatorFieldId: true, isVerified: true },
        },
      },
    });

    const serializedCreators = creators.map((creator) => serializeCreator(creator));
    const recommendedCreators = fanProfile
      ? serializedCreators
          .filter((creator) => !followedCreatorIds.includes(creator.id))
          .filter((creator) => creator.subscriptionPriceMicrocredits <= fanProfile.monthlyBudgetMicrocredits)
          .sort((a, b) => {
            const priceDelta = Number(a.subscriptionPriceMicrocredits - b.subscriptionPriceMicrocredits);
            if (priceDelta !== 0) return priceDelta;
            return b.followerCount - a.followerCount;
          })
          .slice(0, 6)
      : [];

    res.json({
      creators: serializedCreators,
      contents,
      ppvContents,
      recommendedCreators,
      fanBudgetMicrocredits: fanProfile?.monthlyBudgetMicrocredits.toString() ?? null,
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

export const search = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.json({ creators: [], contents: [] });
      return;
    }

    const creators = await prisma.creator.findMany({
      where: {
        OR: [
          { handle: { contains: q.toLowerCase() } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 20,
      select: {
        id: true,
        creatorFieldId: true,
        handle: true,
        displayName: true,
        bio: true,
        avatarObjectKey: true,
        subscriptionPriceMicrocredits: true,
        isVerified: true,
        createdAt: true,
        _count: {
          select: {
            followers: true,
          },
        },
      },
    });

    const contents = await prisma.content.findMany({
      where: {
        isPublished: true,
        accessType: { in: ["PUBLIC", "PPV"] },
        OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
      },
      take: 20,
      select: {
        id: true,
        contentFieldId: true,
        title: true,
        description: true,
        kind: true,
        accessType: true,
        ppvPriceMicrocredits: true,
        thumbObjectKey: true,
        createdAt: true,
        creator: {
          select: { handle: true, displayName: true, creatorFieldId: true, isVerified: true },
        },
      },
    });

    res.json({ creators: creators.map((creator) => serializeCreator(creator)), contents });
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
