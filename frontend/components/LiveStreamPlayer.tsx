"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchLiveStreamPlaybackToken } from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import { useWallet } from "@/lib/walletContext";

interface LiveStreamPlayerProps {
  liveStreamId: string;
  onAccessDenied?: (message: string) => void;
  onReady?: () => void;
}

interface IvsPlayerLike {
  attachHTMLVideoElement: (element: HTMLVideoElement) => void;
  load: (url: string) => void;
  play: () => void | Promise<void>;
  pause: () => void;
  delete: () => void;
  setAutoplay?: (value: boolean) => void;
}

const IVS_WASM_WORKER_URL = "/vendor/amazon-ivs-player/amazon-ivs-wasmworker.min.js";
const IVS_WASM_BINARY_URL = "/vendor/amazon-ivs-player/amazon-ivs-wasmworker.min.wasm";

export function LiveStreamPlayer({ liveStreamId, onAccessDenied, onReady }: LiveStreamPlayerProps) {
  const wallet = useWallet();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<IvsPlayerLike | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const onAccessDeniedRef = useRef(onAccessDenied);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onAccessDeniedRef.current = onAccessDenied;
    onReadyRef.current = onReady;
  }, [onAccessDenied, onReady]);

  useEffect(() => {
    let cancelled = false;

    const clearRefreshTimer = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const teardownPlayer = () => {
      clearRefreshTimer();
      playerRef.current?.delete();
      playerRef.current = null;
    };

    const initializePlayback = async (): Promise<void> => {
      clearRefreshTimer();

      if (!wallet.connected || !wallet.address) {
        setStatus("error");
        setError("Connect your wallet to watch this live stream.");
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const walletToken = await getWalletSessionToken(wallet);
        const tokenResponse = await fetchLiveStreamPlaybackToken(liveStreamId, walletToken);
        const playerModule = await import("amazon-ivs-player");

        if (!playerModule.isPlayerSupported) {
          throw new Error("This browser does not support Amazon IVS playback.");
        }

        const videoElement = videoRef.current;
        if (!videoElement) {
          throw new Error("Live player element is unavailable.");
        }

        playerRef.current?.delete();

        const player = playerModule.create({
          wasmWorker: IVS_WASM_WORKER_URL,
          wasmBinary: IVS_WASM_BINARY_URL,
        }) as unknown as IvsPlayerLike;
        player.attachHTMLVideoElement(videoElement);
        player.setAutoplay?.(true);
        player.load(tokenResponse.url);
        await Promise.resolve(player.play()).catch(() => undefined);
        playerRef.current = player;

        if (!cancelled) {
          setStatus("ready");
          setError(null);
          onReadyRef.current?.();
        }

        const refreshDelayMs = Math.max((tokenResponse.expiresAt - Math.floor(Date.now() / 1000) - 60) * 1000, 60_000);
        refreshTimerRef.current = window.setTimeout(() => {
          void initializePlayback();
        }, refreshDelayMs);
      } catch (streamError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        if (streamError instanceof ApiError && streamError.status === 403) {
          const message = "This wallet is not entitled to watch the live stream yet.";
          setError(message);
          onAccessDeniedRef.current?.(message);
          return;
        }

        setError((streamError as Error).message || "Failed to start live playback.");
      }
    };

    void initializePlayback();

    return () => {
      cancelled = true;
      teardownPlayer();
    };
  }, [liveStreamId, wallet]);

  return (
    <div className="stack stack-3">
      <div
        className="row row-2"
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div
          className="row row-2"
          style={{
            alignItems: "center",
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(225,29,72,0.12)",
            border: "1px solid rgba(225,29,72,0.22)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--c-violet)",
              boxShadow: "0 0 12px rgba(225,29,72,0.65)",
              animation: "pulse 1.8s ease-in-out infinite",
            }}
          />
          <span className="section__label" style={{ marginBottom: 0 }}>
            Live
          </span>
        </div>

        <span className="t-xs t-dim">Viewer count coming soon</span>
      </div>

      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 24,
          background: "rgba(0,0,0,0.92)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          controls
          autoPlay
          muted={false}
          style={{ display: "block", width: "100%", height: "auto", minHeight: 320 }}
        />
      </div>

      {status === "loading" ? <p className="t-sm t-muted">Preparing private live playback...</p> : null}
      {error ? <p className="t-sm t-error">{error}</p> : null}
    </div>
  );
}
