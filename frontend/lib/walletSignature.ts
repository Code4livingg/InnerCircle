"use client";

import type { WalletContextState } from "@/lib/walletContext";

type SignerAccount = {
  sign: (message: Uint8Array) => unknown;
};

type SignerLike = {
  signMessage?: (message: Uint8Array | string) => unknown;
  account?: SignerAccount;
  wallet?: {
    account?: SignerAccount;
    signMessage?: (message: Uint8Array | string) => unknown;
  };
};

const extractSignatureString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (value instanceof Uint8Array) {
    const decoded = new TextDecoder().decode(value).trim();
    return decoded.length > 0 ? decoded : undefined;
  }

  if (value instanceof ArrayBuffer) {
    const decoded = new TextDecoder().decode(new Uint8Array(value)).trim();
    return decoded.length > 0 ? decoded : undefined;
  }

  if (ArrayBuffer.isView(value)) {
    const decoded = new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).trim();
    return decoded.length > 0 ? decoded : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const nestedSignature = extractSignatureString(record.signature);
  if (nestedSignature) {
    return nestedSignature;
  }

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

  add(wallet);
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

const trySignWithMethod = async (
  target: unknown,
  method: unknown,
  message: string,
  messageBytes: Uint8Array,
): Promise<string | undefined> => {
  if (typeof method !== "function") {
    return undefined;
  }

  for (const payload of [messageBytes, message]) {
    try {
      const result = await Promise.resolve(method.call(target, payload));
      const signature = extractSignatureString(result);
      if (signature) {
        return signature;
      }
    } catch {
      continue;
    }
  }

  return undefined;
};

export const signAleoWalletMessage = async (
  wallet: WalletContextState,
  message: string,
): Promise<string> => {
  const messageBytes = new TextEncoder().encode(message);

  for (const candidate of getSignerCandidates(wallet)) {
    const directSignature = await trySignWithMethod(candidate, candidate.signMessage, message, messageBytes);
    if (directSignature) {
      return directSignature;
    }

    const nestedSignature = await trySignWithMethod(
      candidate.wallet,
      candidate.wallet?.signMessage,
      message,
      messageBytes,
    );
    if (nestedSignature) {
      return nestedSignature;
    }

    const signer = candidate.account ?? candidate.wallet?.account;
    if (!signer || typeof signer.sign !== "function") {
      continue;
    }

    try {
      const result = await Promise.resolve(signer.sign(messageBytes));
      const signature = extractSignatureString(result);
      if (signature) {
        return signature;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Selected wallet does not support Aleo message signing.");
};
