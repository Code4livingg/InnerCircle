import type { Request, Response, NextFunction } from "express";
import { validateSessionToken } from "../services/sessionService.js";

export interface SessionRequest extends Request {
  session?: ReturnType<typeof validateSessionToken>;
}

export const requireSession = (req: SessionRequest, res: Response, next: NextFunction): void => {
  try {
    const header = req.headers.authorization;
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : queryToken;

    if (!token) {
      res.status(401).json({ error: "Missing access token" });
      return;
    }

    req.session = validateSessionToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: (error as Error).message });
  }
};
