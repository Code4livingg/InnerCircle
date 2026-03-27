const SUBSCRIPTION_TERM_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SUBSCRIPTION_BLOCKS = 15_000;
const APPROX_BLOCK_DURATION_MS = Math.floor(SUBSCRIPTION_TERM_MS / DEFAULT_SUBSCRIPTION_BLOCKS);
const PREMIUM_TIER_THRESHOLD_MICROCREDITS = 1_000_000_000n;

export const getSubscriptionActiveUntil = (verifiedAt: Date, explicitExpiresAt?: Date | null): Date =>
  explicitExpiresAt ?? new Date(verifiedAt.getTime() + SUBSCRIPTION_TERM_MS);

export const isSubscriptionActive = (
  verifiedAt: Date,
  now: Date = new Date(),
  explicitExpiresAt?: Date | null,
): boolean =>
  getSubscriptionActiveUntil(verifiedAt, explicitExpiresAt).getTime() > now.getTime();

export const approximateExpiryDateFromBlockHeights = (
  currentBlock: number,
  expiresAtBlock: number,
  now: Date = new Date(),
): Date => {
  const remainingBlocks = Math.max(expiresAtBlock - currentBlock, 0);
  return new Date(now.getTime() + remainingBlocks * APPROX_BLOCK_DURATION_MS);
};

export const tierFromPriceMicrocredits = (priceMicrocredits?: bigint | null): 1 | 2 => {
  if (typeof priceMicrocredits !== "bigint") {
    return 1;
  }

  return priceMicrocredits >= PREMIUM_TIER_THRESHOLD_MICROCREDITS ? 2 : 1;
};

export const premiumTierThresholdMicrocredits = (): bigint => PREMIUM_TIER_THRESHOLD_MICROCREDITS;
