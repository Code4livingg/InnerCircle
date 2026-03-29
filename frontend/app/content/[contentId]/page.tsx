"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { Network } from "@provablehq/aleo-types";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import { displayIdentity } from "@/features/anonymous/identity";
import {
  clearPendingProof,
  SubscriptionTranscriptUnavailableError,
  describeSubscriptionPaymentRoute,
  generatePaymentProof,
  generateSubscriptionProof,
  readPaymentProof,
  readSubscriptionInvoiceReceipt,
  recoverLatestSubscriptionInvoiceReceipt,
  storePaymentProof,
  storeSubscriptionInvoiceReceipt,
  type SubscriptionPaymentRoute,
  verifyProof,
} from "@/lib/proofs";
import { formatRemainingLabel, formatViewRemainingLabel, useCountdownSeconds } from "@/features/selfDestruct/useSelfDestructTimer";
import {
  activateSubscription,
  ApiError,
  createSubscription,
  createSession,
  fetchMediaAccessUrl,
  fetchContentById,
  fetchSubscriptionStatus,
  startSession,
  type ContentDetails,
  type MediaAccessResponse,
  type StartSessionResponse,
  unlockSubscriptionSession,
  verifyPurchase,
} from "../../../lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import {
  persistSubscriptionStatus,
  readCachedSubscriptionStatus,
} from "@/lib/subscriptionStatusCache";
import {
  executeCreditsTransfer,
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

const isAleoAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^aleo1[0-9a-z]{20,}$/i.test(value.trim());

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");

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
  const { enabled: anonEnabled, sessionId: anonSessionId } = useAnonymousMode();
  const viewerLabel = displayIdentity({ anonymousMode: anonEnabled, sessionId: anonSessionId, fallback: "Private Member" });

  const [content, setContent] = useState<ContentDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseTxId, setPurchaseTxId] = useState<string | null>(null);

  const [proofState, setProofState] = useState<ProofState>("idle");
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofTxId, setProofTxId] = useState<string | null>(null);
  const [paymentProof, setPaymentProof] = useState<string | null>(null);
  const [proofSuccessLabel, setProofSuccessLabel] = useState<string | null>(null);
  const [proofProgressLabel, setProofProgressLabel] = useState<string | null>(null);
  const [subscriptionReceiptRoute, setSubscriptionReceiptRoute] = useState<SubscriptionPaymentRoute | null>(null);
  const [hasLocalSubscriptionReceipt, setHasLocalSubscriptionReceipt] = useState(false);
  const [cachedSubscriptionTierId, setCachedSubscriptionTierId] = useState<string | null>(null);
  const [cachedSubscriptionTierName, setCachedSubscriptionTierName] = useState<string | null>(null);

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [mediaAccess, setMediaAccess] = useState<MediaAccessResponse | null>(null);
  const [traceSession, setTraceSession] = useState<StartSessionResponse | null>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionTierPrice, setSubscriptionTierPrice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadContent = async (): Promise<void> => {
      try {
        if (!anonEnabled) {
          if (!connected || !address) {
            if (!cancelled) {
              setContent(null);
              setLoadError("Connect your Aleo wallet or enable Anonymous Mode to access this content.");
            }
            return;
          }

          await getWalletSessionToken(wallet);
        }

        const data = await fetchContentById(contentId);
        if (!cancelled) {
          setContent(data.content);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || "Failed to load content.");
        }
      }
    };

    void loadContent();

    return () => {
      cancelled = true;
    };
  }, [address, anonEnabled, connected, contentId, wallet]);

  useEffect(() => {
    let cancelled = false;

    const hydrateProofs = async (): Promise<void> => {
      if (!content) {
        if (!cancelled) {
          setPaymentProof(null);
          setProofSuccessLabel(null);
          setSubscriptionReceiptRoute(null);
          setHasLocalSubscriptionReceipt(false);
        }
        return;
      }

      const savedPaymentProof = readPaymentProof(content.id);
      const savedSubscriptionReceipt = readSubscriptionInvoiceReceipt(content.creator.creatorFieldId);
      const paymentLocked = Number(content.ppvPriceMicrocredits ?? "0") > 0;

      let nextPaymentProof: string | null = null;
      let nextSubscriptionReceiptReady = false;

      try {
        if (savedPaymentProof && (await verifyProof(savedPaymentProof, content.id))) {
          nextPaymentProof = savedPaymentProof;
        }
      } catch {
        nextPaymentProof = null;
      }

      if (cancelled) {
        return;
      }

      if (
        savedSubscriptionReceipt &&
        normalizeFieldId(savedSubscriptionReceipt.circleId) === normalizeFieldId(content.creator.creatorFieldId)
      ) {
        nextSubscriptionReceiptReady = true;
        setSubscriptionReceiptRoute(savedSubscriptionReceipt.paymentRoute ?? null);
      } else {
        setSubscriptionReceiptRoute(null);
      }

      setPaymentProof(nextPaymentProof);
      setHasLocalSubscriptionReceipt(nextSubscriptionReceiptReady);
      setProofSuccessLabel(
        paymentLocked
          ? (nextPaymentProof ? "✔ Payment Verified Privately" : null)
          : (nextSubscriptionReceiptReady ? "✔ Subscription Verified Privately" : null),
      );
    };

    void hydrateProofs();

    return () => {
      cancelled = true;
    };
  }, [content]);

  const ppvPriceMicrocredits = Number(content?.ppvPriceMicrocredits ?? "0");
  const isPpvContent = ppvPriceMicrocredits > 0;
  const requiredTier = content?.subscriptionTier ?? null;
  const requiredTierPrice = Number(requiredTier?.priceMicrocredits ?? "0");
  const currentTierPrice = Number(subscriptionTierPrice ?? "0");
  const requiresTierUpgrade =
    !!requiredTier && !isPpvContent && requiredTierPrice > 0 && currentTierPrice > 0 && currentTierPrice < requiredTierPrice;
  const hasPaymentProof = Boolean(paymentProof);
  const canAttemptSubscriptionUnlock = anonEnabled ? Boolean(anonSessionId) : (hasActiveSubscription || hasLocalSubscriptionReceipt);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (anonEnabled || !content || isPpvContent || !connected || !isAleoAddress(address)) {
        if (!cancelled) {
          setHasActiveSubscription(false);
          setSubscriptionTierPrice(null);
          setCachedSubscriptionTierId(null);
          setCachedSubscriptionTierName(null);
        }
        return;
      }

      const applySubscriptionState = (input: {
        active: boolean;
        activeUntil?: string | null;
        tierId?: string | null;
        tierName?: string | null;
        tierPriceMicrocredits?: string | null;
        priceMicrocredits?: string | null;
      }): void => {
        const requiredTierPrice = Number(content.subscriptionTier?.priceMicrocredits ?? "0");
        const subscriberTierPrice = Number(input.tierPriceMicrocredits ?? input.priceMicrocredits ?? "0");
        const meetsTier = requiredTierPrice <= 0 || subscriberTierPrice >= requiredTierPrice;
        setHasActiveSubscription(input.active && meetsTier);
        setSubscriptionTierPrice(input.tierPriceMicrocredits ?? input.priceMicrocredits ?? null);
        setCachedSubscriptionTierId(input.tierId ?? null);
        setCachedSubscriptionTierName(input.tierName ?? null);
      };

      const cachedStatus = readCachedSubscriptionStatus(content.creator.handle, address);
      if (cachedStatus && !cancelled) {
        applySubscriptionState(cachedStatus);
      }

      try {
        const status = await fetchSubscriptionStatus(content.creator.handle, address);
        if (!cancelled) {
          applySubscriptionState(status);
        }
      } catch {
        if (!cancelled && !cachedStatus) {
          setHasActiveSubscription(false);
          setSubscriptionTierPrice(null);
          setCachedSubscriptionTierId(null);
          setCachedSubscriptionTierName(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, anonEnabled, connected, content, isPpvContent]);

  const streamSrc = useMemo(() => mediaAccess?.url ?? null, [mediaAccess]);
  const countdownSeconds = useCountdownSeconds(content?.expiresAt ?? null);
  const countdownLabel = formatRemainingLabel(countdownSeconds);
  const viewRemainingLabel = formatViewRemainingLabel(content?.viewLimit ?? null, content?.views ?? null);

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
        setProofProgressLabel("Encrypted stream ready.");

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
          setProofProgressLabel(null);
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

  const activateTraceSession = async (nextSessionToken: string, identityToken?: string): Promise<void> => {
    setTraceSession(null);

    const trace = await startSession({
      contentId,
      sessionToken: nextSessionToken,
      ...(identityToken ? { walletAddress: identityToken } : {}),
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
    setProofProgressLabel(null);

    try {
      await ensureWalletConnected();
      setPurchaseState("wallet");
      setProofProgressLabel("Preparing public PPV transfer...");
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
      if (!chainTxId) {
        throw new Error("PPV purchase was submitted, but the finalized on-chain tx id is not available yet.");
      }

      setPurchaseTxId(chainTxId);
      setProofProgressLabel("Generating private PPV proof...");
      const proof = await generatePaymentProof(chainTxId);
      setProofProgressLabel("Opening encrypted content session...");
      await runWithPendingRetry(() =>
        verifyPurchase({
          kind: "ppv",
          txId: chainTxId,
          contentId: content.id,
          walletAddressHint: address ?? undefined,
          paymentProof: proof,
        }),
      );

      storePaymentProof(content.id, proof);
      setPaymentProof(proof);
      setProofSuccessLabel("✔ Payment Verified Privately");
      setProofProgressLabel(null);
      setPurchaseState("success");
      setProofState("idle");
    } catch (error) {
      setPurchaseError(formatWalletError((error as Error).message || "PPV purchase failed."));
      setProofProgressLabel(null);
      setPurchaseState("idle");
      setProofState("idle");
    }
  };

  const onCreateAccessSession = async (): Promise<void> => {
    if (!content) return;

    setProofError(null);
    setProofTxId(null);
    setMediaAccess(null);
    setProofSuccessLabel(null);
    setProofProgressLabel(null);

    try {
      setProofState("verifying");

      if (isPpvContent) {
        setProofProgressLabel("Checking stored PPV proof...");
        const proof = paymentProof ?? (purchaseTxId ? await generatePaymentProof(purchaseTxId) : null);
        if (!proof) {
          throw new Error("Missing payment proof. Verify the PPV payment first.");
        }
        setProofTxId(proof);
        setProofProgressLabel("Opening encrypted content session...");
        const session = await runWithPendingRetry(() =>
          createSession({
            mode: "ppv-proof",
            contentId: content.id,
            proof,
          }),
        );
        await activateTraceSession(session.sessionToken, proof);
        setSessionToken(session.sessionToken);
        setProofSuccessLabel("✔ Payment Verified Privately");
        setProofProgressLabel("Preparing encrypted stream...");
        setProofState("success");
        return;
      }

      if (!canAttemptSubscriptionUnlock) {
        throw new Error("No active subscription payment found for this creator. Subscribe first.");
      }

      if (anonEnabled) {
        setProofProgressLabel("Opening anonymous access session...");
        const session = await runWithPendingRetry(() =>
          createSession({
            mode: "subscription-anon",
            creatorHandle: content.creator.handle,
          }),
        );
        await activateTraceSession(session.sessionToken);
        setSessionToken(session.sessionToken);
        setProofSuccessLabel("✔ Anonymous Session Active");
        setProofProgressLabel("Preparing encrypted stream...");
        setProofState("success");
        return;
      }

      await ensureWalletConnected();
      const walletToken = await getWalletSessionToken(wallet);
      const circleId = content.creator.creatorFieldId;
      const tierIdForSync = cachedSubscriptionTierId ?? undefined;
      setProofProgressLabel("Locating private invoice...");
      const receipt =
        readSubscriptionInvoiceReceipt(circleId) ??
        (await recoverLatestSubscriptionInvoiceReceipt(wallet, circleId));

      if (!receipt) {
        throw new Error("No private subscription invoice found in local storage or the connected wallet.");
      }

      setSubscriptionReceiptRoute(receipt.paymentRoute ?? null);
      setHasLocalSubscriptionReceipt(true);
      storeSubscriptionInvoiceReceipt(circleId, receipt);
      const walletAddressHint = address ?? receipt.owner;
      try {
        setProofProgressLabel("Generating local ZK proof...");
        const { proof: subscriptionProof, transactionId: verifyTransactionId } = await generateSubscriptionProof(
          wallet,
          receipt,
          circleId,
          {
            contentId: content.id,
            onStatus: (status, transactionId) => {
              if (transactionId) {
                setProofTxId(transactionId);
              }

              switch (status) {
                case "accepted":
                  setProofProgressLabel("Transaction submitted. Waiting for on-chain finalization...");
                  break;
                case "waiting_finality":
                  setProofProgressLabel("Waiting for on-chain finalization...");
                  break;
                case "fetching_proof":
                  setProofProgressLabel("Fetching execution proof from wallet...");
                  break;
                default:
                  break;
              }
            },
          },
        );
        setProofTxId(verifyTransactionId);
        setProofProgressLabel("Syncing subscription with backend...");
        const syncedSubscription = await runWithPendingRetry(() =>
          createSubscription(
            {
              kind: "subscription",
              executionProof: subscriptionProof,
              nullifier: receipt.nullifier,
              circleId,
              tierId: tierIdForSync,
              paymentTxId: receipt.transactionId,
            },
            walletToken,
          ),
        );
        setHasActiveSubscription(true);
        setSubscriptionTierPrice(syncedSubscription.priceMicrocredits);
        setCachedSubscriptionTierId(syncedSubscription.tierId);
        setCachedSubscriptionTierName(syncedSubscription.tierName);
        if (isAleoAddress(walletAddressHint)) {
          persistSubscriptionStatus(content.creator.handle, walletAddressHint, {
            active: true,
            activeUntil: syncedSubscription.expiresAt,
            tierName: syncedSubscription.tierName,
            tierId: syncedSubscription.tierId,
            tierPriceMicrocredits: syncedSubscription.priceMicrocredits,
          });
        }

        setProofProgressLabel("Opening private access session...");
        const session = await runWithPendingRetry(() =>
          unlockSubscriptionSession(
            {
              mode: "subscription-zk",
              circleId,
              nullifier: receipt.nullifier,
              executionProof: subscriptionProof,
            },
            walletToken,
          ),
        );
        await activateTraceSession(session.sessionToken, address ?? receipt.owner);
        setSessionToken(session.sessionToken);
        setProofSuccessLabel("✔ Subscription Verified Privately");
        setProofProgressLabel("Preparing encrypted stream...");
        setProofState("success");
      } catch (error) {
        if (!(error instanceof SubscriptionTranscriptUnavailableError)) {
          throw error;
        }

        if (!receipt.transactionId) {
          throw new Error(
            "Stored subscription invoice is missing its payment transaction id. Retry subscribe to refresh the invoice metadata.",
          );
        }

        const purchaseTxId = receipt.transactionId;
        const signerAddress = address ?? receipt.owner;
        setProofTxId(error.transactionId);
        setProofProgressLabel("Wallet transcript API unavailable. Finalizing with on-chain tx verification...");
        const activatedSubscription = await runWithPendingRetry(() =>
          activateSubscription(
            {
              txId: error.transactionId,
              paymentTxId: purchaseTxId,
              circleId,
              tierId: tierIdForSync,
              address: signerAddress,
            },
            walletToken,
          ),
        );
        setHasActiveSubscription(true);
        setSubscriptionTierPrice(subscriptionTierPrice ?? content.creator.subscriptionPriceMicrocredits ?? null);
        setCachedSubscriptionTierId(tierIdForSync ?? null);
        setCachedSubscriptionTierName(cachedSubscriptionTierName ?? requiredTier?.tierName ?? null);
        if (isAleoAddress(signerAddress)) {
          persistSubscriptionStatus(content.creator.handle, signerAddress, {
            active: true,
            activeUntil: activatedSubscription.expiresAt,
            tierName: cachedSubscriptionTierName,
            tierId: tierIdForSync ?? null,
            tierPriceMicrocredits: subscriptionTierPrice ?? content.creator.subscriptionPriceMicrocredits ?? null,
          });
        }

        setProofProgressLabel("Opening on-chain subscription session...");
        const session = await runWithPendingRetry(() =>
          createSession({
            mode: "subscription-direct",
            creatorHandle: content.creator.handle,
            purchaseTxId,
            walletAddressHint: signerAddress,
            tierId: tierIdForSync,
          }),
        );
        await activateTraceSession(session.sessionToken, signerAddress);
        setSessionToken(session.sessionToken);
        setProofSuccessLabel("✔ Subscription Verified On-Chain");
        setProofProgressLabel("Preparing encrypted stream...");
        setProofState("success");
      }
    } catch (error) {
      const rawMessage = (error as Error).message || "Failed to open the content session.";
      if (/user rejected|reject|denied|cancel|declined/i.test(rawMessage)) {
        clearPendingProof(content.id);
      }
      if (
        /verification transaction was already submitted|still finalizing|on-chain tx id is not available yet/i.test(
          rawMessage,
        )
      ) {
        setProofError(null);
        setProofProgressLabel(rawMessage);
        setProofState("idle");
        return;
      }

      setProofError(formatWalletError(rawMessage));
      setProofProgressLabel(null);
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
              : requiredTier
                ? ` · ${requiredTier.tierName} tier required`
                : " · Subscription content"}
          </p>
          <div className="row row-2" style={{ flexWrap: "wrap" }}>
            <span className="badge badge--secure">Encrypted</span>
            {!isPpvContent ? <span className="badge badge--secure">Private Invoice</span> : null}
            {anonEnabled ? <span className="badge badge--neutral">Anonymous Mode ON</span> : null}
            {proofSuccessLabel ? <span className="badge badge--secure">{proofSuccessLabel}</span> : null}
          </div>
        </div>
        <SessionBadge />
      </div>

      {streamSrc ? (
        <>
          <div className="stream-player-wrap">
            {traceSession ? (
              String(content.mimeType ?? "").toLowerCase().startsWith("video/") ? (
                <ProtectedVideoPlayer
                  src={streamSrc}
                  title={content.title}
                  fingerprint={traceSession.fingerprint}
                  viewerLabel={viewerLabel}
                  sessionId={traceSession.sessionId}
                />
              ) : (
                <StreamingPlayer
                  src={streamSrc}
                  mimeType={content.mimeType}
                  title={content.title}
                  watermark={{
                    fingerprint: traceSession.fingerprint,
                    viewerLabel: viewerLabel,
                    sessionId: traceSession.sessionId,
                  }}
                />
              )
            ) : (
              <div className="card card--panel" style={{ textAlign: "center" }}>
                <div className="spinner" style={{ margin: "0 auto" }} />
                <p className="t-sm t-muted" style={{ marginTop: "var(--s2)" }}>
                  Preparing privacy watermark...
                </p>
              </div>
            )}
          </div>
          <div className="card stream-controls">
            <p className="t-xs t-dim">
              Session active. Media is delivered through a short-lived private S3 signed URL issued by the backend.
              {traceSession ? ` Watermark viewer ${traceSession.fingerprint} expires at ${traceSession.expiresAt}.` : ""}
              {mediaAccess ? ` Media URL refreshes every ${mediaAccess.expiresIn} seconds.` : ""}
            </p>
            {countdownLabel ? <p className="t-xs t-dim">{countdownLabel}</p> : null}
            {viewRemainingLabel ? <p className="t-xs t-dim">{viewRemainingLabel}</p> : null}
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
                disabled={!hasPaymentProof || proofState === "wallet" || proofState === "verifying"}
              >
                {proofState === "wallet" && "Waiting for wallet..."}
                {proofState === "verifying" && "Verifying proof..."}
                {proofState === "success" && "Unlocked"}
                {proofState === "idle" && "Unlock with Proof"}
              </button>
            </div>
          ) : (
            <div className="stack stack-2">
              <p className="t-sm t-muted">
                Your wallet keeps the private subscription invoice. Unlocking generates a fresh local proof from that
                invoice without uploading the private record to the backend.
              </p>
              {subscriptionReceiptRoute ? (
                <p className="t-xs t-dim">
                  Stored invoice route: {describeSubscriptionPaymentRoute(subscriptionReceiptRoute)}
                </p>
              ) : null}
              <button
                type="button"
                className="btn btn--primary"
                onClick={onCreateAccessSession}
                disabled={proofState === "wallet" || proofState === "verifying" || !canAttemptSubscriptionUnlock}
              >
                {proofState === "wallet" && "Waiting for wallet..."}
                {proofState === "verifying" && "Verifying private invoice..."}
                {proofState === "success" && "Unlocked"}
                {proofState === "idle" &&
                  (hasActiveSubscription
                    ? "Unlock with Private Invoice"
                    : hasLocalSubscriptionReceipt
                      ? "Resume Subscription Unlock"
                      : "Subscribe to Unlock")}
              </button>
            </div>
          )}

          {proofTxId ? (
            <p className="t-xs t-dim" style={{ marginTop: "var(--s2)", wordBreak: "break-all" }}>
              verify tx: {proofTxId}
            </p>
          ) : null}

          {proofProgressLabel ? <p className="t-xs t-dim">{proofProgressLabel}</p> : null}

          {countdownLabel ? <p className="t-xs t-dim">{countdownLabel}</p> : null}
          {viewRemainingLabel ? <p className="t-xs t-dim">{viewRemainingLabel}</p> : null}
          {proofError ? <p className="t-sm t-error">{proofError}</p> : null}
          {!isPpvContent && !canAttemptSubscriptionUnlock ? (
            requiresTierUpgrade ? (
              <p className="t-sm t-error">
                Your current tier does not unlock this content. Upgrade to the {requiredTier?.tierName ?? "next"} tier.
              </p>
            ) : (
              <p className="t-sm t-muted">No active subscription payment found for this creator yet.</p>
            )
          ) : null}
          {!isPpvContent && hasLocalSubscriptionReceipt && !hasActiveSubscription ? (
            <p className="t-sm t-muted">
              Local subscription invoice found. Backend status is still syncing, but unlock will retry that sync automatically.
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
