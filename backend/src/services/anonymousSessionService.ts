import { prisma } from "../db/prisma.js";
import { fetchLatestBlockHeight } from "./aleoExplorerService.js";

export interface ActiveAnonSession {
  sessionId: string;
  circleId: string;
  tier: number;
  expiresAtBlock: number;
}

export interface ResolvedAnonSession {
  session: ActiveAnonSession;
  currentBlock: number;
}

export class AnonymousSessionNotFoundError extends Error {
  constructor() {
    super("Anonymous session not found.");
    this.name = "AnonymousSessionNotFoundError";
  }
}

export class AnonymousSessionExpiredError extends Error {
  constructor() {
    super("Anonymous session expired.");
    this.name = "AnonymousSessionExpiredError";
  }
}

export const normalizeAnonymousSessionId = (value: string | undefined | null): string =>
  typeof value === "string" ? value.trim() : "";

export const resolveActiveAnonSession = async (sessionId: string): Promise<ResolvedAnonSession> => {
  const normalizedSessionId = normalizeAnonymousSessionId(sessionId);
  if (!normalizedSessionId) {
    throw new AnonymousSessionNotFoundError();
  }

  const rows = await prisma.$queryRaw<ActiveAnonSession[]>`
    SELECT
      "sessionId" AS "sessionId",
      "circleId" AS "circleId",
      "tier" AS "tier",
      "expiresAtBlock" AS "expiresAtBlock"
    FROM "anon_sessions"
    WHERE "sessionId" = ${normalizedSessionId}
    LIMIT 1
  `;
  const anonSession = rows[0];

  if (!anonSession) {
    throw new AnonymousSessionNotFoundError();
  }

  const currentBlock = await fetchLatestBlockHeight();
  if (anonSession.expiresAtBlock <= currentBlock) {
    throw new AnonymousSessionExpiredError();
  }

  return {
    session: anonSession,
    currentBlock,
  };
};
