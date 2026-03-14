-- Add txId to Tip for on-chain verification and de-duplication
ALTER TABLE "Tip" ADD COLUMN "txId" TEXT;

CREATE UNIQUE INDEX "Tip_txId_key" ON "Tip"("txId");
