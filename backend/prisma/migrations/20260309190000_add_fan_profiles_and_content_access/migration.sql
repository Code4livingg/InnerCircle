CREATE TYPE "ContentAccessType" AS ENUM ('PUBLIC', 'SUBSCRIPTION', 'PPV');

ALTER TABLE "Creator"
ADD COLUMN "walletAddress" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Content"
ADD COLUMN "accessType" "ContentAccessType" NOT NULL DEFAULT 'SUBSCRIPTION';

CREATE TABLE "FanProfile" (
    "id" UUID NOT NULL,
    "walletHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT,
    "bio" TEXT,
    "monthlyBudgetMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "favoriteCategories" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FanProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorFollow" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "walletHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorFollow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FanProfile_walletHash_key" ON "FanProfile"("walletHash");
CREATE UNIQUE INDEX "CreatorFollow_creatorId_walletHash_key" ON "CreatorFollow"("creatorId", "walletHash");
CREATE INDEX "CreatorFollow_creatorId_idx" ON "CreatorFollow"("creatorId");
CREATE INDEX "CreatorFollow_walletHash_idx" ON "CreatorFollow"("walletHash");

ALTER TABLE "CreatorFollow"
ADD CONSTRAINT "CreatorFollow_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
