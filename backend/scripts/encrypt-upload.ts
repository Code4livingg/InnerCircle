import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  encryptBuffer,
  generateContentKey,
  serializeCipherPackage,
  wrapContentKey,
} from "../src/services/encryptionService.js";

const input = process.argv[2];
const outputDir = process.argv[3] ?? "encrypted-output";

if (!input) {
  throw new Error("Usage: tsx scripts/encrypt-upload.ts <input-file> [output-dir]");
}

const run = async () => {
  const source = resolve(input);
  const content = await readFile(source);

  const contentKey = generateContentKey();
  const sessionKey = contentKey; // production can use segment keys.
  const encrypted = encryptBuffer(content, sessionKey);

  const targetPath = resolve(outputDir, `${basename(source)}.enc`);
  await writeFile(targetPath, encrypted.ciphertext);

  const metaPath = `${targetPath}.json`;
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        wrappedContentKey: wrapContentKey(contentKey),
        fileCipher: serializeCipherPackage(encrypted),
      },
      null,
      2,
    ),
  );

  console.log(`Encrypted file written: ${targetPath}`);
  console.log(`Metadata written: ${metaPath}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});