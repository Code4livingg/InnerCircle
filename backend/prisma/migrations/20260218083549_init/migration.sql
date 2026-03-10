/*
  Warnings:

  - You are about to drop the column `contentType` on the `Content` table. All the data in the column will be lost.
  - You are about to drop the column `encryptedFileUrl` on the `Content` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Content` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnailUrl` on the `Content` table. All the data in the column will be lost.
  - You are about to drop the `AccessSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AgeVerification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CreatorProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Purchase` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RefreshToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Subscription` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `baseObjectKey` to the `Content` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AccessSession" DROP CONSTRAINT "AccessSession_contentId_fkey";

-- DropForeignKey
ALTER TABLE "AccessSession" DROP CONSTRAINT "AccessSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "AgeVerification" DROP CONSTRAINT "AgeVerification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Content" DROP CONSTRAINT "Content_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "CreatorProfile" DROP CONSTRAINT "CreatorProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_contentId_fkey";

-- DropForeignKey
ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_userId_fkey";

-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- AlterTable
ALTER TABLE "Content" DROP COLUMN "contentType",
DROP COLUMN "encryptedFileUrl",
DROP COLUMN "price",
DROP COLUMN "thumbnailUrl",
ADD COLUMN     "baseObjectKey" TEXT NOT NULL,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'VIDEO',
ADD COLUMN     "ppvPriceMicrocredits" BIGINT,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "thumbObjectKey" TEXT,
ALTER COLUMN "mimeType" SET DEFAULT 'video/mp4',
ALTER COLUMN "chunkSizeBytes" SET DEFAULT 0,
ALTER COLUMN "chunkCount" SET DEFAULT 0,
ALTER COLUMN "wrappedKeyCiphertextB64" SET DEFAULT '',
ALTER COLUMN "wrappedKeyIvB64" SET DEFAULT '',
ALTER COLUMN "wrappedKeyAuthTagB64" SET DEFAULT '';

-- DropTable
DROP TABLE "AccessSession";

-- DropTable
DROP TABLE "AgeVerification";

-- DropTable
DROP TABLE "CreatorProfile";

-- DropTable
DROP TABLE "Purchase";

-- DropTable
DROP TABLE "RefreshToken";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "AgeVerificationMethod";

-- DropEnum
DROP TYPE "AgeVerificationStatus";

-- DropEnum
DROP TYPE "ContentType";

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "Creator" (
    "id" UUID NOT NULL,
    "walletHash" TEXT NOT NULL,
    "creatorFieldId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarObjectKey" TEXT,
    "subscriptionPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamEvent" (
    "id" UUID NOT NULL,
    "walletHash" TEXT NOT NULL,
    "contentId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "watermarkId" TEXT NOT NULL,
    "bytesServed" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_walletHash_key" ON "Creator"("walletHash");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_creatorFieldId_key" ON "Creator"("creatorFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_handle_key" ON "Creator"("handle");

-- CreateIndex
CREATE INDEX "Creator_handle_idx" ON "Creator"("handle");

-- CreateIndex
CREATE INDEX "StreamEvent_contentId_idx" ON "StreamEvent"("contentId");

-- CreateIndex
CREATE INDEX "StreamEvent_walletHash_idx" ON "StreamEvent"("walletHash");

-- CreateIndex
CREATE INDEX "Content_isPublished_idx" ON "Content"("isPublished");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamEvent" ADD CONSTRAINT "StreamEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
