"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  createCreatorLiveStream,
  endCreatorLiveStream,
  fetchCreatorByWallet,
  fetchLiveStreams,
  registerCreatorMessagingKey,
} from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import { useWallet } from "@/lib/walletContext";
import { getOrCreateKeypair } from "@/features/liveComments/keys";
import { PrivateMessagesPanel } from "@/features/liveComments/PrivateMessagesPanel";

type StreamState = "idle" | "initializing" | "live" | "ending";

interface IvsBroadcastClientLike {
  getCanvasDimensions?: () => { width: number; height: number };
  addVideoInputDevice: (stream: MediaStream, name: string, options?: unknown) => void | Promise<void>;
  addAudioInputDevice: (stream: MediaStream, name: string) => void | Promise<void>;
  startBroadcast: (streamKey: string) => Promise<void>;
  stopBroadcast?: () => void | Promise<void>;
}

const toMicrocredits = (credits: string): string => String(Math.round(Number.parseFloat(credits || "0") * 1_000_000));

export default function GoLivePage() {
  const wallet = useWallet();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const broadcastClientRef = useRef<IvsBroadcastClientLike | null>(null);

  const [title, setTitle] = useState("");
  const [accessType, setAccessType] = useState<"SUBSCRIPTION" | "PPV">("SUBSCRIPTION");
  const [ppvPriceCredits, setPpvPriceCredits] = useState("3.00");
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [creatorHandle, setCreatorHandle] = useState<string | null>(null);
  const [liveStreamId, setLiveStreamId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [walletToken, setWalletToken] = useState<string | null>(null);
  const [keyRegistered, setKeyRegistered] = useState(false);
  const [endConfirmArmed, setEndConfirmArmed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isRecoveredLiveSession, setIsRecoveredLiveSession] = useState(false);
  const [activeStreamLookupPending, setActiveStreamLookupPending] = useState(false);
  const keypair = useMemo(() => getOrCreateKeypair(), []);

  useEffect(() => {
    const hydrateCreator = async () => {
      if (!wallet.address) {
        setCreatorHandle(null);
        return;
      }

      try {
        const creator = await fetchCreatorByWallet(wallet.address);
        setCreatorHandle(creator.creator.handle);
      } catch {
        setCreatorHandle(null);
      }
    };

    void hydrateCreator();
  }, [wallet.address]);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setWalletToken(null);
      setKeyRegistered(false);
      return;
    }

    let cancelled = false;

    const registerKey = async () => {
      try {
        const token = await getWalletSessionToken(wallet);
        if (cancelled) return;
        setWalletToken(token);
        if (!keyRegistered) {
          await registerCreatorMessagingKey({ publicKeyB64: keypair.publicKeyB64 }, token);
          if (!cancelled) {
            setKeyRegistered(true);
          }
        }
      } catch {
        if (!cancelled) {
          setKeyRegistered(false);
        }
      }
    };

    void registerKey();

    return () => {
      cancelled = true;
    };
  }, [wallet.connected, wallet.address, keyRegistered, keypair.publicKeyB64, wallet]);

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      void Promise.resolve(broadcastClientRef.current?.stopBroadcast?.()).catch(() => undefined);
      broadcastClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (streamState !== "live") {
      setEndConfirmArmed(false);
    }
  }, [streamState]);

  useEffect(() => {
    setCopyStatus(null);
  }, [liveStreamId]);

  useEffect(() => {
    if (!wallet.connected || !wallet.address || !walletToken || !creatorHandle) {
      return;
    }

    if (streamState === "initializing" || streamState === "ending") {
      return;
    }

    let cancelled = false;

    const hydrateOwnedLiveStream = async () => {
      setActiveStreamLookupPending(true);

      try {
        const { liveStreams } = await fetchLiveStreams(walletToken);
        if (cancelled) {
          return;
        }

        const ownedLiveStream = liveStreams.find(
          (stream) => stream.creator.handle.toLowerCase() === creatorHandle.toLowerCase(),
        );

        if (!ownedLiveStream) {
          if (!broadcastClientRef.current) {
            setLiveStreamId(null);
            setPlaybackUrl(null);
            setIsRecoveredLiveSession(false);
            setStreamState("idle");
          }
          return;
        }

        setLiveStreamId(ownedLiveStream.id);
        setTitle(ownedLiveStream.title);
        setAccessType(ownedLiveStream.accessType);
        if (ownedLiveStream.accessType === "PPV" && ownedLiveStream.ppvPriceMicrocredits) {
          setPpvPriceCredits((Number(ownedLiveStream.ppvPriceMicrocredits) / 1_000_000).toFixed(2));
        }
        setStreamState("live");
        setIsRecoveredLiveSession(!broadcastClientRef.current);
      } catch {
        if (!cancelled) {
          setIsRecoveredLiveSession(false);
        }
      } finally {
        if (!cancelled) {
          setActiveStreamLookupPending(false);
        }
      }
    };

    void hydrateOwnedLiveStream();

    return () => {
      cancelled = true;
    };
  }, [creatorHandle, streamState, wallet.address, wallet.connected, walletToken]);

  const onGoLive = async () => {
    if (!wallet.connected || !wallet.address) {
      setError("Connect your Aleo wallet first.");
      return;
    }

    if (!title.trim()) {
      setError("Give the live stream a title first.");
      return;
    }

    if (accessType === "PPV" && (!Number.isFinite(Number.parseFloat(ppvPriceCredits)) || Number.parseFloat(ppvPriceCredits) <= 0)) {
      setError("Enter a valid PPV price before going live.");
      return;
    }

    setStreamState("initializing");
    setError(null);

    let walletToken: string | null = null;
    let createdLiveStreamId: string | null = null;

    try {
      walletToken = await getWalletSessionToken(wallet);
      const liveStream = await createCreatorLiveStream(
        {
          title: title.trim(),
          accessType,
          ppvPriceMicrocredits: accessType === "PPV" ? toMicrocredits(ppvPriceCredits) : undefined,
        },
        walletToken,
      );
      createdLiveStreamId = liveStream.liveStreamId;

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => undefined);
      }

      const broadcastModule = await import("amazon-ivs-web-broadcast");
      const clientNamespace =
        (broadcastModule as { IVSBroadcastClient?: unknown }).IVSBroadcastClient ??
        (broadcastModule as { default?: { IVSBroadcastClient?: unknown } }).default?.IVSBroadcastClient ??
        (broadcastModule as { default?: unknown }).default;

      if (!clientNamespace || typeof clientNamespace !== "object" || !("create" in clientNamespace)) {
        throw new Error("Amazon IVS broadcast SDK failed to load.");
      }

      const ivsClient = clientNamespace as {
        BASIC_FULL_HD_LANDSCAPE?: unknown;
        STANDARD_LANDSCAPE: unknown;
        create: (config: { streamConfig: unknown; ingestEndpoint: string }) => IvsBroadcastClientLike;
      };

      const client = ivsClient.create({
        streamConfig: ivsClient.BASIC_FULL_HD_LANDSCAPE ?? ivsClient.STANDARD_LANDSCAPE,
        ingestEndpoint: liveStream.ingestEndpoint,
      });

      const canvasDimensions = client.getCanvasDimensions?.() ?? { width: 1920, height: 1080 };
      await Promise.resolve(
        client.addVideoInputDevice(stream, "camera1", {
          index: 0,
          x: 0,
          y: 0,
          width: canvasDimensions.width,
          height: canvasDimensions.height,
        }),
      );
      await Promise.resolve(client.addAudioInputDevice(stream, "mic1"));
      await client.startBroadcast(liveStream.streamKeyValue);

      broadcastClientRef.current = client;
      setLiveStreamId(liveStream.liveStreamId);
      setPlaybackUrl(liveStream.playbackUrl);
      setEndConfirmArmed(false);
      setIsRecoveredLiveSession(false);
      setStreamState("live");
    } catch (startError) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      broadcastClientRef.current = null;
      setLiveStreamId(null);
      setPlaybackUrl(null);

      if (walletToken && createdLiveStreamId) {
        await endCreatorLiveStream(createdLiveStreamId, walletToken).catch(() => undefined);
      }

      setStreamState("idle");
      setError((startError as Error).message || "Failed to start live stream.");
    }
  };

  const onEndStream = async () => {
    if (!liveStreamId) {
      return;
    }

    setStreamState("ending");
    setError(null);

    try {
      const walletToken = await getWalletSessionToken(wallet);
      await Promise.resolve(broadcastClientRef.current?.stopBroadcast?.()).catch(() => undefined);
      await endCreatorLiveStream(liveStreamId, walletToken);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      broadcastClientRef.current = null;
      setLiveStreamId(null);
      setPlaybackUrl(null);
      setEndConfirmArmed(false);
      setIsRecoveredLiveSession(false);
      setStreamState("idle");
    } catch (endError) {
      setStreamState("live");
      setError((endError as Error).message || "Failed to end live stream.");
    }
  };

  const viewerPath = liveStreamId ? `/live/${liveStreamId}` : null;
  const viewerUrl = viewerPath && typeof window !== "undefined" ? `${window.location.origin}${viewerPath}` : viewerPath;
  const isLive = streamState === "live";
  const isBusy = streamState === "initializing" || streamState === "ending";

  const onCopyViewerLink = async () => {
    if (!viewerUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopyStatus("Viewer link copied.");
    } catch {
      setCopyStatus("Failed to copy viewer link.");
    }
  };

  return (
    <div className="stack stack-5" style={{ maxWidth: 960, padding: "var(--s4) 0" }}>
      <div className="stack stack-2">
        <p className="section__label">Creator Studio</p>
        <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.5rem)", lineHeight: 1.05 }}>Go Live</h1>
        <p className="t-sm t-muted" style={{ maxWidth: 620 }}>
          Start a private IVS live stream gated by Aleo wallet access. Only entitled viewers receive signed playback tokens.
        </p>
        {activeStreamLookupPending ? <p className="t-xs t-dim">Checking for any live stream already running from this wallet...</p> : null}
      </div>

      <div
        className="card card--panel stack stack-4"
        style={{
          borderRadius: 24,
          padding: "var(--s5)",
          background: "linear-gradient(180deg, rgba(15,15,17,0.9), rgba(15,15,17,0.58))",
        }}
      >
        <div className="stack stack-2">
          <p className="t-sm t-muted">InnerCircle needs your camera and microphone to go live.</p>
          <p className="t-xs t-dim">
            Preview - only you see this. Stream credentials never appear in the UI and are used only in memory.
          </p>
        </div>

        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 24,
            background: "rgba(0,0,0,0.92)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <video
            ref={localVideoRef}
            muted
            playsInline
            autoPlay
            style={{ width: "100%", display: "block", minHeight: 340, aspectRatio: "16 / 9", objectFit: "cover" }}
          />
          {isRecoveredLiveSession ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(180deg, rgba(6,6,8,0.2), rgba(6,6,8,0.58))",
                padding: "var(--s4)",
              }}
            >
              <div
                className="card card--panel stack stack-2"
                style={{
                  width: "min(100%, 520px)",
                  borderRadius: 18,
                  background: "rgba(11,11,13,0.82)",
                  borderColor: "rgba(34,197,94,0.18)",
                }}
              >
                <span className="badge badge--secure" style={{ width: "fit-content" }}>Recovered Live Session</span>
                <p className="t-sm t-muted" style={{ margin: 0 }}>
                  This wallet already has a live stream running. This tab can control it, open the viewer page, or end it,
                  but it is not attached to the original camera preview.
                </p>
              </div>
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              padding: "8px 12px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <span className="t-xs t-muted">Preview - only you see this</span>
          </div>
        </div>

        <div className="grid-2" style={{ gap: "var(--s3)" }}>
          <div className="form-group">
            <label className="form-label">Stream title</label>
            <input
              className="form-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Tonight's private drop"
              disabled={isLive || isBusy}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Access type</label>
            <select
              className="form-select"
              value={accessType}
              onChange={(event) => setAccessType(event.target.value as "SUBSCRIPTION" | "PPV")}
              disabled={isLive || isBusy}
            >
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="PPV">Pay-per-view</option>
            </select>
          </div>
        </div>

        {accessType === "PPV" ? (
          <div className="form-group">
            <label className="form-label">PPV price (credits)</label>
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              value={ppvPriceCredits}
              onChange={(event) => setPpvPriceCredits(event.target.value)}
              disabled={isLive || isBusy}
            />
          </div>
        ) : null}

        {!isLive ? (
          <div className="row row-3" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onGoLive}
              disabled={isBusy}
            >
              {streamState === "initializing" ? "Preparing live channel..." : "Go Live"}
            </button>
          </div>
        ) : null}

        {creatorHandle && liveStreamId ? (
          <div
            className="grid-2"
            style={{
              gap: "var(--s3)",
              alignItems: "stretch",
            }}
          >
            <div
              className="card card--panel stack stack-3"
              style={{
                padding: "var(--s4)",
                borderRadius: 20,
                background: "linear-gradient(180deg, rgba(16,16,18,0.88), rgba(16,16,18,0.62))",
                borderColor: "rgba(34,197,94,0.2)",
              }}
            >
              <div className="row row-2" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                <div className="row row-2" style={{ alignItems: "center" }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "var(--c-error)",
                      boxShadow: "0 0 18px rgba(239,68,68,0.55)",
                    }}
                  />
                  <span className="badge badge--secure">Live now</span>
                </div>
                <span className="t-xs t-dim">
                  @{creatorHandle} · {accessType === "PPV" ? `${ppvPriceCredits} credits PPV` : "Subscription access"}
                </span>
              </div>

              <div className="stack stack-1">
                <p className="section__label" style={{ marginBottom: 0 }}>Stream Controls</p>
                <h2 style={{ fontSize: "1.35rem", lineHeight: 1.1 }}>{title.trim()}</h2>
                <p className="t-xs t-dim">
                  Your stream is live. Open the viewer page in a new tab or copy the access link to test the audience view.
                </p>
                {isRecoveredLiveSession ? (
                  <p className="t-xs t-dim">
                    Control was restored from the backend using your connected wallet, so you can still manage this stream after a page refresh.
                  </p>
                ) : null}
              </div>

              <div className="row row-3" style={{ flexWrap: "wrap" }}>
                <Link href={viewerPath ?? "#"} className="btn btn--secondary">
                  Open viewer page
                </Link>
                <button type="button" className="btn btn--secondary" onClick={() => void onCopyViewerLink()}>
                  Copy viewer link
                </button>
              </div>

              {copyStatus ? <p className="t-xs t-dim">{copyStatus}</p> : null}
              {playbackUrl ? <p className="t-xs t-dim">Private playback auth is active for this stream.</p> : null}
            </div>

            <div
              className="card card--panel stack stack-3"
              style={{
                padding: "var(--s4)",
                borderRadius: 20,
                borderColor: "rgba(239,68,68,0.24)",
                background: "linear-gradient(180deg, rgba(34,12,12,0.56), rgba(16,16,18,0.72))",
              }}
            >
              <div className="stack stack-1">
                <p className="section__label" style={{ marginBottom: 0 }}>End Stream</p>
                <h2 style={{ fontSize: "1.2rem", lineHeight: 1.1 }}>Close this live session cleanly</h2>
                <p className="t-xs t-dim">
                  Ending the stream stops broadcast, invalidates the current live session, and closes the viewer route for new playback tokens.
                </p>
              </div>

              {!endConfirmArmed ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setEndConfirmArmed(true)}
                  disabled={streamState !== "live"}
                  style={{
                    borderColor: "rgba(239,68,68,0.34)",
                    color: "#fecaca",
                    background: "rgba(127,29,29,0.2)",
                  }}
                >
                  Prepare to end stream
                </button>
              ) : (
                <div
                  className="stack stack-3"
                  style={{
                    padding: "var(--s3)",
                    borderRadius: 16,
                    border: "1px solid rgba(239,68,68,0.22)",
                    background: "rgba(40,12,12,0.42)",
                  }}
                >
                  <p className="t-sm t-error" style={{ margin: 0 }}>
                    End this live stream now?
                  </p>
                  <div className="row row-3" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setEndConfirmArmed(false)}
                      disabled={streamState === "ending"}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void onEndStream()}
                      disabled={streamState === "ending"}
                      style={{
                        borderColor: "rgba(239,68,68,0.42)",
                        color: "#fee2e2",
                        background: "linear-gradient(180deg, rgba(185,28,28,0.34), rgba(127,29,29,0.26))",
                      }}
                    >
                      {streamState === "ending" ? "Ending stream..." : "End stream now"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {error ? <p className="t-sm t-error">{error}</p> : null}
      </div>

      <PrivateMessagesPanel liveStreamId={liveStreamId} walletToken={walletToken} />
    </div>
  );
}
