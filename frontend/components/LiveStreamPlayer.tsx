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
  addEventListener: (name: string, fn: (payload?: unknown) => void) => void;
  removeEventListener: (name: string, fn: (payload?: unknown) => void) => void;
  load: (url: string, mediaType?: string) => void;
  play: () => void | Promise<void>;
  pause: () => void;
  delete: () => void;
  setAutoplay?: (value: boolean) => void;
  setAutoQualityMode?: (value: boolean) => void;
  setLiveLowLatencyEnabled?: (value: boolean) => void;
  setMuted?: (value: boolean) => void;
}

const IVS_WASM_WORKER_URL = "/vendor/amazon-ivs-player/amazon-ivs-wasmworker.min.js";
const IVS_WASM_BINARY_URL = "/vendor/amazon-ivs-player/amazon-ivs-wasmworker.min.wasm";
const HLS_MEDIA_TYPE = "application/x-mpegURL";
const PLAYBACK_RETRY_DELAY_MS = 3_000;

type PlaybackStatus = "idle" | "loading" | "waiting" | "ready" | "blocked" | "error";

export function LiveStreamPlayer({ liveStreamId, onAccessDenied, onReady }: LiveStreamPlayerProps) {
  const wallet = useWallet();
  const { connected, address } = wallet;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<IvsPlayerLike | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const onAccessDeniedRef = useRef(onAccessDenied);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onAccessDeniedRef.current = onAccessDenied;
    onReadyRef.current = onReady;
  }, [onAccessDenied, onReady]);

  useEffect(() => {
    let cancelled = false;
    let ivsModule: typeof import("amazon-ivs-player") | null = null;

    const clearTimers = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const teardownPlayer = () => {
      clearTimers();
      playerRef.current?.delete();
      playerRef.current = null;
    };

    const scheduleRetry = (message: string) => {
      clearTimers();
      if (cancelled) {
        return;
      }

      setStatus("waiting");
      setStatusLabel(message);
      retryTimerRef.current = window.setTimeout(() => {
        void initializePlayback();
      }, PLAYBACK_RETRY_DELAY_MS);
    };

    const initializePlayback = async (): Promise<void> => {
      clearTimers();

      if (!connected || !address) {
        setStatus("error");
        setError("Connect your wallet to watch this live stream.");
        setStatusLabel(null);
        return;
      }

      setStatus("loading");
      setStatusLabel("Authorizing live playback...");
      setError(null);

      try {
        const walletToken = await getWalletSessionToken(wallet);
        const tokenResponse = await fetchLiveStreamPlaybackToken(liveStreamId, walletToken);
        const playerModule = await import("amazon-ivs-player");
        ivsModule = playerModule;

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

        const onReadyState = () => {
          if (cancelled) return;
          setStatus("loading");
          setStatusLabel("Connecting to live stream...");
        };
        const onBuffering = () => {
          if (cancelled) return;
          setStatus("loading");
          setStatusLabel("Buffering live stream...");
        };
        const onPlaying = () => {
          if (cancelled) return;
          setStatus("ready");
          setStatusLabel(null);
          setError(null);
          onReadyRef.current?.();
        };
        const onPlaybackBlocked = () => {
          if (cancelled) return;
          setStatus("blocked");
          setStatusLabel("Autoplay was blocked by the browser. Press play to start the stream.");
        };
        const onPlayerError = (payload?: unknown) => {
          if (cancelled) return;
          const playerError = payload as { code?: number; message?: string; type?: string } | undefined;
          const isNotLiveYet = playerError?.code === 404;
          if (isNotLiveYet) {
            scheduleRetry("The stream is starting up. Retrying playback...");
            return;
          }

          setStatus("error");
          setStatusLabel(null);
          setError(playerError?.message || "Failed to start live playback.");
        };

        player.addEventListener(playerModule.PlayerState.READY, onReadyState);
        player.addEventListener(playerModule.PlayerState.BUFFERING, onBuffering);
        player.addEventListener(playerModule.PlayerState.PLAYING, onPlaying);
        player.addEventListener(playerModule.PlayerEventType.PLAYBACK_BLOCKED, onPlaybackBlocked);
        player.addEventListener(playerModule.PlayerEventType.AUDIO_BLOCKED, onPlaybackBlocked);
        player.addEventListener(playerModule.PlayerEventType.ERROR, onPlayerError);

        player.attachHTMLVideoElement(videoElement);
        videoElement.muted = true;
        player.setMuted?.(true);
        player.setAutoplay?.(true);
        player.setAutoQualityMode?.(true);
        player.setLiveLowLatencyEnabled?.(true);
        player.load(tokenResponse.url, HLS_MEDIA_TYPE);
        await Promise.resolve(player.play()).catch(() => undefined);
        playerRef.current = player;

        if (!cancelled) {
          setStatus("loading");
          setStatusLabel("Connecting to live stream...");
          setError(null);
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
        setStatusLabel(null);
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
      if (ivsModule && playerRef.current) {
        // Best-effort cleanup for dev Strict Mode and route changes.
        playerRef.current.pause();
      }
      teardownPlayer();
    };
  }, [address, connected, liveStreamId]);

  const onResumePlayback = async (): Promise<void> => {
    const player = playerRef.current;
    const videoElement = videoRef.current;
    if (!player || !videoElement) {
      return;
    }

    videoElement.muted = false;
    player.setMuted?.(false);
    await Promise.resolve(player.play()).catch(() => undefined);
  };

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
          aspectRatio: "16 / 9",
          minHeight: 360,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          controls
          autoPlay
          muted
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            minHeight: 360,
            objectFit: "cover",
            background: "linear-gradient(180deg, rgba(20,20,22,1), rgba(11,11,13,1))",
          }}
        />
        {status !== "ready" ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(180deg, rgba(5,5,7,0.18), rgba(5,5,7,0.48))",
              pointerEvents: status === "blocked" ? "auto" : "none",
            }}
          >
            <div
              style={{
                maxWidth: 460,
                padding: "1rem 1.25rem",
                borderRadius: 18,
                background: "rgba(8,8,10,0.68)",
                border: "1px solid rgba(255,255,255,0.08)",
                textAlign: "center",
              }}
            >
              <p className="t-sm t-muted" style={{ margin: 0 }}>
                {statusLabel ?? "Preparing live playback..."}
              </p>
              {status === "blocked" ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  style={{ marginTop: "0.85rem" }}
                  onClick={() => {
                    void onResumePlayback();
                  }}
                >
                  Start playback
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {(status === "loading" || status === "waiting") && statusLabel ? <p className="t-sm t-muted">{statusLabel}</p> : null}
      {error ? <p className="t-sm t-error">{error}</p> : null}
    </div>
  );
}
