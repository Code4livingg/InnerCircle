import { generateKeypair, type KeyPairB64 } from "@/lib/crypto/nacl";
import { getOrCreateSessionId } from "@/features/anonymous/storage";

const KEYPAIR_PREFIX = "innercircle_e2e_keypair_v1:";

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

export const getOrCreateKeypair = (sessionId?: string): KeyPairB64 => {
  const storage = getStorage();
  if (!storage) {
    return generateKeypair();
  }

  const resolvedSessionId = sessionId ?? getOrCreateSessionId();
  const key = `${KEYPAIR_PREFIX}${resolvedSessionId}`;
  const existing = storage.getItem(key);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as KeyPairB64;
      if (parsed.publicKeyB64 && parsed.privateKeyB64) {
        return parsed;
      }
    } catch {
      // ignore malformed entry
    }
  }

  const next = generateKeypair();
  storage.setItem(key, JSON.stringify(next));
  return next;
};
