const SESSION_ID_KEY = "innercircle_anon_session_v1";
const ANON_MODE_KEY = "innercircle_anon_mode_v1";
const ANON_REGISTRATION_PREFIX = "innercircle_anon_registered_v1:";
const ANON_REGISTRATION_STATUS_KEY = "innercircle_anon_registration_status_v1";
const ANON_STORAGE_EVENT = "innercircle:anon-storage-change";

export interface AnonymousRegistrationRecord {
  circleId: string;
  sessionId: string;
  nullifier: string;
  tier: number;
  expiresAtBlock: number;
  registeredAt: number;
}

export interface AnonymousRegistrationStatus {
  state: "active" | "inactive";
  message: string;
  updatedAt: number;
  activeCircleIds: string[];
}

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

const normalizeCircleId = (value: string): string => value.trim().replace(/field$/i, "");

const emitAnonymousStorageChange = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ANON_STORAGE_EVENT));
};

const registrationKey = (circleId: string): string =>
  `${ANON_REGISTRATION_PREFIX}${normalizeCircleId(circleId)}`;

export const getOrCreateSessionId = (): string => {
  const storage = getStorage();
  if (!storage) return "";

  let sessionId = storage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = globalThis.crypto.randomUUID();
    storage.setItem(SESSION_ID_KEY, sessionId);
    emitAnonymousStorageChange();
  }
  return sessionId;
};

export const readAnonymousMode = (): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(ANON_MODE_KEY) === "true";
};

export const writeAnonymousMode = (value: boolean): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ANON_MODE_KEY, value ? "true" : "false");
  emitAnonymousStorageChange();
};

export const persistAnonymousRegistration = (value: AnonymousRegistrationRecord): void => {
  const storage = getStorage();
  if (!storage) return;

  storage.setItem(
    registrationKey(value.circleId),
    JSON.stringify({
      ...value,
      circleId: normalizeCircleId(value.circleId),
    }),
  );
  emitAnonymousStorageChange();
};

export const readAnonymousRegistration = (circleId: string): AnonymousRegistrationRecord | null => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(registrationKey(circleId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AnonymousRegistrationRecord>;
    if (
      typeof parsed.circleId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.nullifier !== "string" ||
      typeof parsed.tier !== "number" ||
      typeof parsed.expiresAtBlock !== "number"
    ) {
      return null;
    }

    return {
      circleId: normalizeCircleId(parsed.circleId),
      sessionId: parsed.sessionId,
      nullifier: parsed.nullifier,
      tier: parsed.tier,
      expiresAtBlock: parsed.expiresAtBlock,
      registeredAt: typeof parsed.registeredAt === "number" ? parsed.registeredAt : Date.now(),
    };
  } catch {
    return null;
  }
};

export const clearAnonymousRegistration = (circleId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(registrationKey(circleId));
  // NOTE: intentionally no emitAnonymousStorageChange() here — this is called
  // from inside useAutoAnonRegistration's effect, and emitting would re-trigger
  // the listener that re-runs the effect, causing an infinite loop.
};

export const listAnonymousRegistrations = (): AnonymousRegistrationRecord[] => {
  const storage = getStorage();
  if (!storage) return [];

  const records: AnonymousRegistrationRecord[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(ANON_REGISTRATION_PREFIX)) {
      continue;
    }

    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<AnonymousRegistrationRecord>;
      if (
        typeof parsed.circleId !== "string" ||
        typeof parsed.sessionId !== "string" ||
        typeof parsed.nullifier !== "string" ||
        typeof parsed.tier !== "number" ||
        typeof parsed.expiresAtBlock !== "number"
      ) {
        continue;
      }

      records.push({
        circleId: normalizeCircleId(parsed.circleId),
        sessionId: parsed.sessionId,
        nullifier: parsed.nullifier,
        tier: parsed.tier,
        expiresAtBlock: parsed.expiresAtBlock,
        registeredAt: typeof parsed.registeredAt === "number" ? parsed.registeredAt : Date.now(),
      });
    } catch {
      // Ignore malformed storage entries.
    }
  }

  return records;
};

export const readAnonymousRegistrationStatus = (): AnonymousRegistrationStatus => {
  const storage = getStorage();
  if (!storage) {
    return {
      state: "inactive",
      message: "Anonymous browsing needs an active subscription.",
      updatedAt: 0,
      activeCircleIds: [],
    };
  }

  try {
    const raw = storage.getItem(ANON_REGISTRATION_STATUS_KEY);
    if (!raw) {
      return {
        state: "inactive",
        message: "Anonymous browsing needs an active subscription.",
        updatedAt: 0,
        activeCircleIds: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<AnonymousRegistrationStatus>;
    return {
      state: parsed.state === "active" ? "active" : "inactive",
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message
          : "Anonymous browsing needs an active subscription.",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      activeCircleIds: Array.isArray(parsed.activeCircleIds)
        ? parsed.activeCircleIds.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return {
      state: "inactive",
      message: "Anonymous browsing needs an active subscription.",
      updatedAt: 0,
      activeCircleIds: [],
    };
  }
};

export const writeAnonymousRegistrationStatus = (status: AnonymousRegistrationStatus): void => {
  const storage = getStorage();
  if (!storage) return;

  storage.setItem(ANON_REGISTRATION_STATUS_KEY, JSON.stringify(status));
  // NOTE: intentionally no emitAnonymousStorageChange() here — this is called
  // from inside useAutoAnonRegistration's effect, and emitting would re-trigger
  // the listener that re-runs the effect, causing an infinite loop.
};

export const onAnonymousModeChange = (handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;

  const listener = (event: StorageEvent) => {
    if (
      event.key === ANON_MODE_KEY ||
      event.key === SESSION_ID_KEY ||
      event.key === ANON_REGISTRATION_STATUS_KEY ||
      (typeof event.key === "string" && event.key.startsWith(ANON_REGISTRATION_PREFIX))
    ) {
      handler();
    }
  };

  const inPageListener = () => {
    handler();
  };

  window.addEventListener("storage", listener);
  window.addEventListener(ANON_STORAGE_EVENT, inPageListener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(ANON_STORAGE_EVENT, inPageListener);
  };
};
