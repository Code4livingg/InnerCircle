import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  ensureWalletRoleByAddress,
  toClientRole,
  walletHashForAddress,
  WalletRoleConflictError,
} from "../services/walletRoleService.js";
import {
  DB_SCHEMA_MISMATCH_CODE,
  DB_SCHEMA_MISMATCH_MESSAGE,
  DB_UNAVAILABLE_CODE,
  DB_UNAVAILABLE_MESSAGE,
  isDatabaseSchemaMismatchError,
  isDatabaseUnavailableError,
} from "../utils/dbErrors.js";

const fanProfileSchema = z.object({
  walletAddress: z.string().min(10),
  monthlyBudgetMicrocredits: z.coerce.bigint().nonnegative(),
  favoriteCategories: z.array(z.string().min(1).max(40)).max(8).optional().default([]),
});

const fanProfileLookupSchema = z.object({
  walletAddress: z.string().min(10),
});

const followSchema = z.object({
  walletAddress: z.string().min(10),
  creatorHandle: z.string().min(3),
  follow: z.boolean(),
});

const splitFavoriteCategories = (value?: string | null): string[] =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

export const getFanProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = fanProfileLookupSchema.parse(req.params);
    const walletHash = walletHashForAddress(payload.walletAddress);

    const [profile, follows] = await Promise.all([
      prisma.fanProfile.findUnique({
        where: { walletHash },
      }),
      prisma.creatorFollow.findMany({
        where: { walletHash },
        select: {
          creator: {
            select: {
              handle: true,
              displayName: true,
              subscriptionPriceMicrocredits: true,
              isVerified: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({
      profile: profile
        ? {
            walletAddress: profile.walletAddress,
            monthlyBudgetMicrocredits: profile.monthlyBudgetMicrocredits.toString(),
            favoriteCategories: splitFavoriteCategories(profile.favoriteCategories),
          }
        : null,
      followedCreators: follows.map((follow) => follow.creator),
      followedCreatorHandles: follows.map((follow) => follow.creator.handle),
    });
  } catch (error) {
    if (isDatabaseSchemaMismatchError(error)) {
      res.status(503).json({
        error: DB_SCHEMA_MISMATCH_MESSAGE,
        code: DB_SCHEMA_MISMATCH_CODE,
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

export const upsertFanProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = fanProfileSchema.parse(req.body);
    await ensureWalletRoleByAddress(payload.walletAddress, "FAN");
    const walletHash = walletHashForAddress(payload.walletAddress);

    const profile = await prisma.fanProfile.upsert({
      where: { walletHash },
      update: {
        walletAddress: payload.walletAddress,
        monthlyBudgetMicrocredits: payload.monthlyBudgetMicrocredits,
        favoriteCategories: payload.favoriteCategories.join(","),
      },
      create: {
        walletHash,
        walletAddress: payload.walletAddress,
        monthlyBudgetMicrocredits: payload.monthlyBudgetMicrocredits,
        favoriteCategories: payload.favoriteCategories.join(","),
      },
    });

    res.json({
      profile: {
        walletAddress: profile.walletAddress,
        monthlyBudgetMicrocredits: profile.monthlyBudgetMicrocredits.toString(),
        favoriteCategories: splitFavoriteCategories(profile.favoriteCategories),
      },
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

    if (isDatabaseSchemaMismatchError(error)) {
      res.status(503).json({
        error: DB_SCHEMA_MISMATCH_MESSAGE,
        code: DB_SCHEMA_MISMATCH_CODE,
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

export const setCreatorFollow = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = followSchema.parse(req.body);
    await ensureWalletRoleByAddress(payload.walletAddress, "FAN");
    const walletHash = walletHashForAddress(payload.walletAddress);

    const creator = await prisma.creator.findUnique({
      where: { handle: payload.creatorHandle.toLowerCase() },
      select: { id: true, handle: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    if (payload.follow) {
      await prisma.creatorFollow.upsert({
        where: {
          creatorId_walletHash: {
            creatorId: creator.id,
            walletHash,
          },
        },
        update: {},
        create: {
          creatorId: creator.id,
          walletHash,
        },
      });
    } else {
      await prisma.creatorFollow.deleteMany({
        where: {
          creatorId: creator.id,
          walletHash,
        },
      });
    }

    res.json({
      ok: true,
      creatorHandle: creator.handle,
      following: payload.follow,
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

    if (isDatabaseSchemaMismatchError(error)) {
      res.status(503).json({
        error: DB_SCHEMA_MISMATCH_MESSAGE,
        code: DB_SCHEMA_MISMATCH_CODE,
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
