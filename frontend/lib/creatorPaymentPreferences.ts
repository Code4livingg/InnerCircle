import type { CreatorPaymentAsset, CreatorPaymentVisibility } from "./api";

const STORAGE_PREFIX = "innercircle_creator_payment_preferences_";
const ALLOWED_ASSETS: CreatorPaymentAsset[] = ["ALEO_CREDITS", "USDCX"];
const ALLOWED_VISIBILITIES: CreatorPaymentVisibility[] = ["PUBLIC", "PRIVATE"];

interface StoredCreatorPaymentPreferences {
  acceptedPaymentAssets: CreatorPaymentAsset[];
  acceptedPaymentVisibilities: CreatorPaymentVisibility[];
}

const sanitizeAssets = (values: CreatorPaymentAsset[] | string[] | undefined): CreatorPaymentAsset[] => {
  const normalized = (values ?? ["ALEO_CREDITS"])
    .map((value) => String(value).trim().toUpperCase())
    .filter((value): value is CreatorPaymentAsset => ALLOWED_ASSETS.includes(value as CreatorPaymentAsset));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["ALEO_CREDITS"];
};

const sanitizeVisibilities = (
  values: CreatorPaymentVisibility[] | string[] | undefined,
): CreatorPaymentVisibility[] => {
  const normalized = (values ?? ["PUBLIC", "PRIVATE"])
    .map((value) => String(value).trim().toUpperCase())
    .filter((value): value is CreatorPaymentVisibility =>
      ALLOWED_VISIBILITIES.includes(value as CreatorPaymentVisibility),
    );

  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["PUBLIC", "PRIVATE"];
};

const storageKey = (handle: string): string => `${STORAGE_PREFIX}${handle.trim().toLowerCase()}`;

export const readStoredCreatorPaymentPreferences = (
  handle?: string | null,
): StoredCreatorPaymentPreferences | null => {
  if (typeof window === "undefined" || !handle?.trim()) {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey(handle));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCreatorPaymentPreferences>;
    return {
      acceptedPaymentAssets: sanitizeAssets(parsed.acceptedPaymentAssets),
      acceptedPaymentVisibilities: sanitizeVisibilities(parsed.acceptedPaymentVisibilities),
    };
  } catch {
    return null;
  }
};

export const storeCreatorPaymentPreferences = (
  handle: string,
  acceptedPaymentAssets: CreatorPaymentAsset[],
  acceptedPaymentVisibilities: CreatorPaymentVisibility[],
): void => {
  if (typeof window === "undefined" || !handle.trim()) {
    return;
  }

  const payload: StoredCreatorPaymentPreferences = {
    acceptedPaymentAssets: sanitizeAssets(acceptedPaymentAssets),
    acceptedPaymentVisibilities: sanitizeVisibilities(acceptedPaymentVisibilities),
  };

  window.localStorage.setItem(storageKey(handle), JSON.stringify(payload));
};
