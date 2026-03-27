-- Allow multiple live stream sessions to reuse the same static IVS channel.
DROP INDEX IF EXISTS "LiveStream_ivsChannelArn_key";

CREATE INDEX IF NOT EXISTS "LiveStream_ivsChannelArn_idx" ON "LiveStream"("ivsChannelArn");
