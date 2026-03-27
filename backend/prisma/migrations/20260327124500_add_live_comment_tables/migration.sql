CREATE TABLE "CreatorMessagingKey" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "publicKeyB64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMessagingKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveComment" (
    "id" UUID NOT NULL,
    "liveStreamId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "ciphertextB64" TEXT NOT NULL,
    "nonceB64" TEXT NOT NULL,
    "senderPublicKeyB64" TEXT NOT NULL,
    "senderLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorMessagingKey_creatorId_key" ON "CreatorMessagingKey"("creatorId");
CREATE INDEX "LiveComment_creatorId_idx" ON "LiveComment"("creatorId");
CREATE INDEX "LiveComment_liveStreamId_idx" ON "LiveComment"("liveStreamId");

ALTER TABLE "CreatorMessagingKey"
ADD CONSTRAINT "CreatorMessagingKey_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveComment"
ADD CONSTRAINT "LiveComment_liveStreamId_fkey"
FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveComment"
ADD CONSTRAINT "LiveComment_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
