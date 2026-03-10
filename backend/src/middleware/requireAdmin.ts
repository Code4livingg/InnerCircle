import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.header("x-admin-key");
  if (!env.adminApiKey) {
    res.status(503).json({ error: "Admin API is not configured" });
    return;
  }

  if (!key || key !== env.adminApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};

