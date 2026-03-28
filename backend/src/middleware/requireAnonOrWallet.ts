import type { NextFunction, Request, Response } from "express";
import {
  AnonymousSessionExpiredError,
  AnonymousSessionNotFoundError,
  normalizeAnonymousSessionId,
  resolveActiveAnonSession,
  type ActiveAnonSession,
} from "../services/anonymousSessionService.js";
import { validateWalletSessionToken } from "../services/walletSessionService.js";
import { ExplorerRequestError } from "../services/aleoExplorerService.js";

export interface AnonOrWalletRequest extends Request {
  anonSession?: ActiveAnonSession;
  walletSession?: ReturnType<typeof validateWalletSessionToken>;
  isAnonymous?: boolean;
}

export const requireAnonOrWallet = async (
  req: AnonOrWalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const anonSessionId = normalizeAnonymousSessionId(req.header("X-Anonymous-Session"));

  if (anonSessionId) {
    try {
      const { session } = await resolveActiveAnonSession(anonSessionId);
      req.anonSession = session;
      req.isAnonymous = true;
      next();
      return;
    } catch (error) {
      if (error instanceof AnonymousSessionNotFoundError) {
        res.status(401).json({ error: "Anonymous session not found" });
        return;
      }

      if (error instanceof AnonymousSessionExpiredError) {
        res.status(401).json({ error: "Anonymous session expired" });
        return;
      }

      if (error instanceof ExplorerRequestError) {
        res.status(502).json({ error: "Failed to verify Aleo block height" });
        return;
      }

      res.status(500).json({ error: (error as Error).message });
      return;
    }
  }

  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!token) {
      res.status(401).json({ error: "Missing wallet session token" });
      return;
    }

    req.walletSession = validateWalletSessionToken(token);
    req.isAnonymous = false;
    next();
  } catch (error) {
    res.status(401).json({ error: (error as Error).message });
  }
};
