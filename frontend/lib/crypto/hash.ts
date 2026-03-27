const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const sha256Bytes = async (value: string): Promise<Uint8Array> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API unavailable for sha256 hashing.");
  }

  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
};

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = await sha256Bytes(value);
  return toHex(bytes);
};
