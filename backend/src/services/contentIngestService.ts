import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { env } from "../config/env.js";
import type { SerializedCipherPackage } from "./encryptionService.js";
import { encryptBuffer, generateContentKey, serializeCipherPackage, wrapContentKey } from "./encryptionService.js";
import { objectStore } from "./objectStoreService.js";

export interface IngestChunkMeta {
  idx: number;
  objectKey: string;
  ivB64: string;
  authTagB64: string;
  ciphertextSizeBytes: number;
}

export interface IngestResult {
  sizeBytes: number;
  chunkSizeBytes: number;
  chunkCount: number;
  wrappedContentKey: SerializedCipherPackage;
  chunks: IngestChunkMeta[];
}

const chunkObjectKey = (contentId: string, idx: number): string => `content/${contentId}/chunks/${idx}.bin`;

export const ingestFileToEncryptedChunks = async (inputPath: string, contentId: string): Promise<IngestResult> => {
  const fileInfo = await stat(inputPath);
  const sizeBytes = fileInfo.size;
  const chunkSizeBytes = env.contentChunkSizeBytes;

  const contentKey = generateContentKey();
  const wrappedContentKey = wrapContentKey(contentKey);

  const readStream = createReadStream(inputPath, { highWaterMark: chunkSizeBytes });
  const chunks: IngestChunkMeta[] = [];

  let idx = 0;
  for await (const part of readStream) {
    const plaintext = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
    const encrypted = encryptBuffer(plaintext, contentKey);
    const objectKey = chunkObjectKey(contentId, idx);

    await objectStore.putObject(objectKey, encrypted.ciphertext);

    const serialized = serializeCipherPackage(encrypted);
    chunks.push({
      idx,
      objectKey,
      ivB64: serialized.ivB64,
      authTagB64: serialized.authTagB64,
      ciphertextSizeBytes: encrypted.ciphertext.length,
    });

    idx += 1;
  }

  return {
    sizeBytes,
    chunkSizeBytes,
    chunkCount: chunks.length,
    wrappedContentKey,
    chunks,
  };
};

