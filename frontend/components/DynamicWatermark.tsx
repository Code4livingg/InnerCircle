"use client";

import { useEffect, useState } from "react";

type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

interface DynamicWatermarkProps {
  fingerprint: string;
  shortWallet: string;
  sessionId: string;
}

const WATERMARK_POSITIONS: WatermarkPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

const pickNextPosition = (current: WatermarkPosition): WatermarkPosition => {
  const candidates = WATERMARK_POSITIONS.filter((position) => position !== current);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? "center";
};

const positionClasses: Record<WatermarkPosition, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
  center: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
};

export function DynamicWatermark({ fingerprint, shortWallet, sessionId }: DynamicWatermarkProps) {
  const [position, setPosition] = useState<WatermarkPosition>("top-right");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPosition((current) => pickNextPosition(current));
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      data-watermark-root="true"
      className={`pointer-events-none absolute z-20 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-[11px] uppercase tracking-[0.25em] text-white/75 shadow-[0_0_24px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-700 ${positionClasses[position]}`}
      aria-hidden="true"
    >
      <p>viewer: {fingerprint}</p>
      <p>wallet: {shortWallet}</p>
      <p>session: {sessionId}</p>
    </div>
  );
}
