-- CreateTable
CREATE TABLE "SubscriptionPurchase" (
    "id" UUID NOT NULL,
    "txId" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "creatorId" UUID NOT NULL,
    "creatorFieldId" TEXT NOT NULL,
    "priceMicrocredits" BIGINT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpvPurchase" (
    "id" UUID NOT NULL,
    "txId" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "contentId" UUID NOT NULL,
    "contentFieldId" TEXT NOT NULL,
    "priceMicrocredits" BIGINT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PpvPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPurchase_txId_key" ON "SubscriptionPurchase"("txId");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_creatorId_idx" ON "SubscriptionPurchase"("creatorId");

-- CreateIndex
CREATE INDEX "SubscriptionPurchase_walletHash_idx" ON "SubscriptionPurchase"("walletHash");

-- CreateIndex
CREATE UNIQUE INDEX "PpvPurchase_txId_key" ON "PpvPurchase"("txId");

-- CreateIndex
CREATE INDEX "PpvPurchase_contentId_idx" ON "PpvPurchase"("contentId");

-- CreateIndex
CREATE INDEX "PpvPurchase_walletHash_idx" ON "PpvPurchase"("walletHash");

-- AddForeignKey
ALTER TABLE "SubscriptionPurchase" ADD CONSTRAINT "SubscriptionPurchase_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpvPurchase" ADD CONSTRAINT "PpvPurchase_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
