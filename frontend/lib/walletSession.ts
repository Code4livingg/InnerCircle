"use client";

import type { WalletContextState } from "@/lib/walletContext";
import { ApiError, createWalletSession } from "./api";
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

const buildWalletSessionMessage = (walletAddress: string, prefix: string): string => {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return [
    prefix,
    `wallet:${walletAddress}`,
    `ts:${Date.now()}`,
    `nonce:${nonce}`,
  ].join("\n");
};

const requestWalletSession = async (wallet: WalletContextState, prefix: string): Promise<StoredWalletSession> => {
  const message = buildWalletSessionMessage(wallet.address!, prefix);
  const signature = await signAleoWalletMessage(wallet, message);
  const session = await createWalletSession(wallet.address!, message, signature);
  return {
    token: session.token,
    expiresAt: session.expiresAt,
  };
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

  try {
    const session = await requestWalletSession(wallet, "InnerCircle wallet session");
    persistSession(wallet.address, session);
    return session.token;
  } catch (error) {
    if (error instanceof ApiError && /invalid wallet session message prefix/i.test(error.message)) {
      const session = await requestWalletSession(wallet, "OnlyAleo wallet session");
      persistSession(wallet.address, session);
      return session.token;
    }
    throw error;
  }
};
