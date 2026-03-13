-- CreateTable
CREATE TABLE "LiveStream" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "ivsChannelArn" TEXT NOT NULL,
    "ivsChannelName" TEXT NOT NULL,
    "streamKeyArn" TEXT NOT NULL,
    "streamKeyValue" TEXT NOT NULL,
    "ingestEndpoint" TEXT NOT NULL,
    "playbackUrl" TEXT NOT NULL,
    "playbackKeyPairArn" TEXT,
    "playbackPublicKey" TEXT,
    "playbackPrivateKeyCiphertextB64" TEXT,
    "playbackPrivateKeyIvB64" TEXT,
    "playbackPrivateKeyAuthTagB64" TEXT,
    "purchaseFieldId" TEXT,
    "title" TEXT NOT NULL,
    "accessType" "ContentAccessType" NOT NULL DEFAULT 'SUBSCRIPTION',
    "ppvPriceMicrocredits" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveStreamPurchase" (
    "id" UUID NOT NULL,
    "txId" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "liveStreamId" UUID NOT NULL,
    "purchaseFieldId" TEXT NOT NULL,
    "priceMicrocredits" BIGINT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStreamPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveStream_ivsChannelArn_key" ON "LiveStream"("ivsChannelArn");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStream_purchaseFieldId_key" ON "LiveStream"("purchaseFieldId");

-- CreateIndex
CREATE INDEX "LiveStream_creatorId_idx" ON "LiveStream"("creatorId");

-- CreateIndex
CREATE INDEX "LiveStream_status_idx" ON "LiveStream"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStreamPurchase_txId_key" ON "LiveStreamPurchase"("txId");

-- CreateIndex
CREATE INDEX "LiveStreamPurchase_liveStreamId_idx" ON "LiveStreamPurchase"("liveStreamId");

-- CreateIndex
CREATE INDEX "LiveStreamPurchase_walletHash_idx" ON "LiveStreamPurchase"("walletHash");

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamPurchase" ADD CONSTRAINT "LiveStreamPurchase_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
