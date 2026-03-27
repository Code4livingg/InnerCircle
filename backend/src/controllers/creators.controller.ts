import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  ensureWalletRoleByHash,
  toClientRole,
  walletHashForAddress,
  WalletRoleConflictError,
} from "../services/walletRoleService.js";
import { randomFieldLiteral } from "../utils/aleo.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const registerSchema = z.object({
  walletAddress: z.string().min(10),
  handle: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_-]+$/i, "Handle must contain only letters, numbers, underscores, or hyphens"),
  displayName: z.string().max(80).optional(),
  bio: z.string().max(500).optional(),
  acceptedPaymentAssets: z.array(z.string()).optional(),
  acceptedPaymentVisibilities: z.array(z.string()).optional(),
});

const pricingSchema = z.object({
  walletAddress: z.string().min(10),
  subscriptionPriceMicrocredits: z.coerce.bigint().nonnegative(),
});

const paymentPreferencesSchema = z.object({
  walletAddress: z.string().min(10),
  acceptedPaymentAssets: z.array(z.string()).min(1),
  acceptedPaymentVisibilities: z.array(z.string()).min(1),
});

const walletLookupSchema = z.object({
  walletAddress: z.string().min(10),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_PAYMENT_ASSETS = new Set(["ALEO_CREDITS", "USDCX"]);
const ALLOWED_PAYMENT_VISIBILITIES = new Set(["PUBLIC", "PRIVATE"]);

const sanitizeCreatorPaymentAssets = (values: string[] | undefined): string[] => {
  const normalized = (values ?? ["ALEO_CREDITS"])
    .map((value) => value.trim().toUpperCase())
    .filter((value) => ALLOWED_PAYMENT_ASSETS.has(value));
  return normalized.length > 0 ? [...new Set(normalized)] : ["ALEO_CREDITS"];
};

const sanitizeCreatorPaymentVisibilities = (values: string[] | undefined): string[] => {
  const normalized = (values ?? ["PUBLIC", "PRIVATE"])
    .map((value) => value.trim().toUpperCase())
    .filter((value) => ALLOWED_PAYMENT_VISIBILITIES.has(value));
  return normalized.length > 0 ? [...new Set(normalized)] : ["PUBLIC", "PRIVATE"];
};

const getActiveSubscriptionCutoff = (): Date => new Date(Date.now() - THIRTY_DAYS_MS);

const getMonthStart = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const getSeriesStart = (): Date => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  return start;
};

const sumMaybeBigInts = (values: Array<bigint | null | undefined>): bigint =>
  values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);

const serializeCreator = <T extends {
  _count?: { followers?: number };
  contents?: Array<{ accessType?: string }>;
}>(creator: T): T & { followerCount: number } => {
  const followerCount = creator._count?.followers ?? 0;
  return {
    ...creator,
    followerCount,
  };
};

export const registerCreator = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = registerSchema.parse(req.body);
    const wh = walletHashForAddress(payload.walletAddress);
    const acceptedPaymentAssets = sanitizeCreatorPaymentAssets(payload.acceptedPaymentAssets);
    const acceptedPaymentVisibilities = sanitizeCreatorPaymentVisibilities(payload.acceptedPaymentVisibilities);
    await ensureWalletRoleByHash(wh, "CREATOR");

    const creator = await prisma.creator.upsert({
      where: { walletHash: wh },
      update: {
        walletAddress: payload.walletAddress,
        handle: payload.handle.toLowerCase(),
        displayName: payload.displayName,
        bio: payload.bio,
        acceptedPaymentAssets,
        acceptedPaymentVisibilities,
      },
      create: {
        walletHash: wh,
        walletAddress: payload.walletAddress,
        creatorFieldId: randomFieldLiteral(),
        handle: payload.handle.toLowerCase(),
        displayName: payload.displayName,
        bio: payload.bio,
        acceptedPaymentAssets,
        acceptedPaymentVisibilities,
      },
    });

    res.json({ creator });
  } catch (error) {
    if (error instanceof WalletRoleConflictError) {
      res.status(409).json({
        error: `This wallet is already locked as ${toClientRole(error.existingRole)}. Use a different wallet to register as ${toClientRole(error.requestedRole)}.`,
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

export const listCreators = async (_req: Request, res: Response): Promise<void> => {
  try {
    const creators = await prisma.creator.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        creatorFieldId: true,
        walletAddress: true,
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

    res.json({ creators: creators.map((creator) => serializeCreator(creator)) });
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

export const getCreatorByHandle = async (req: Request, res: Response): Promise<void> => {
  try {
    const { handle } = req.params;

    const creator = await prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      include: {
        contents: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            contentFieldId: true,
            title: true,
            description: true,
            kind: true,
            accessType: true,
            ppvPriceMicrocredits: true,
            isPublished: true,
            thumbObjectKey: true,
            subscriptionTierId: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            followers: true,
          },
        },
      },
    });
    // Return walletAddress so frontend can pass it to payment contract
    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    res.json({ creator: serializeCreator(creator) });
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

export const getCreatorByWalletAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = walletLookupSchema.parse(req.params);
    const wh = walletHashForAddress(payload.walletAddress);

    const creator = await prisma.creator.findUnique({
      where: { walletHash: wh },
      include: {
        contents: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            contentFieldId: true,
            title: true,
            description: true,
            kind: true,
            accessType: true,
            ppvPriceMicrocredits: true,
            isPublished: true,
            thumbObjectKey: true,
            subscriptionTierId: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            followers: true,
          },
        },
      },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    res.json({ creator: serializeCreator(creator) });
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

export const setCreatorPricing = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = pricingSchema.parse(req.body);
    const wh = walletHashForAddress(payload.walletAddress);

    const creator = await prisma.creator.update({
      where: { walletHash: wh },
      data: { subscriptionPriceMicrocredits: payload.subscriptionPriceMicrocredits },
    });

    res.json({ creator });
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

export const setCreatorPaymentPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = paymentPreferencesSchema.parse(req.body);
    const wh = walletHashForAddress(payload.walletAddress);

    const creator = await prisma.creator.update({
      where: { walletHash: wh },
      data: {
        acceptedPaymentAssets: sanitizeCreatorPaymentAssets(payload.acceptedPaymentAssets),
        acceptedPaymentVisibilities: sanitizeCreatorPaymentVisibilities(payload.acceptedPaymentVisibilities),
      },
    });

    res.json({ creator });
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

export const getCreatorAnalyticsByWalletAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = walletLookupSchema.parse(req.params);
    const creator = await prisma.creator.findUnique({
      where: { walletHash: walletHashForAddress(payload.walletAddress) },
      select: {
        id: true,
        handle: true,
        displayName: true,
        subscriptionPriceMicrocredits: true,
        contents: {
          select: {
            id: true,
            isPublished: true,
            accessType: true,
            ppvPriceMicrocredits: true,
          },
        },
      },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const activeSubscriptionCutoff = getActiveSubscriptionCutoff();
    const monthStart = getMonthStart();
    const previousActiveStart = new Date(Date.now() - THIRTY_DAYS_MS * 2);
    const previousActiveEnd = new Date(Date.now() - THIRTY_DAYS_MS);
    const seriesStart = getSeriesStart();

    const [
      followerCount,
      activeSubscriptions,
      totalSubscribers,
      subscriptionRevenueAgg,
      monthlySubscriptionRevenueAgg,
      ppvRevenueAgg,
      monthlyPpvRevenueAgg,
      tipRevenueAgg,
      monthlyTipRevenueAgg,
      contentViewCount,
      monthlyContentViewCount,
      previousActiveSubscriptions,
      subscriptionSeries,
      ppvSeries,
      tipSeries,
      viewSeries,
    ] = await Promise.all([
      prisma.creatorFollow.count({ where: { creatorId: creator.id } }),
      prisma.subscriptionPurchase.findMany({
        where: {
          creatorId: creator.id,
          verifiedAt: { gte: activeSubscriptionCutoff },
        },
        distinct: ["walletHash"],
        select: { walletHash: true },
      }),
      prisma.subscriptionPurchase.findMany({
        where: { creatorId: creator.id },
        distinct: ["walletHash"],
        select: { walletHash: true },
      }),
      prisma.subscriptionPurchase.aggregate({
        where: { creatorId: creator.id },
        _sum: { priceMicrocredits: true },
      }),
      prisma.subscriptionPurchase.aggregate({
        where: {
          creatorId: creator.id,
          verifiedAt: { gte: monthStart },
        },
        _sum: { priceMicrocredits: true },
      }),
      prisma.ppvPurchase.aggregate({
        where: {
          content: { creatorId: creator.id },
        },
        _sum: { priceMicrocredits: true },
      }),
      prisma.ppvPurchase.aggregate({
        where: {
          content: { creatorId: creator.id },
          verifiedAt: { gte: monthStart },
        },
        _sum: { priceMicrocredits: true },
      }),
      prisma.tip.aggregate({
        where: { creatorId: creator.id },
        _sum: { amountMicrocredits: true },
      }),
      prisma.tip.aggregate({
        where: { creatorId: creator.id, createdAt: { gte: monthStart } },
        _sum: { amountMicrocredits: true },
      }),
      prisma.streamEvent.count({
        where: { content: { creatorId: creator.id } },
      }),
      prisma.streamEvent.count({
        where: { content: { creatorId: creator.id }, createdAt: { gte: monthStart } },
      }),
      prisma.subscriptionPurchase.findMany({
        where: {
          creatorId: creator.id,
          verifiedAt: { gte: previousActiveStart, lt: previousActiveEnd },
        },
        distinct: ["walletHash"],
        select: { walletHash: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; total: bigint | null }>>`
        SELECT date_trunc('day', "verifiedAt") AS day,
               SUM("priceMicrocredits") AS total
        FROM "SubscriptionPurchase"
        WHERE "creatorId" = CAST(${creator.id} AS uuid)
          AND "verifiedAt" >= ${seriesStart}
        GROUP BY day
        ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: Date; total: bigint | null }>>`
        SELECT date_trunc('day', p."verifiedAt") AS day,
               SUM(p."priceMicrocredits") AS total
        FROM "PpvPurchase" p
        JOIN "Content" c ON p."contentId" = c."id"
        WHERE c."creatorId" = CAST(${creator.id} AS uuid)
          AND p."verifiedAt" >= ${seriesStart}
        GROUP BY day
        ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: Date; total: bigint | null }>>`
        SELECT date_trunc('day', "createdAt") AS day,
               SUM("amountMicrocredits") AS total
        FROM "Tip"
        WHERE "creatorId" = CAST(${creator.id} AS uuid)
          AND "createdAt" >= ${seriesStart}
        GROUP BY day
        ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: Date; total: bigint | null }>>`
        SELECT date_trunc('day', s."createdAt") AS day,
               COUNT(*)::bigint AS total
        FROM "StreamEvent" s
        JOIN "Content" c ON s."contentId" = c."id"
        WHERE c."creatorId" = CAST(${creator.id} AS uuid)
          AND s."createdAt" >= ${seriesStart}
        GROUP BY day
        ORDER BY day
      `,
    ]);

    const publicPosts = creator.contents.filter((content) => content.accessType === "PUBLIC");
    const subscriptionPosts = creator.contents.filter((content) => content.accessType === "SUBSCRIPTION");
    const ppvPosts = creator.contents.filter((content) => content.accessType === "PPV");

    const totalRevenueMicrocredits = sumMaybeBigInts([
      subscriptionRevenueAgg._sum.priceMicrocredits,
      ppvRevenueAgg._sum.priceMicrocredits,
      tipRevenueAgg._sum.amountMicrocredits,
    ]);
    const monthlyRevenueMicrocredits = sumMaybeBigInts([
      monthlySubscriptionRevenueAgg._sum.priceMicrocredits,
      monthlyPpvRevenueAgg._sum.priceMicrocredits,
      monthlyTipRevenueAgg._sum.amountMicrocredits,
    ]);
    const churnRate =
      previousActiveSubscriptions.length > 0
        ? Math.max(
            0,
            (previousActiveSubscriptions.length - activeSubscriptions.length) / previousActiveSubscriptions.length,
          )
        : 0;

    const toSeriesMap = (rows: Array<{ day: Date; total: bigint | null }>): Map<string, bigint> =>
      new Map(
        rows.map((row) => [
          new Date(row.day).toISOString().slice(0, 10),
          row.total ?? 0n,
        ]),
      );

    const subscriptionMap = toSeriesMap(subscriptionSeries);
    const ppvMap = toSeriesMap(ppvSeries);
    const tipMap = toSeriesMap(tipSeries);
    const viewMap = toSeriesMap(viewSeries);

    const series: Array<{
      date: string;
      subscriptionRevenueMicrocredits: string;
      ppvRevenueMicrocredits: string;
      tipRevenueMicrocredits: string;
      contentViews: number;
    }> = [];

    for (let i = 0; i < 30; i += 1) {
      const day = new Date(seriesStart);
      day.setDate(seriesStart.getDate() + i);
      const key = day.toISOString().slice(0, 10);
      series.push({
        date: key,
        subscriptionRevenueMicrocredits: (subscriptionMap.get(key) ?? 0n).toString(),
        ppvRevenueMicrocredits: (ppvMap.get(key) ?? 0n).toString(),
        tipRevenueMicrocredits: (tipMap.get(key) ?? 0n).toString(),
        contentViews: Number(viewMap.get(key) ?? 0n),
      });
    }

    res.json({
      creator: {
        id: creator.id,
        handle: creator.handle,
        displayName: creator.displayName,
        subscriptionPriceMicrocredits: creator.subscriptionPriceMicrocredits.toString(),
      },
      stats: {
        followerCount,
        activeSubscriberCount: activeSubscriptions.length,
        totalSubscriberCount: totalSubscribers.length,
        totalRevenueMicrocredits: totalRevenueMicrocredits.toString(),
        monthlyRevenueMicrocredits: monthlyRevenueMicrocredits.toString(),
        subscriptionRevenueMicrocredits: (subscriptionRevenueAgg._sum.priceMicrocredits ?? 0n).toString(),
        ppvRevenueMicrocredits: (ppvRevenueAgg._sum.priceMicrocredits ?? 0n).toString(),
        tipRevenueMicrocredits: (tipRevenueAgg._sum.amountMicrocredits ?? 0n).toString(),
        monthlyTipRevenueMicrocredits: (monthlyTipRevenueAgg._sum.amountMicrocredits ?? 0n).toString(),
        contentViewCount,
        monthlyContentViewCount,
        churnRate,
        publicPostCount: publicPosts.length,
        subscriptionPostCount: subscriptionPosts.length,
        ppvPostCount: ppvPosts.length,
        totalContentCount: creator.contents.length,
        publishedContentCount: creator.contents.filter((content) => content.isPublished).length,
      },
      series,
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

export const getCreatorAnalytics = async (req: Request, res: Response): Promise<void> => {
  const walletAddress =
    typeof req.query.walletAddress === "string" && req.query.walletAddress.trim().length > 0
      ? req.query.walletAddress.trim()
      : "";

  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress query parameter is required." });
    return;
  }

  req.params = { walletAddress };
  return getCreatorAnalyticsByWalletAddress(req, res);
};
