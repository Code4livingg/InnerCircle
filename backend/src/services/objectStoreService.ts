import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ReadStream } from "node:fs";
import { env } from "../config/env.js";

export interface ObjectStore {
  putObject(key: string, data: Buffer): Promise<void>;
  putObjectStream(key: string): NodeJS.WritableStream;
  getObjectStream(key: string): ReadStream;
  getAbsolutePath(key: string): string;
}

const localRoot = (): string => resolve(env.storageLocalDir);

const ensureLocalDir = async (absPath: string): Promise<void> => {
  await mkdir(dirname(absPath), { recursive: true });
};

class LocalObjectStore implements ObjectStore {
  getAbsolutePath(key: string): string {
    const safeKey = key.replace(/^\/+/, "");
    return resolve(localRoot(), safeKey);
  }

  async putObject(key: string, data: Buffer): Promise<void> {
    const absPath = this.getAbsolutePath(key);
    await ensureLocalDir(absPath);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const stream = createWriteStream(absPath);
      stream.on("error", rejectPromise);
      stream.on("finish", () => resolvePromise());
      stream.end(data);
    });
  }

  putObjectStream(key: string): NodeJS.WritableStream {
    const absPath = this.getAbsolutePath(key);
    // Fire-and-forget dir creation; caller will see stream error if mkdir fails.
    void ensureLocalDir(absPath);
    return createWriteStream(absPath);
  }

  getObjectStream(key: string): ReadStream {
    return createReadStream(this.getAbsolutePath(key));
  }
}

export const objectStore: ObjectStore = (() => {
  if (env.storageProvider === "local") {
    return new LocalObjectStore();
  }

  // S3 implementation intentionally left as a follow-up for production deployment.
  throw new Error("STORAGE_PROVIDER=s3 is not implemented yet");
})();

