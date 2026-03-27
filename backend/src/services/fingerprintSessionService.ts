import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";

export interface FingerprintSessionRecord {
  sessionId: string;
  fingerprint: string;
  walletHash: string;
  sessionSubject: string;
  shortWallet: string;
  contentId: string;
  accessSessionId: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreateFingerprintSessionInput {
  sessionSubject: string;
  contentId: string;
  accessSessionId: string;
}

const fingerprintSessionStore = new Map<string, FingerprintSessionRecord>();
const FINGERPRINT_SESSION_TTL_MS = env.fingerprintSessionTtlSeconds * 1000;
const FINGERPRINT_SWEEP_INTERVAL_MS = Math.min(FINGERPRINT_SESSION_TTL_MS, 5 * 60 * 1000);

const pruneExpiredFingerprintSessions = (): void => {
  const now = Date.now();

  for (const [sessionId, record] of fingerprintSessionStore.entries()) {
    if (record.expiresAt <= now) {
      fingerprintSessionStore.delete(sessionId);
    }
  }
};

const fingerprintSweepTimer = setInterval(pruneExpiredFingerprintSessions, FINGERPRINT_SWEEP_INTERVAL_MS);
fingerprintSweepTimer.unref();

const generateShortSessionId = (): string => {
  let nextId = randomBytes(2).toString("hex").toUpperCase();

  while (fingerprintSessionStore.has(nextId)) {
    nextId = randomBytes(2).toString("hex").toUpperCase();
  }

  return nextId;
};

const anonymizeSubject = (sessionSubject: string): string => {
  const normalized = sessionSubject.trim().toLowerCase();
  const hash = sha256Hex(normalized).slice(0, 6).toUpperCase();
  return `Anon_${hash}`;
};

export const generateSessionFingerprint = (sessionSubject: string): string => {
  const timestamp = Date.now().toString();
  const randomNonce = randomBytes(16).toString("hex");

  return sha256Hex(`${sessionSubject.trim().toLowerCase()}:${timestamp}:${randomNonce}:${env.sessionSecret}`)
    .slice(0, 8)
    .toUpperCase();
};

export const createFingerprintSession = ({
  sessionSubject,
  contentId,
  accessSessionId,
}: CreateFingerprintSessionInput): FingerprintSessionRecord => {
  pruneExpiredFingerprintSessions();

  const createdAt = Date.now();
  const record: FingerprintSessionRecord = {
    sessionId: generateShortSessionId(),
    fingerprint: generateSessionFingerprint(sessionSubject),
    // Keep the legacy field populated for compatibility, but store the new
    // unlinkable session subject instead of the stable wallet hash.
    walletHash: sessionSubject,
    sessionSubject,
    shortWallet: anonymizeSubject(sessionSubject),
    contentId,
    accessSessionId,
    createdAt,
    expiresAt: createdAt + FINGERPRINT_SESSION_TTL_MS,
  };

  fingerprintSessionStore.set(record.sessionId, record);
  return record;
};

export const getFingerprintSession = (sessionId: string): FingerprintSessionRecord | null => {
  pruneExpiredFingerprintSessions();
  return fingerprintSessionStore.get(sessionId) ?? null;
};
