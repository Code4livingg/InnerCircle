import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { createWalletSessionToken } from "../services/walletSessionService.js";
import { verifyAleoWalletSignature } from "../services/walletSignatureService.js";

const verifySignatureSchema = z.object({
  walletAddress: z.string().regex(/^aleo1[0-9a-z]{20,}$/i),
  message: z.string().min(1),
  signature: z.string().min(1),
});

const createWalletSessionSchema = verifySignatureSchema.extend({
  purpose: z.literal("wallet-session").optional(),
});

const WALLET_SESSION_MAX_AGE_MS = 5 * 60 * 1000;

const parseWalletSessionMessage = (message: string): { walletAddress: string; issuedAtMs: number; nonce: string } => {
  const lines = message.trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== "InnerCircle wallet session") {
    throw new Error("Invalid wallet session message prefix");
  }

  const walletLine = lines.find((line) => line.startsWith("wallet:"));
  const tsLine = lines.find((line) => line.startsWith("ts:"));
  const nonceLine = lines.find((line) => line.startsWith("nonce:"));

  if (!walletLine || !tsLine || !nonceLine) {
    throw new Error("Wallet session message is missing required fields");
  }

  const walletAddress = walletLine.slice("wallet:".length).trim();
  const issuedAtMs = Number(tsLine.slice("ts:".length).trim());
  const nonce = nonceLine.slice("nonce:".length).trim();

  if (!walletAddress || !Number.isFinite(issuedAtMs) || !nonce) {
    throw new Error("Wallet session message is invalid");
  }

  return {
    walletAddress,
    issuedAtMs,
    nonce,
  };
};

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

export const createWalletSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = createWalletSessionSchema.parse(req.body);
    const parsedMessage = parseWalletSessionMessage(payload.message);

    if (parsedMessage.walletAddress.toLowerCase() !== payload.walletAddress.toLowerCase()) {
      res.status(400).json({ error: "Wallet session message does not match wallet address." });
      return;
    }

    if (Date.now() - parsedMessage.issuedAtMs > WALLET_SESSION_MAX_AGE_MS) {
      res.status(401).json({ error: "Wallet session message expired. Sign a new one." });
      return;
    }

    const valid = await verifyAleoWalletSignature(
      payload.walletAddress,
      payload.message,
      payload.signature,
    );

    if (!valid) {
      res.status(401).json({ error: "Wallet signature is invalid." });
      return;
    }

    const session = createWalletSessionToken(payload.walletAddress);
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      walletHash: session.walletHash,
      network: "aleo",
      aleoNetwork: env.aleoNetwork,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
};
