"use client";

import type { WalletContextState } from "@/lib/walletContext";
import { createWalletSession } from "./api";
import { signAleoWalletMessage } from "./walletSignature";

interface StoredWalletSession {
  token: string;
  expiresAt: number;
}

const SESSION_KEY_PREFIX = "innercircle_wallet_session_v1:";

const storageKeyForWallet = (walletAddress: string): string =>
  `${SESSION_KEY_PREFIX}${walletAddress.trim().toLowerCase()}`;

const readStoredSession = (walletAddress: string): StoredWalletSession | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(storageKeyForWallet(walletAddress));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWalletSession>;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }

    if (parsed.expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      window.sessionStorage.removeItem(storageKeyForWallet(walletAddress));
      return null;
    }

    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
};

const persistSession = (walletAddress: string, session: StoredWalletSession): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(storageKeyForWallet(walletAddress), JSON.stringify(session));
};

const buildWalletSessionMessage = (walletAddress: string): string => {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return [
    "InnerCircle wallet session",
    `wallet:${walletAddress}`,
    `ts:${Date.now()}`,
    `nonce:${nonce}`,
  ].join("\n");
};

export const clearWalletSessionToken = (walletAddress?: string | null): void => {
  if (typeof window === "undefined" || !walletAddress) {
    return;
  }

  window.sessionStorage.removeItem(storageKeyForWallet(walletAddress));
};

export const getWalletSessionToken = async (wallet: WalletContextState): Promise<string> => {
  if (!wallet.connected || !wallet.address) {
    throw new Error("Connect your Aleo wallet first.");
  }

  const stored = readStoredSession(wallet.address);
  if (stored) {
    return stored.token;
  }

  const message = buildWalletSessionMessage(wallet.address);
  const signature = await signAleoWalletMessage(wallet, message);
  const session = await createWalletSession(wallet.address, message, signature);
  persistSession(wallet.address, {
    token: session.token,
    expiresAt: session.expiresAt,
  });

  return session.token;
};
