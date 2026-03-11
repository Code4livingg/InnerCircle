import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { decryptBuffer, unwrapContentKey } from "../src/services/encryptionService.js";
import { uploadMedia } from "../src/services/mediaStorageService.js";

const mimeExtensionMap: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

const sanitizeFileStem = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "content";

const inferExtension = (mimeType: string, currentKey?: string | null): string => {
  const fromMime = mimeExtensionMap[mimeType.toLowerCase()];
  if (fromMime) {
    return fromMime;
  }

  const fromKey = currentKey ? extname(currentKey) : "";
  return fromKey || ".bin";
};

const readLegacyContentBuffer = async (contentId: string, wrappedKey: {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}): Promise<Buffer> => {
  const contentKey = unwrapContentKey(wrappedKey);
  const chunks = await prisma.contentChunk.findMany({
    where: { contentId },
    orderBy: { idx: "asc" },
    select: {
      idx: true,
      objectKey: true,
      ivB64: true,
      authTagB64: true,
    },
  });

  if (chunks.length === 0) {
    throw new Error(`No legacy chunks found for content ${contentId}`);
  }

  const plaintextParts: Buffer[] = [];
  for (const chunk of chunks) {
    const absPath = resolve(env.storageLocalDir, chunk.objectKey);
    const ciphertext = await readFile(absPath);
    const plaintext = decryptBuffer(
      {
        ciphertext,
        iv: Buffer.from(chunk.ivB64, "base64"),
        authTag: Buffer.from(chunk.authTagB64, "base64"),
      },
      contentKey,
    );

    plaintextParts.push(plaintext);
  }

  return Buffer.concat(plaintextParts);
};

const run = async (): Promise<void> => {
  const legacyContents = await prisma.content.findMany({
    where: { storageProvider: "LOCAL" },
    select: {
      id: true,
      title: true,
      mimeType: true,
      baseObjectKey: true,
      creatorId: true,
      wrappedKeyCiphertextB64: true,
      wrappedKeyIvB64: true,
      wrappedKeyAuthTagB64: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (legacyContents.length === 0) {
    console.log("No LOCAL content records found. Nothing to migrate.");
    return;
  }

  console.log(`Found ${legacyContents.length} LOCAL content record(s) to migrate.`);

  for (const content of legacyContents) {
    const wrappedKey = {
      ciphertextB64: content.wrappedKeyCiphertextB64,
      ivB64: content.wrappedKeyIvB64,
      authTagB64: content.wrappedKeyAuthTagB64,
    };

    const plaintext = await readLegacyContentBuffer(content.id, wrappedKey);
    const extension = inferExtension(content.mimeType, content.baseObjectKey);
    const fileName = `${sanitizeFileStem(content.title)}${extension}`;
    const s3Key = await uploadMedia(plaintext, fileName, content.mimeType, content.creatorId);

    await prisma.content.update({
      where: { id: content.id },
      data: {
        storageProvider: "S3",
        baseObjectKey: s3Key,
        sizeBytes: BigInt(plaintext.length),
      },
    });

    console.log(`Migrated ${content.id} -> ${s3Key}`);
  }

  console.log("Local content migration completed.");
};

try {
  await run();
} finally {
  await prisma.$disconnect();
}
