import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";

export type AgeModel = "TRADITIONAL_KYC" | "ZK_CREDENTIAL";

export interface AgeStatus {
  walletHash: string;
  isOver18: boolean;
  model: AgeModel;
  attestationHash: string;
  updatedAt: string;
}

const walletHash = (walletAddress: string): string => sha256Hex(walletAddress.toLowerCase());

const upsertAgeStatus = async (
  wh: string,
  isOver18: boolean,
  model: AgeModel,
  attestationHash: string,
): Promise<AgeStatus> => {
  await prisma.$executeRaw`
    INSERT INTO "AgeVerification" (
      "id",
      "walletHash",
      "isOver18",
      "model",
      "attestationHash",
      "updatedAt",
      "createdAt"
    )
    VALUES (
      CAST(${randomUUID()} AS UUID),
      ${wh},
      ${isOver18},
      ${model},
      ${attestationHash},
      NOW(),
      NOW()
    )
    ON CONFLICT ("walletHash")
    DO UPDATE SET
      "isOver18" = EXCLUDED."isOver18",
      "model" = EXCLUDED."model",
      "attestationHash" = EXCLUDED."attestationHash",
      "updatedAt" = NOW()
  `;

  const records = await prisma.$queryRaw<
    Array<{
      walletHash: string;
      isOver18: boolean;
      model: string;
      attestationHash: string;
      updatedAt: Date;
    }>
  >`
    SELECT "walletHash", "isOver18", "model", "attestationHash", "updatedAt"
    FROM "AgeVerification"
    WHERE "walletHash" = ${wh}
    LIMIT 1
  `;

  const record = records[0];
  if (!record) {
    throw new Error("Failed to persist age verification");
  }

  return {
    walletHash: record.walletHash,
    isOver18: record.isOver18,
    model: record.model as AgeModel,
    attestationHash: record.attestationHash,
    updatedAt: record.updatedAt.toISOString(),
  };
};

export const setTraditionalKycAgeStatus = async (
  walletAddress: string,
  providerAttestationId: string,
  isOver18: boolean,
): Promise<AgeStatus> => {
  const wh = walletHash(walletAddress);
  return upsertAgeStatus(wh, isOver18, "TRADITIONAL_KYC", sha256Hex(providerAttestationId));
};

export const setZkCredentialAgeStatus = async (
  walletAddress: string,
  zkCredentialId: string,
  proof: string,
): Promise<AgeStatus> => {
  if (!proof || proof.length < 8) {
    throw new Error("Invalid ZK age proof");
  }

  const wh = walletHash(walletAddress);
  return upsertAgeStatus(wh, true, "ZK_CREDENTIAL", sha256Hex(zkCredentialId));
};

export const getAgeStatus = async (walletAddress: string): Promise<AgeStatus | null> => {
  const wh = walletHash(walletAddress);
  const records = await prisma.$queryRaw<
    Array<{
      walletHash: string;
      isOver18: boolean;
      model: string;
      attestationHash: string;
      updatedAt: Date;
    }>
  >`
    SELECT "walletHash", "isOver18", "model", "attestationHash", "updatedAt"
    FROM "AgeVerification"
    WHERE "walletHash" = ${wh}
    LIMIT 1
  `;
  const record = records[0];
  if (!record) return null;

  return {
    walletHash: record.walletHash,
    isOver18: record.isOver18,
    model: record.model as AgeModel,
    attestationHash: record.attestationHash,
    updatedAt: record.updatedAt.toISOString(),
  };
};
