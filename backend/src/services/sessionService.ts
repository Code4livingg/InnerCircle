import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AccessScope, SessionClaims } from "../types/session.js";

export interface CreateSessionInput {
  walletHash: string;
  scope: AccessScope;
}

export interface SessionTokenResult {
  token: string;
  sessionId: string;
  expiresAt: number;
}

export const createSessionToken = ({ walletHash, scope }: CreateSessionInput): SessionTokenResult => {
  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + env.sessionTtlSeconds;

  const token = jwt.sign(
    {
      sid: sessionId,
      wh: walletHash,
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