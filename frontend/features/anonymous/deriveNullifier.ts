"use client";

interface DeriveInvoiceNullifierInput {
  circleId: string;
  tier: number;
  expiresAtBlock: number;
  subscriberSeed: string;
}

const normalizeCircleId = (value: string): string => value.trim().replace(/field$/i, "");

const bytesToHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function deriveInvoiceNullifier(invoice: DeriveInvoiceNullifierInput): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this environment.");
  }

  const payload = JSON.stringify({
    circleId: normalizeCircleId(invoice.circleId),
    tier: invoice.tier,
    expiresAtBlock: invoice.expiresAtBlock,
    subscriberSeed: invoice.subscriberSeed.trim().toLowerCase(),
  });

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return bytesToHex(digest);
}
