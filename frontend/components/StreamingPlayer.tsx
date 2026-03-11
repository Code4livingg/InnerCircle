"use client";

import { useEffect, useRef, useState } from "react";
import { DynamicWatermark } from "./DynamicWatermark";

interface StreamingPlayerWatermark {
  fingerprint: string;
  shortWallet: string;
  sessionId: string;
}

interface StreamingPlayerProps {
  src: string | null;
  mimeType?: string | null;
  title?: string;
  watermark?: StreamingPlayerWatermark | null;
}

export function StreamingPlayer({ src, mimeType, title, watermark }: StreamingPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [overlayNonce, setOverlayNonce] = useState(0);
  const normalizedMimeType = String(mimeType ?? "").toLowerCase();

  useEffect(() => {
    if (!watermark) {
      return undefined;
    }

    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      if (!container.querySelector("[data-watermark-root='true']")) {
        setOverlayNonce((value) => value + 1);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [watermark]);

  useEffect(() => {
    if (!src) {
      return undefined;
    }

    const media = normalizedMimeType.startsWith("audio/")
      ? audioRef.current
      : normalizedMimeType.startsWith("video/")
        ? videoRef.current
        : null;

    if (!media || media.dataset.signedSrc === src) {
      return undefined;
    }

    const previousTime = media.currentTime;
    const shouldResume = !media.paused;
    media.dataset.signedSrc = src;
    media.src = src;
    media.load();

    const restorePlayback = (): void => {
      if (previousTime > 0) {
        try {
          media.currentTime = previousTime;
        } catch {
          // Ignore restore failures for short media or unseekable sources.
        }
      }

      if (shouldResume) {
        void media.play().catch(() => undefined);
      }
    };

    media.addEventListener("loadedmetadata", restorePlayback, { once: true });

    return () => {
      media.removeEventListener("loadedmetadata", restorePlayback);
    };
  }, [normalizedMimeType, src]);

  const overlay = watermark ? (
    <DynamicWatermark
      key={overlayNonce}
      fingerprint={watermark.fingerprint}
      shortWallet={watermark.shortWallet}
      sessionId={watermark.sessionId}
    />
  ) : null;

  if (!src) {
    return <p>Unlock required before playback.</p>;
  }

  if (normalizedMimeType.startsWith("image/")) {
    return (
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-[16px]"
        onContextMenu={(event) => event.preventDefault()}
      >
        <img
          src={src}
          alt={title ?? "Protected content"}
          style={{ display: "block", width: "100%", height: "auto", borderRadius: 16 }}
        />
        {overlay}
      </div>
    );
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return (
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-[16px] bg-black px-4 py-5"
        onContextMenu={(event) => event.preventDefault()}
      >
        <audio ref={audioRef} controls preload="metadata" style={{ width: "100%" }} />
        {overlay}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[16px] bg-black"
      onContextMenu={(event) => event.preventDefault()}
    >
      <video
        ref={videoRef}
        controls
        preload="metadata"
        style={{ width: "100%", height: "auto" }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {overlay}
    </div>
  );
}
