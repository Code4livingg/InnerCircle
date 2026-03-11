import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { env } from "../config/env.js";
import { s3 } from "./s3Client.js";

const sanitizePathSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";

const buildMediaKey = (userId: string, fileName: string): string => {
  const safeUserId = sanitizePathSegment(userId);
  const safeFileName = sanitizePathSegment(basename(fileName));
  return `media/${safeUserId}/${Date.now()}-${randomUUID()}-${safeFileName}`;
};

export const uploadMedia = async (
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  userId: string,
): Promise<string> => {
  const fileKey = buildMediaKey(userId, fileName);

  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3BucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  );

  return fileKey;
};

export const deleteMedia = async (fileKey: string): Promise<void> => {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.s3BucketName,
      Key: fileKey,
    }),
  );
};

export const generateMediaUrl = async (fileKey: string): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: env.s3BucketName,
    Key: fileKey,
  });

  return getSignedUrl(s3, command, { expiresIn: env.signedUrlExpirationSeconds });
};
