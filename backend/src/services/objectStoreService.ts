import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { s3 } from "./s3Client.js";

export interface ObjectStore {
  putObject(key: string, data: Buffer): Promise<void>;
  putObjectStream(key: string): NodeJS.WritableStream;
  getObjectStream(key: string): Promise<Readable>;
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

  async getObjectStream(key: string): Promise<Readable> {
    return createReadStream(this.getAbsolutePath(key));
  }
}

class S3ObjectStore implements ObjectStore {
  private bucketName(): string {
    return env.s3BucketName;
  }

  getAbsolutePath(key: string): string {
    const safeKey = key.replace(/^\/+/, "");
    return `s3://${this.bucketName()}/${safeKey}`;
  }

  async putObject(key: string, data: Buffer): Promise<void> {
    const safeKey = key.replace(/^\/+/, "");
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName(),
        Key: safeKey,
        Body: data,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  putObjectStream(key: string): NodeJS.WritableStream {
    const safeKey = key.replace(/^\/+/, "");
    const pass = new PassThrough();
    void s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName(),
        Key: safeKey,
        Body: pass,
        ServerSideEncryption: "AES256",
      }),
    );
    return pass;
  }

  async getObjectStream(key: string): Promise<Readable> {
    const safeKey = key.replace(/^\/+/, "");
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: this.bucketName(),
        Key: safeKey,
      }),
    );
    if (!response.Body) {
      throw new Error("Missing object body");
    }
    return response.Body as Readable;
  }
}

export const objectStore: ObjectStore = (() => {
  if (env.storageProvider === "local") {
    return new LocalObjectStore();
  }

  if (env.storageProvider === "s3") {
    return new S3ObjectStore();
  }

  throw new Error("Unsupported storage provider");
})();
