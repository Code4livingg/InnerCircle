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
  // We avoid mutating binary media bytes here because naive byte injection would
  // corrupt MP4/JPEG payloads. The active watermark is carried in response
  // metadata headers keyed by the same watermark id and session id.
  void watermarkId;
  return chunk;
};

export const buildWatermarkHeaders = (sessionId: string, watermarkId: string): Record<string, string> => ({
  "X-Watermark-Id": watermarkId,
  "X-Session-Watermark": sessionId,
});

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
