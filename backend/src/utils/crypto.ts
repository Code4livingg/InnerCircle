import { createHash } from "node:crypto";

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const b64ToBuffer = (value: string): Buffer =>
  Buffer.from(value, "base64");

export const bufferToB64 = (value: Buffer): string =>
  value.toString("base64");