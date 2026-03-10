import type { Request, Response } from "express";
import { z } from "zod";
import { getAgeStatus, setTraditionalKycAgeStatus, setZkCredentialAgeStatus } from "../services/ageVerificationService.js";

const kycSchema = z.object({
  walletAddress: z.string().min(10),
  providerAttestationId: z.string().min(4),
  isOver18: z.coerce.boolean(),
});

const zkSchema = z.object({
  walletAddress: z.string().min(10),
  zkCredentialId: z.string().min(4),
  proof: z.string().min(8),
});

export const attestKyc = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = kycSchema.parse(req.body);
    const status = await setTraditionalKycAgeStatus(payload.walletAddress, payload.providerAttestationId, payload.isOver18);
    res.json({ status });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const attestZk = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = zkSchema.parse(req.body);
    const status = await setZkCredentialAgeStatus(payload.walletAddress, payload.zkCredentialId, payload.proof);
    res.json({ status });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};

export const status = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.query.walletAddress ?? "").trim();
  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress is required" });
    return;
  }

  const ageStatus = await getAgeStatus(walletAddress);
  res.json({ status: ageStatus });
};

