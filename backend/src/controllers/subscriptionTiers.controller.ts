import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { WalletSessionRequest } from "../middleware/requireWalletSession.js";
import { ensureWalletRoleByHash } from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

type WalletSession = NonNullable<WalletSessionRequest["walletSession"]>;

const tierSchema = z.object({
  tierName: z.string().min(2).max(60),
  priceMicrocredits: z.coerce.bigint().nonnegative(),
  description: z.string().max(500).optional(),
  benefits: z.array(z.string().min(1).max(120)).max(12).default([]),
});

const tierUpdateSchema = tierSchema.partial().extend({
  tierName: z.string().min(2).max(60).optional(),
});

const listByCreatorSchema = z.object({
  handle: z.string().min(3),
});

const serializeTier = (tier: {
  id: string;
  tierName: string;
  priceMicrocredits: bigint;
  description: string | null;
  benefits: string[];
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: tier.id,
  tierName: tier.tierName,
  priceMicrocredits: tier.priceMicrocredits.toString(),
  description: tier.description,
  benefits: tier.benefits ?? [],
  createdAt: tier.createdAt.toISOString(),
  updatedAt: tier.updatedAt.toISOString(),
});

const normalizeWalletAddress = (walletAddress?: string | null): string =>
  walletAddress?.trim().toLowerCase() ?? "";

const findCreatorForSession = async (session: WalletSession): Promise<{
  id: string;
  walletHash: string;
  walletAddress: string;
} | null> => {
  const creatorByHash = await prisma.creator.findUnique({
    where: { walletHash: session.wh },
    select: { id: true, walletHash: true, walletAddress: true },
  });
  if (creatorByHash) {
    return creatorByHash;
  }

  const address = normalizeWalletAddress(session.addr);
  if (!address) {
    return null;
  }

  const creatorByAddress = await prisma.creator.findFirst({
    where: { walletAddress: { equals: address, mode: "insensitive" } },
    select: { id: true, walletHash: true, walletAddress: true },
  });
  if (!creatorByAddress) {
    return null;
  }

  try {
    const updated = await prisma.creator.update({
      where: { id: creatorByAddress.id },
      data: {
        walletHash: session.wh,
        walletAddress: session.addr ?? creatorByAddress.walletAddress,
      },
      select: { id: true, walletHash: true, walletAddress: true },
    });
    return updated;
  } catch {
    return creatorByAddress;
  }
};

const isSessionOwner = (creator: { walletHash: string; walletAddress: string }, session: WalletSession): boolean => {
  if (creator.walletHash === session.wh) {
    return true;
  }
  const address = normalizeWalletAddress(session.addr);
  return address.length > 0 && normalizeWalletAddress(creator.walletAddress) === address;
};

const syncCreatorPricing = async (creatorId: string): Promise<void> => {
  const minPrice = await prisma.subscriptionTier.aggregate({
    where: { creatorId },
    _min: { priceMicrocredits: true },
  });

  await prisma.creator.update({
    where: { id: creatorId },
    data: { subscriptionPriceMicrocredits: minPrice._min.priceMicrocredits ?? 0n },
  });
};

export const listSubscriptionTiersByCreator = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = listByCreatorSchema.parse(req.params);
    const creator = await prisma.creator.findUnique({
      where: { handle: payload.handle.toLowerCase() },
      select: { id: true },
    });

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const tiers = await prisma.subscriptionTier.findMany({
      where: { creatorId: creator.id },
      orderBy: { priceMicrocredits: "asc" },
    });

    res.json({ tiers: tiers.map((tier) => serializeTier(tier)) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const listMySubscriptionTiers = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const creator = await findCreatorForSession(session);

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const tiers = await prisma.subscriptionTier.findMany({
      where: { creatorId: creator.id },
      orderBy: { priceMicrocredits: "asc" },
    });

    res.json({ tiers: tiers.map((tier) => serializeTier(tier)) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const createSubscriptionTier = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = tierSchema.parse(req.body);
    await ensureWalletRoleByHash(session.wh, "CREATOR");

    const creator = await findCreatorForSession(session);

    if (!creator) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }

    const tier = await prisma.subscriptionTier.create({
      data: {
        creatorId: creator.id,
        tierName: payload.tierName.trim(),
        priceMicrocredits: payload.priceMicrocredits,
        description: payload.description,
        benefits: payload.benefits ?? [],
      },
    });

    await syncCreatorPricing(creator.id);

    res.json({ tier: serializeTier(tier) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const updateSubscriptionTier = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const payload = tierUpdateSchema.parse(req.body);
    const tierId = String(req.params.id ?? "").trim();
    if (!tierId) {
      res.status(400).json({ error: "Missing tier id" });
      return;
    }

    const tier = await prisma.subscriptionTier.findUnique({
      where: { id: tierId },
      select: { id: true, creatorId: true, creator: { select: { walletHash: true, walletAddress: true } } },
    });

    if (!tier) {
      res.status(404).json({ error: "Tier not found" });
      return;
    }

    if (!isSessionOwner(tier.creator, session)) {
      res.status(403).json({ error: "Not authorized to update this tier" });
      return;
    }

    const updated = await prisma.subscriptionTier.update({
      where: { id: tier.id },
      data: {
        tierName: payload.tierName?.trim(),
        priceMicrocredits: payload.priceMicrocredits,
        description: payload.description,
        benefits: payload.benefits,
      },
    });

    await syncCreatorPricing(tier.creatorId);

    res.json({ tier: serializeTier(updated) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};

export const deleteSubscriptionTier = async (req: WalletSessionRequest, res: Response): Promise<void> => {
  try {
    const session = req.walletSession;
    if (!session) {
      res.status(401).json({ error: "Missing wallet session" });
      return;
    }

    const tierId = String(req.params.id ?? "").trim();
    if (!tierId) {
      res.status(400).json({ error: "Missing tier id" });
      return;
    }

    const tier = await prisma.subscriptionTier.findUnique({
      where: { id: tierId },
      select: { id: true, creatorId: true, creator: { select: { walletHash: true, walletAddress: true } } },
    });

    if (!tier) {
      res.status(404).json({ error: "Tier not found" });
      return;
    }

    if (!isSessionOwner(tier.creator, session)) {
      res.status(403).json({ error: "Not authorized to delete this tier" });
      return;
    }

    await prisma.subscriptionTier.delete({ where: { id: tier.id } });
    await syncCreatorPricing(tier.creatorId);

    res.json({ ok: true, tierId: tier.id });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({ error: DB_UNAVAILABLE_MESSAGE, code: DB_UNAVAILABLE_CODE });
      return;
    }
    res.status(400).json({ error: (error as Error).message });
  }
};
