import { sha256Hex } from "../utils/crypto.js";

export interface WatermarkEvent {
  watermarkId: string;
  walletHash: string;
  contentId: string;
  sessionId: string;
  createdAt: string;
}

export const createWatermarkId = (walletHash: string, contentId: string, sessionId: string): string => {
  const material = `${walletHash}:${contentId}:${sessionId}:${Date.now()}`;
  return sha256Hex(material).slice(0, 24);
};

export const applyInvisibleWatermark = (chunk: Buffer, watermarkId: string): Buffer => {
  // Placeholder: integrate ffmpeg bitstream watermarking or forensic SDK here.
  // This keeps circuit complexity off-chain and enables per-session fingerprinting.
  void watermarkId;
  return chunk;
};

export const buildWatermarkEvent = (
  walletHash: string,
  contentId: string,
  sessionId: string,
  watermarkId: string,
): WatermarkEvent => ({
  walletHash,
  contentId,
  sessionId,
  watermarkId,
  createdAt: new Date().toISOString(),
});