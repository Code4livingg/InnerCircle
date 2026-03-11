"use client";

import { useEffect, useRef } from "react";

interface StreamingPlayerProps {
  src: string | null;
  mimeType?: string | null;
  title?: string;
}

export function StreamingPlayer({ src, mimeType, title }: StreamingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  if (!src) {
    return <p>Unlock required before playback.</p>;
  }

  const normalizedMimeType = String(mimeType ?? "").toLowerCase();

  useEffect(() => {
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

  if (normalizedMimeType.startsWith("image/")) {
    return (
      <img
        src={src}
        alt={title ?? "Protected content"}
        style={{ display: "block", width: "100%", height: "auto", borderRadius: 16 }}
      />
    );
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return <audio ref={audioRef} controls preload="metadata" style={{ width: "100%" }} />;
  }

  return <video ref={videoRef} controls preload="metadata" style={{ width: "100%", height: "auto" }} />;
}
