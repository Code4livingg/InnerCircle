CREATE TABLE IF NOT EXISTS "SubscriptionTier" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "tierName" TEXT NOT NULL,
    "priceMicrocredits" BIGINT NOT NULL,
    "description" TEXT,
    "benefits" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionTier_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Content"
    ADD COLUMN IF NOT EXISTS "subscriptionTierId" UUID;

ALTER TABLE "SubscriptionPurchase"
    ADD COLUMN IF NOT EXISTS "subscriptionTierId" UUID,
    ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Content_subscriptionTierId_idx" ON "Content"("subscriptionTierId");
CREATE INDEX IF NOT EXISTS "SubscriptionPurchase_subscriptionTierId_idx" ON "SubscriptionPurchase"("subscriptionTierId");
CREATE INDEX IF NOT EXISTS "SubscriptionTier_creatorId_idx" ON "SubscriptionTier"("creatorId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SubscriptionTier_creatorId_fkey'
    ) THEN
        ALTER TABLE "SubscriptionTier"
            ADD CONSTRAINT "SubscriptionTier_creatorId_fkey"
            FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Content_subscriptionTierId_fkey'
    ) THEN
        ALTER TABLE "Content"
            ADD CONSTRAINT "Content_subscriptionTierId_fkey"
            FOREIGN KEY ("subscriptionTierId") REFERENCES "SubscriptionTier"("id")
            ON DELETE SET NULL
            ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SubscriptionPurchase_subscriptionTierId_fkey'
    ) THEN
        ALTER TABLE "SubscriptionPurchase"
            ADD CONSTRAINT "SubscriptionPurchase_subscriptionTierId_fkey"
            FOREIGN KEY ("subscriptionTierId") REFERENCES "SubscriptionTier"("id")
            ON DELETE SET NULL
            ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionTier_creatorId_tierName_key"
    ON "SubscriptionTier"("creatorId", "tierName");
