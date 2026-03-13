"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createCreatorLiveStream, endCreatorLiveStream, fetchCreatorByWallet } from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import { useWallet } from "@/lib/walletContext";

type StreamState = "idle" | "initializing" | "live" | "ending";

interface IvsBroadcastClientLike {
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
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      void Promise.resolve(broadcastClientRef.current?.stopBroadcast?.()).catch(() => undefined);
      broadcastClientRef.current = null;
    };
  }, []);

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
        STANDARD_LANDSCAPE: unknown;
        create: (config: { streamConfig: unknown; ingestEndpoint: string }) => IvsBroadcastClientLike;
      };

      const client = ivsClient.create({
        streamConfig: ivsClient.STANDARD_LANDSCAPE,
        ingestEndpoint: liveStream.ingestEndpoint,
      });

      await Promise.resolve(client.addVideoInputDevice(stream, "camera1", { index: 0 }));
      await Promise.resolve(client.addAudioInputDevice(stream, "mic1"));
      await client.startBroadcast(liveStream.streamKeyValue);

      broadcastClientRef.current = client;
      setLiveStreamId(liveStream.liveStreamId);
      setPlaybackUrl(liveStream.playbackUrl);
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
      setStreamState("idle");
    } catch (endError) {
      setStreamState("live");
      setError((endError as Error).message || "Failed to end live stream.");
    }
  };

  return (
    <div className="stack stack-5" style={{ maxWidth: 960, padding: "var(--s4) 0" }}>
      <div className="stack stack-2">
        <p className="section__label">Creator Studio</p>
        <h1 style={{ fontSize: "2.25rem" }}>Go Live</h1>
        <p className="t-sm t-muted" style={{ maxWidth: 620 }}>
          Start a private IVS live stream gated by Aleo wallet access. Only entitled viewers receive signed playback tokens.
        </p>
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
            style={{ width: "100%", display: "block", minHeight: 340, objectFit: "cover" }}
          />
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
            />
          </div>

          <div className="form-group">
            <label className="form-label">Access type</label>
            <select
              className="form-select"
              value={accessType}
              onChange={(event) => setAccessType(event.target.value as "SUBSCRIPTION" | "PPV")}
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
            />
          </div>
        ) : null}

        <div className="row row-3" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onGoLive}
            disabled={streamState === "initializing" || streamState === "live" || streamState === "ending"}
          >
            {streamState === "initializing" ? "Preparing live channel..." : "Go Live"}
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            onClick={onEndStream}
            disabled={streamState !== "live" && streamState !== "ending"}
          >
            {streamState === "ending" ? "Ending stream..." : "End Stream"}
          </button>

          {liveStreamId ? (
            <Link href={`/live/${liveStreamId}`} className="btn btn--secondary">
              Open viewer page
            </Link>
          ) : null}
        </div>

        {creatorHandle && liveStreamId ? (
          <p className="t-xs t-dim">
            Live as @{creatorHandle}. Playback is gated behind wallet access and IVS signed tokens.
          </p>
        ) : null}

        {playbackUrl ? (
          <p className="t-xs t-dim">Private playback auth is active for this stream.</p>
        ) : null}

        {error ? <p className="t-sm t-error">{error}</p> : null}
      </div>
    </div>
  );
}
