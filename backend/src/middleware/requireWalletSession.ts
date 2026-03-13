import type { NextFunction, Request, Response } from "express";
import { validateWalletSessionToken } from "../services/walletSessionService.js";

export interface WalletSessionRequest extends Request {
  walletSession?: ReturnType<typeof validateWalletSessionToken>;
}

export const requireWalletSession = (req: WalletSessionRequest, res: Response, next: NextFunction): void => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!token) {
      res.status(401).json({ error: "Missing wallet session token" });
      return;
    }

    req.walletSession = validateWalletSessionToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: (error as Error).message });
  }
};
