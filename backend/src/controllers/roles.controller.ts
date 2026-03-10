import { z } from "zod";
import type { Request, Response } from "express";
import {
  ensureWalletRoleByAddress,
  fromClientRole,
  getWalletRoleByAddress,
  toClientRole,
  WalletRoleConflictError,
} from "../services/walletRoleService.js";
import { DB_UNAVAILABLE_CODE, DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const roleLookupSchema = z.object({
  walletAddress: z.string().min(10),
});

const claimRoleSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.enum(["user", "creator"]),
});

export const getWalletRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = roleLookupSchema.parse(req.params);
    const role = await getWalletRoleByAddress(payload.walletAddress);
    res.json({
      role: role ? toClientRole(role) : null,
      locked: Boolean(role),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};

export const claimWalletRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = claimRoleSchema.parse(req.body);
    const requestedRole = fromClientRole(payload.role);
    await ensureWalletRoleByAddress(payload.walletAddress, requestedRole);
    res.json({
      role: payload.role,
      locked: true,
    });
  } catch (error) {
    if (error instanceof WalletRoleConflictError) {
      res.status(409).json({
        error: `This wallet is already locked as ${toClientRole(error.existingRole)}. Use a different wallet for ${toClientRole(error.requestedRole)} actions.`,
        code: "ROLE_CONFLICT",
        existingRole: toClientRole(error.existingRole),
        requestedRole: toClientRole(error.requestedRole),
      });
      return;
    }

    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        error: DB_UNAVAILABLE_MESSAGE,
        code: DB_UNAVAILABLE_CODE,
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message });
  }
};
