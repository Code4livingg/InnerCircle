"use client";

import type { WalletContextState } from "@/lib/walletContext";

type SignerAccount = {
  sign: (message: Uint8Array) => unknown;
};

type SignerLike = {
  account?: SignerAccount;
  wallet?: { account?: SignerAccount };
};

const extractSignatureString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = record.to_string;
  if (typeof direct === "function") {
    const out = direct.call(value);
    if (typeof out === "string" && out.trim().length > 0) {
      return out.trim();
    }
  }

  const fallback = record.toString;
  if (typeof fallback === "function") {
    const out = fallback.call(value);
    if (typeof out === "string" && out.trim().length > 0 && out !== "[object Object]") {
      return out.trim();
    }
  }

  return undefined;
};

const getSignerCandidates = (wallet: WalletContextState): SignerLike[] => {
  const candidates: SignerLike[] = [];
  const seen = new Set<object>();

  const add = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const ref = candidate as object;
    if (seen.has(ref)) return;
    seen.add(ref);
    candidates.push(candidate as SignerLike);
  };

  add(wallet.wallet?.adapter);
  add((wallet.wallet?.adapter as Record<string, unknown> | undefined)?.["_shieldWallet"]);
  add((wallet.wallet?.adapter as Record<string, unknown> | undefined)?.["_leoWallet"]);
  add((wallet.wallet?.adapter as Record<string, unknown> | undefined)?.["_foxWallet"]);
  add((wallet.wallet?.adapter as Record<string, unknown> | undefined)?.["_puzzleWallet"]);

  if (typeof window !== "undefined") {
    const win = window as typeof window & {
      shield?: unknown;
      shieldWallet?: unknown;
      shieldwallet?: { aleo?: unknown } | unknown;
      leo?: unknown;
      leoWallet?: unknown;
      foxwallet?: { aleo?: unknown };
      puzzle?: unknown;
    };

    add(win.shield);
    add(win.shieldWallet);
    add(win.shieldwallet);
    add(typeof win.shieldwallet === "object" && win.shieldwallet && "aleo" in (win.shieldwallet as object)
      ? (win.shieldwallet as { aleo?: unknown }).aleo
      : undefined);
    add(win.leo);
    add(win.leoWallet);
    add(win.foxwallet?.aleo);
    add(win.puzzle);
  }

  return candidates;
};

export const signAleoWalletMessage = async (
  wallet: WalletContextState,
  message: string,
): Promise<string> => {
  const messageBytes = new TextEncoder().encode(message);

  for (const candidate of getSignerCandidates(wallet)) {
    const signer = candidate.account ?? candidate.wallet?.account;
    if (!signer || typeof signer.sign !== "function") {
      continue;
    }

    const result = await Promise.resolve(signer.sign(messageBytes));
    const signature = extractSignatureString(result);
    if (signature) {
      return signature;
    }
  }

  throw new Error("Selected wallet does not expose account.sign() for Aleo signatures.");
};
