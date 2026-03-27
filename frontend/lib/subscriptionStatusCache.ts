export interface CachedSubscriptionStatus {
  active: boolean;
  activeUntil: string | null;
  tierName: string | null;
  tierId: string | null;
  tierPriceMicrocredits: string | null;
}

const SUBSCRIPTION_STATUS_CACHE_PREFIX = "innercircle_subscription_status_v1";

const subscriptionStatusCacheKey = (creatorHandle: string, walletAddress: string): string =>
  `${SUBSCRIPTION_STATUS_CACHE_PREFIX}:${creatorHandle}:${walletAddress.trim().toLowerCase()}`;

export const readCachedSubscriptionStatus = (
  creatorHandle: string,
  walletAddress: string,
): CachedSubscriptionStatus | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(subscriptionStatusCacheKey(creatorHandle, walletAddress));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedSubscriptionStatus>;
    return {
      active: Boolean(parsed.active),
      activeUntil: typeof parsed.activeUntil === "string" ? parsed.activeUntil : null,
      tierName: typeof parsed.tierName === "string" ? parsed.tierName : null,
      tierId: typeof parsed.tierId === "string" ? parsed.tierId : null,
      tierPriceMicrocredits:
        typeof parsed.tierPriceMicrocredits === "string" ? parsed.tierPriceMicrocredits : null,
    };
  } catch {
    return null;
  }
};

export const persistSubscriptionStatus = (
  creatorHandle: string,
  walletAddress: string,
  value: CachedSubscriptionStatus,
): void => {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(subscriptionStatusCacheKey(creatorHandle, walletAddress), JSON.stringify(value));
};

export const clearCachedSubscriptionStatus = (creatorHandle: string, walletAddress: string): void => {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(subscriptionStatusCacheKey(creatorHandle, walletAddress));
};
