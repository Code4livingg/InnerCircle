"use client";

import { useEffect, useRef, useState } from "react";
import { DynamicWatermark } from "./DynamicWatermark";

interface ProtectedVideoPlayerProps {
  src: string;
  title?: string;
  fingerprint: string;
  shortWallet: string;
  sessionId: string;
}

export function ProtectedVideoPlayer({
  src,
  title,
  fingerprint,
  shortWallet,
  sessionId,
}: ProtectedVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [overlayNonce, setOverlayNonce] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      if (!container.querySelector("[data-watermark-root='true']")) {
        setOverlayNonce((value) => value + 1);
      }
    });

    observer.observe(container, { childList: true });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.dataset.signedSrc === src) {
      return undefined;
    }

    const previousTime = video.currentTime;
    const shouldResume = !video.paused;
    video.dataset.signedSrc = src;
    video.src = src;
    video.load();

    const restorePlayback = (): void => {
      if (previousTime > 0) {
        try {
          video.currentTime = previousTime;
        } catch {
          // Ignore restore failures for short media or unseekable sources.
        }
      }

      if (shouldResume) {
        void video.play().catch(() => undefined);
      }
    };

    video.addEventListener("loadedmetadata", restorePlayback, { once: true });

    return () => {
      video.removeEventListener("loadedmetadata", restorePlayback);
    };
  }, [src]);

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
        title={title ?? "Protected video"}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        playsInline
        className="block h-auto w-full"
        onContextMenu={(event) => event.preventDefault()}
      />
      <DynamicWatermark
        key={overlayNonce}
        fingerprint={fingerprint}
        shortWallet={shortWallet}
        sessionId={sessionId}
      />
    </div>
  );
}
