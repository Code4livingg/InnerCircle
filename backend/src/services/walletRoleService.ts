import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../utils/crypto.js";

export type WalletRoleType = "FAN" | "CREATOR";

export class WalletRoleConflictError extends Error {
  readonly existingRole: WalletRoleType;
  readonly requestedRole: WalletRoleType;

  constructor(existingRole: WalletRoleType, requestedRole: WalletRoleType) {
    super(
      `Wallet role conflict: wallet is already ${existingRole.toLowerCase()} and cannot switch to ${requestedRole.toLowerCase()}.`,
    );
    this.name = "WalletRoleConflictError";
    this.existingRole = existingRole;
    this.requestedRole = requestedRole;
  }
}

export const walletHashForAddress = (walletAddress: string): string =>
  sha256Hex(walletAddress.trim().toLowerCase());

export const toClientRole = (role: WalletRoleType): "user" | "creator" =>
  role === "CREATOR" ? "creator" : "user";

export const fromClientRole = (role: "user" | "creator"): WalletRoleType =>
  role === "creator" ? "CREATOR" : "FAN";

let walletRoleSchemaInit: Promise<void> | null = null;

const ensureWalletRoleSchema = async (): Promise<void> => {
  if (!walletRoleSchemaInit) {
    walletRoleSchemaInit = (async () => {
      const typeRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS(
          SELECT 1
          FROM pg_type
          WHERE typname = 'WalletRoleType'
        ) AS "exists"
      `;

      if (!typeRows[0]?.exists) {
        await prisma.$executeRawUnsafe(`CREATE TYPE "WalletRoleType" AS ENUM ('FAN', 'CREATOR')`);
      }

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "WalletRole" (
          "id" UUID PRIMARY KEY,
          "walletHash" TEXT NOT NULL UNIQUE,
          "role" "WalletRoleType" NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "WalletRole_role_idx" ON "WalletRole"("role")
      `);
    })();
  }

  await walletRoleSchemaInit;
};

export const getWalletRoleByHash = async (walletHash: string): Promise<WalletRoleType | null> => {
  await ensureWalletRoleSchema();

  const rows = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT "role"::text AS role
    FROM "WalletRole"
    WHERE "walletHash" = ${walletHash}
    LIMIT 1
  `;
  const role = rows[0]?.role;
  return role === "CREATOR" || role === "FAN" ? role : null;
};

export const getWalletRoleByAddress = async (walletAddress: string): Promise<WalletRoleType | null> =>
  getWalletRoleByHash(walletHashForAddress(walletAddress));

export const ensureWalletRoleByHash = async (
  walletHash: string,
  requestedRole: WalletRoleType,
): Promise<void> => {
  await ensureWalletRoleSchema();

  const existing = await getWalletRoleByHash(walletHash);
  if (existing && existing !== requestedRole) {
    throw new WalletRoleConflictError(existing, requestedRole);
  }

  if (!existing) {
    await prisma.$executeRaw`
      INSERT INTO "WalletRole" ("id", "walletHash", "role", "createdAt", "updatedAt")
      VALUES (CAST(${randomUUID()} AS UUID), ${walletHash}, ${requestedRole}::"WalletRoleType", NOW(), NOW())
      ON CONFLICT ("walletHash")
      DO NOTHING
    `;

    const lockedRole = await getWalletRoleByHash(walletHash);
    if (lockedRole && lockedRole !== requestedRole) {
      throw new WalletRoleConflictError(lockedRole, requestedRole);
    }
  }
};

export const ensureWalletRoleByAddress = async (
  walletAddress: string,
  requestedRole: WalletRoleType,
): Promise<string> => {
  const walletHash = walletHashForAddress(walletAddress);
  await ensureWalletRoleByHash(walletHash, requestedRole);
  return walletHash;
};
