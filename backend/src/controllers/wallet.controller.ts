import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyAleoWalletSignature } from "../services/walletSignatureService.js";

const verifySignatureSchema = z.object({
  walletAddress: z.string().regex(/^aleo1[0-9a-z]{20,}$/i),
  message: z.string().min(1),
  signature: z.string().min(1),
});

export const verifyWalletSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = verifySignatureSchema.parse(req.body);
    const valid = await verifyAleoWalletSignature(
      payload.walletAddress,
      payload.message,
      payload.signature,
    );

    res.json({
      valid,
      network: "aleo",
      aleoNetwork: env.aleoNetwork,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};
