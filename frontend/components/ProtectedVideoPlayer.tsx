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

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[16px] bg-black"
      onContextMenu={(event) => event.preventDefault()}
    >
      <video
        controls
        preload="metadata"
        src={src}
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
