const SUBSCRIPTION_TERM_MS = 30 * 24 * 60 * 60 * 1000;

export const getSubscriptionActiveUntil = (verifiedAt: Date): Date =>
  new Date(verifiedAt.getTime() + SUBSCRIPTION_TERM_MS);

export const isSubscriptionActive = (verifiedAt: Date, now: Date = new Date()): boolean =>
  getSubscriptionActiveUntil(verifiedAt).getTime() > now.getTime();
