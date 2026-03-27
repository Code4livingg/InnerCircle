import { readFile } from "node:fs/promises";
import { createSessionToken, validateSessionToken } from "./sessionService.js";
import { env } from "../config/env.js";
import {
  decryptBuffer,
  unwrapContentKey,
  type SerializedCipherPackage,
} from "./encryptionService.js";
import { applyInvisibleWatermark, buildWatermarkEvent, createWatermarkId } from "./watermarkService.js";

export interface StoredEncryptedContent {
  contentId: string;
  mimeType: string;
  sizeBytes: number;
  ciphertextPath: string;
  wrappedContentKey: SerializedCipherPackage;
  fileCipher: SerializedCipherPackage;
}

export interface StreamAccessGrant {
  streamToken: string;
  expiresAt: number;
}

export const issueStreamGrant = (walletHash: string, contentId: string): StreamAccessGrant => {
  const { token, expiresAt } = createSessionToken({
    identitySeed: walletHash,
    scope: { type: "ppv", contentId },
  });
  return { streamToken: token, expiresAt };
};

export const verifyStreamGrant = (token: string, walletHash: string, contentId: string): void => {
  const claims = validateSessionToken(token);

  if (claims.wh !== walletHash) {
    throw new Error("Stream token wallet mismatch");
  }

  if (claims.scope.type !== "ppv" || claims.scope.contentId !== contentId) {
    throw new Error("Stream token scope mismatch");
  }
};

export const decryptAndWatermarkRange = async (
  content: StoredEncryptedContent,
  walletHash: string,
  sessionId: string,
  expiresAt: number,
  start: number,
  end: number,
): Promise<{ chunk: Buffer; watermarkId: string; mimeType: string }> => {
  const encryptedBlob = await readFile(content.ciphertextPath);
  const contentKey = unwrapContentKey(content.wrappedContentKey);
  void expiresAt;

  // Decrypt entire object first in this skeleton. Production should decrypt segment-aware chunks.
  const plaintext = decryptBuffer(
    {
      ciphertext: encryptedBlob,
      iv: Buffer.from(content.fileCipher.ivB64, "base64"),
      authTag: Buffer.from(content.fileCipher.authTagB64, "base64"),
    },
    contentKey,
  );

  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(plaintext.length - 1, end);
  const chunk = plaintext.subarray(safeStart, safeEnd + 1);

  const watermarkId = createWatermarkId(walletHash, content.contentId, sessionId);
  const watermarkedChunk = applyInvisibleWatermark(chunk, watermarkId);
  const event = buildWatermarkEvent(walletHash, content.contentId, sessionId, watermarkId);
  console.log("watermark_event", event);

  return { chunk: watermarkedChunk, watermarkId, mimeType: content.mimeType };
};

export const streamTtl = (): number => env.streamTtlSeconds;
