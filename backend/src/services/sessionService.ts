import { randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";
import type { AccessScope, SessionClaims } from "../types/session.js";

export interface CreateSessionInput {
  // `identitySeed` is the already-verified wallet identity input. We derive an
  // unlinkable per-session subject from it instead of reusing the stable hash.
  identitySeed: string;
  anonymousSessionId?: string;
  scope: AccessScope;
}

export interface SessionTokenResult {
  token: string;
  sessionId: string;
  expiresAt: number;
}

export const createSessionSubject = (identitySeed: string, sessionId: string): string => {
  const salt = randomBytes(16).toString("hex");
  return sha256Hex(`${identitySeed}:${sessionId}:${salt}:${env.sessionSecret}`);
};

export const createSessionToken = ({ identitySeed, anonymousSessionId, scope }: CreateSessionInput): SessionTokenResult => {
  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + env.sessionTtlSeconds;
  const sessionSubject = createSessionSubject(identitySeed, sessionId);

  const token = jwt.sign(
    {
      sid: sessionId,
      // `wh` is kept for backward compatibility with existing middleware, but
      // new access sessions carry the unlinkable session subject here.
      wh: sessionSubject,
      ssh: sessionSubject,
      ...(anonymousSessionId ? { aid: anonymousSessionId } : {}),
      scope,
      exp: expiresAt,
    },
    env.sessionSecret,
  );

  return { token, sessionId, expiresAt };
};

export const validateSessionToken = (token: string): SessionClaims => {
  return jwt.verify(token, env.sessionSecret) as SessionClaims;
};
