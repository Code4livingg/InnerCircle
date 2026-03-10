import { randomBytes, createCipheriv, createDecipheriv, createHmac, createHash } from "node:crypto";
import { env } from "../config/env.js";
import { b64ToBuffer, bufferToB64 } from "../utils/crypto.js";

const ALGO = "aes-256-gcm";

const readMasterKey = (): Buffer => {
  const key = b64ToBuffer(env.masterKeyBase64);
  if (key.length !== 32) {
    throw new Error("MASTER_KEY_BASE64 must decode to 32 bytes for AES-256-GCM");
  }
  return key;
};

export interface CipherPackage {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface SerializedCipherPackage {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}

export const encryptBuffer = (plaintext: Buffer, key: Buffer): CipherPackage => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
};

export const decryptBuffer = ({ ciphertext, iv, authTag }: CipherPackage, key: Buffer): Buffer => {
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

export const serializeCipherPackage = (pkg: CipherPackage): SerializedCipherPackage => ({
  ciphertextB64: bufferToB64(pkg.ciphertext),
  ivB64: bufferToB64(pkg.iv),
  authTagB64: bufferToB64(pkg.authTag),
});

export const deserializeCipherPackage = (pkg: SerializedCipherPackage): CipherPackage => ({
  ciphertext: b64ToBuffer(pkg.ciphertextB64),
  iv: b64ToBuffer(pkg.ivB64),
  authTag: b64ToBuffer(pkg.authTagB64),
});

export const generateContentKey = (): Buffer => randomBytes(32);

export const wrapContentKey = (contentKey: Buffer): SerializedCipherPackage => {
  const masterKey = readMasterKey();
  return serializeCipherPackage(encryptBuffer(contentKey, masterKey));
};

export const unwrapContentKey = (wrapped: SerializedCipherPackage): Buffer => {
  const masterKey = readMasterKey();
  return decryptBuffer(deserializeCipherPackage(wrapped), masterKey);
};

export const deriveSessionStreamKey = (
  contentKey: Buffer,
  sessionId: string,
  contentId: string,
  expiresAt: number,
): Buffer => {
  const context = `${sessionId}:${contentId}:${expiresAt}`;
  const digest = createHmac("sha256", contentKey).update(context).digest();
  return createHash("sha256").update(digest).digest().subarray(0, 32);
};