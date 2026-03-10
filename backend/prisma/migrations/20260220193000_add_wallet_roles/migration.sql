CREATE TYPE "WalletRoleType" AS ENUM ('FAN', 'CREATOR');

CREATE TABLE "WalletRole" (
    "id" UUID NOT NULL,
    "walletHash" TEXT NOT NULL,
    "role" "WalletRoleType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletRole_walletHash_key" ON "WalletRole"("walletHash");
CREATE INDEX "WalletRole_role_idx" ON "WalletRole"("role");
