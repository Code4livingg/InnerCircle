const SESSION_ID_KEY = "innercircle_anon_session_v1";
const ANON_MODE_KEY = "innercircle_anon_mode_v1";

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

export const getOrCreateSessionId = (): string => {
  const storage = getStorage();
  if (!storage) return "";

  let sessionId = storage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = globalThis.crypto.randomUUID();
    storage.setItem(SESSION_ID_KEY, sessionId);
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
};

export const onAnonymousModeChange = (handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: StorageEvent) => {
    if (event.key === ANON_MODE_KEY || event.key === SESSION_ID_KEY) {
      handler();
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};
