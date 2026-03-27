const hasAtob = typeof atob === "function";
const hasBtoa = typeof btoa === "function";

const atobShim = (value: string): string => {
  if (hasAtob) {
    return atob(value);
  }
  return Buffer.from(value, "base64").toString("binary");
};

const btoaShim = (value: string): string => {
  if (hasBtoa) {
    return btoa(value);
  }
  return Buffer.from(value, "binary").toString("base64");
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoaShim(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atobShim(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const utf8ToBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

export const bytesToUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
