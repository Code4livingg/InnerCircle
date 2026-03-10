import { randomBytes } from "node:crypto";

// Generates a safe decimal field literal string, e.g. "123...field".
// We keep it < 2^248 to avoid any field modulus edge cases.
export const randomFieldLiteral = (): string => {
  const bytes = randomBytes(31);
  const hex = bytes.toString("hex");
  const value = BigInt(`0x${hex}`);
  return `${value}field`;
};

