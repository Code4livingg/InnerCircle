"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { Network } from "@provablehq/aleo-types";
import {
  ApiError,
  createSession,
  fetchMediaAccessUrl,
  fetchContentById,
  fetchSubscriptionStatus,
  startSession,
  type ContentDetails,
  type MediaAccessResponse,
  type StartSessionResponse,
  verifyPurchase,
} from "../../../lib/api";
import {
  executeCreditsTransfer,
  isOnChainAleoTxId,
  waitForOnChainTransactionId,
} from "../../../lib/aleoTransactions";
import { SessionBadge } from "../../../components/SessionBadge";
import { ProtectedVideoPlayer } from "../../../components/ProtectedVideoPlayer";
import { StreamingPlayer } from "../../../components/StreamingPlayer";

type PurchaseState = "idle" | "wallet" | "verifying" | "success";
type ProofState = "idle" | "wallet" | "verifying" | "success";

interface ContentPageProps {
  params: Promise<{ contentId: string }>;
}

const CREDITS_PROGRAM_ID = "credits.aleo";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const runWithPendingRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const maxAttempts = 45;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = error instanceof ApiError && error.code === "TX_PENDING";
      const isLastAttempt = i === maxAttempts - 1;
      if (!shouldRetry || isLastAttempt) {
        throw error;
      }
      await wait(2000);
    }
  }

  throw new Error("Timed out waiting for on-chain confirmation.");
};

const formatWalletError = (message: string): string => {
  if (/no selected account/i.test(message)) {
    return "Wallet account is not selected. Open wallet extension, select account, reconnect, and retry.";
  }
  if (/failed to execute transaction/i.test(message)) {
    return `${message}. Reconnect wallet and confirm the account has enough testnet balance for fees.`;
  }
  return message;
};

export default function ContentPage({ params }: ContentPageProps) {
  const { contentId } = use(params);
  const wallet = useWallet();
  const { connected, address, network } = wallet;

  const [content, setContent] = useState<ContentDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseTxId, setPurchaseTxId] = useState<string | null>(null);
  const [ppvPurchased, setPpvPurchased] = useState(false);

  const [proofState, setProofState] = useState<ProofState>("idle");
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofTxId, setProofTxId] = useState<string | null>(null);

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [mediaAccess, setMediaAccess] = useState<MediaAccessResponse | null>(null);
  const [traceSession, setTraceSession] = useState<StartSessionResponse | null>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionTxId, setSubscriptionTxId] = useState<string | null>(null);

  useEffect(() => {
    fetchContentById(contentId)
      .then((data) => {
        setContent(data.content);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError((error as Error).message || "Failed to load content.");
      });
  }, [contentId]);

  const ppvPriceMicrocredits = Number(content?.ppvPriceMicrocredits ?? "0");
  const isPpvContent = ppvPriceMicrocredits > 0;

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!content || isPpvContent || !connected || !address) {
        if (!cancelled) {
          setHasActiveSubscription(false);
          setSubscriptionTxId(null);
        }
        return;
      }

      try {
        const status = await fetchSubscriptionStatus(content.creator.handle, address);
        if (!cancelled) {
          setHasActiveSubscription(status.active);
          setSubscriptionTxId(status.active ? status.txId : null);
        }
      } catch {
        if (!cancelled) {
          setHasActiveSubscription(false);
          setSubscriptionTxId(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, connected, content, isPpvContent]);

  const streamSrc = useMemo(() => mediaAccess?.url ?? null, [mediaAccess]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;

    const refreshSignedUrl = async (): Promise<void> => {
      if (!sessionToken) {
        if (!cancelled) {
          setMediaAccess(null);
        }
        return;
      }

      try {
        const nextMediaAccess = await fetchMediaAccessUrl(contentId, sessionToken);
        if (cancelled) {
          return;
        }

        setMediaAccess(nextMediaAccess);

        const shouldRefreshContinuously = !!content && !String(content.mimeType ?? "").toLowerCase().startsWith("image/");
        if (shouldRefreshContinuously) {
          const refreshDelayMs = Math.max((nextMediaAccess.expiresIn - 15) * 1000, 15_000);
          refreshTimer = window.setTimeout(() => {
            void refreshSignedUrl();
          }, refreshDelayMs);
        }
      } catch (error) {
        if (!cancelled) {
          setMediaAccess(null);
          setProofError((error as Error).message || "Failed to prepare secure media playback.");
        }
      }
    };

    void refreshSignedUrl();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [content, contentId, sessionToken]);

  const activateTraceSession = async (nextSessionToken: string): Promise<void> => {
    if (!address) {
      throw new Error("Connect your Aleo wallet first.");
    }

    setTraceSession(null);

    const trace = await startSession({
      contentId,
      walletAddress: address,
      sessionToken: nextSessionToken,
    });

    setTraceSession(trace);
  };

  const ensureWalletConnected = async (): Promise<void> => {
    if (!connected || !address) {
      throw new Error("Connect your Aleo wallet first.");
    }

    if (network !== Network.TESTNET) {
      const switched = await wallet.switchNetwork(Network.TESTNET);
      if (!switched && wallet.network !== Network.TESTNET) {
        throw new Error("Switch wallet network to Aleo testnet and try again.");
      }
    }
  };

  const onBuyPpv = async (): Promise<void> => {
    if (!content) return;

    setPurchaseError(null);
    setPurchaseTxId(null);
    setMediaAccess(null);

    try {
      await ensureWalletConnected();
      setPurchaseState("wallet");
      if (!content.creator.walletAddress || !content.creator.walletAddress.startsWith("aleo1")) {
        throw new Error("Creator wallet address is missing. The creator needs to update their profile.");
      }
      const walletTxId = await executeCreditsTransfer({
        wallet,
        recipientAddress: content.creator.walletAddress,
        amountMicrocredits: content.ppvPriceMicrocredits ?? "0",
      });

      setPurchaseTxId(walletTxId);
      setPurchaseState("verifying");

      const chainTxId = await waitForOnChainTransactionId(wallet, walletTxId, CREDITS_PROGRAM_ID, {
        attempts: 60,
        delayMs: 2000,
      });

      setPurchaseTxId(chainTxId);
      await runWithPendingRetry(() =>
        verifyPurchase({
          kind: "ppv",
          txId: chainTxId,
          contentId: content.id,
          walletAddressHint: address ?? undefined,
        }),
      );

      setPpvPurchased(true);
      setPurchaseState("success");

      // Immediately create a session from the verified purchase tx — no separate ZK proof step needed
      setProofState("verifying");
      const session = await runWithPendingRetry(() =>
        createSession({
          mode: "ppv-direct",
          contentId: content.id,
          purchaseTxId: chainTxId,
          walletAddressHint: address ?? undefined,
        }),
      );
      await activateTraceSession(session.sessionToken);
      setSessionToken(session.sessionToken);
      setProofState("success");
    } catch (error) {
      setPurchaseError(formatWalletError((error as Error).message || "PPV purchase failed."));
      setPurchaseState("idle");
      setProofState("idle");
    }
  };

  const onCreateAccessSession = async (): Promise<void> => {
    if (!content) return;

    setProofError(null);
    setProofTxId(null);
    setMediaAccess(null);

    try {
      await ensureWalletConnected();
      setProofState("verifying");

      if (isPpvContent) {
        if (!purchaseTxId || !isOnChainAleoTxId(purchaseTxId)) {
          throw new Error("Buy PPV access before opening the stream.");
        }

        const session = await runWithPendingRetry(() =>
          createSession({
            mode: "ppv-direct",
            contentId: content.id,
            purchaseTxId: purchaseTxId,
            walletAddressHint: address ?? undefined,
          }),
        );
        await activateTraceSession(session.sessionToken);
        setSessionToken(session.sessionToken);
        setProofState("success");
        return;
      }

      const creatorHandle = content.creator.handle;
      if (!hasActiveSubscription || !subscriptionTxId || !isOnChainAleoTxId(subscriptionTxId)) {
        throw new Error("No active subscription payment found for this creator. Subscribe first.");
      }

      setProofTxId(subscriptionTxId);

      const session = await runWithPendingRetry(() =>
        createSession({
          mode: "subscription-direct",
          creatorHandle,
          purchaseTxId: subscriptionTxId,
          walletAddressHint: address ?? undefined,
        }),
      );
      await activateTraceSession(session.sessionToken);
      setSessionToken(session.sessionToken);
      setProofState("success");
    } catch (error) {
      setProofError(formatWalletError((error as Error).message || "Failed to open the content session."));
      setProofState("idle");
    }
  };

  if (loadError) {
    return (
      <main className="stream-page">
        <div className="card card--panel" style={{ width: "100%", maxWidth: 900 }}>
          <p className="t-sm t-error">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!content) {
    return (
      <main className="stream-page">
        <div className="card card--panel" style={{ width: "100%", maxWidth: 900, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p className="t-sm t-muted" style={{ marginTop: "var(--s2)" }}>
            Loading content...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="stream-page">
      <div className="stream-header">
        <div className="stack stack-1">
          <Link
            href={`/creator/${content.creator.handle}`}
            className="t-xs t-dim btn btn--ghost btn--sm"
            style={{ padding: 0, height: "auto" }}
          >
            Back to creator
          </Link>
          <h3>{content.title}</h3>
          <p className="t-sm t-muted">
            @{content.creator.handle}
            {isPpvContent
              ? ` · ${ppvPriceMicrocredits.toLocaleString()} microcredits PPV`
              : " · Subscription content"}
          </p>
        </div>
        <SessionBadge />
      </div>

      {streamSrc ? (
        <>
          <div className="stream-player-wrap">
            {String(content.mimeType ?? "").toLowerCase().startsWith("video/") ? (
              traceSession && streamSrc ? (
                <ProtectedVideoPlayer
                  src={streamSrc}
                  title={content.title}
                  fingerprint={traceSession.fingerprint}
                  shortWallet={traceSession.shortWallet}
                  sessionId={traceSession.sessionId}
                />
              ) : (
                <div className="card card--panel" style={{ textAlign: "center" }}>
                  <div className="spinner" style={{ margin: "0 auto" }} />
                  <p className="t-sm t-muted" style={{ marginTop: "var(--s2)" }}>
                    Preparing privacy watermark...
                  </p>
                </div>
              )
            ) : (
              <StreamingPlayer src={streamSrc} mimeType={content.mimeType} title={content.title} />
            )}
          </div>
          <div className="card stream-controls">
            <p className="t-xs t-dim">
              Session active. Media is delivered through a short-lived private S3 signed URL issued by the backend.
              {traceSession ? ` Watermark viewer ${traceSession.fingerprint} expires at ${traceSession.expiresAt}.` : ""}
              {mediaAccess ? ` Media URL refreshes every ${mediaAccess.expiresIn} seconds.` : ""}
            </p>
          </div>
        </>
      ) : (
        <div className="card" style={{ width: "100%", maxWidth: 900 }}>
          <p className="dashboard__panel-title" style={{ marginBottom: "var(--s3)" }}>
            Unlock Content
          </p>

          {isPpvContent ? (
            <div className="stack stack-2">
              <button
                type="button"
                className="btn btn--primary"
                onClick={onBuyPpv}
                disabled={purchaseState === "wallet" || purchaseState === "verifying" || purchaseState === "success"}
              >
                {purchaseState === "wallet" && "Preparing wallet transfer..."}
                {purchaseState === "verifying" && "Verifying PPV payment on-chain..."}
                {purchaseState === "success" && "PPV purchase confirmed"}
                {purchaseState === "idle" && "Buy PPV Access"}
              </button>

              {purchaseTxId ? (
                <p className="t-xs t-dim" style={{ wordBreak: "break-all" }}>
                  buy tx: {purchaseTxId}
                </p>
              ) : null}

              {purchaseError ? <p className="t-sm t-error">{purchaseError}</p> : null}

              <button
                type="button"
                className="btn btn--secondary"
                onClick={onCreateAccessSession}
                disabled={!ppvPurchased || proofState === "wallet" || proofState === "verifying"}
              >
                {proofState === "wallet" && "Waiting for wallet..."}
                {proofState === "verifying" && "Creating access session..."}
                {proofState === "success" && "Session Ready"}
                {proofState === "idle" && "Open Purchased Content"}
              </button>
            </div>
          ) : (
            <div className="stack stack-2">
              <button
                type="button"
                className="btn btn--primary"
                onClick={onCreateAccessSession}
                disabled={proofState === "wallet" || proofState === "verifying" || !hasActiveSubscription}
              >
                {proofState === "wallet" && "Waiting for wallet..."}
                {proofState === "verifying" && "Creating session from subscription..."}
                {proofState === "success" && "Session Ready"}
                {proofState === "idle" && (hasActiveSubscription ? "Open with Active Subscription" : "Subscribe to Unlock")}
              </button>
            </div>
          )}

          {proofTxId ? (
            <p className="t-xs t-dim" style={{ marginTop: "var(--s2)", wordBreak: "break-all" }}>
              access tx: {proofTxId}
            </p>
          ) : null}

          {proofError ? <p className="t-sm t-error">{proofError}</p> : null}
          {!isPpvContent && !hasActiveSubscription ? (
            <p className="t-sm t-muted">No active subscription payment found for this creator yet.</p>
          ) : null}
        </div>
      )}
    </main>
  );
}
