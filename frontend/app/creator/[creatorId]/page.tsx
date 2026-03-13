"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState, useCallback } from "react";
import { useWallet } from "@/lib/walletContext";
import { Network } from "@provablehq/aleo-types";
import {
  ApiError,
  fetchCreatorByHandle,
  fetchSubscriptionStatus,
  type CreatorWithContent,
  verifyPurchase,
} from "../../../lib/api";
import { getWalletRole, type AppRole } from "../../../lib/walletRole";
import {
  executeCreditsTransfer,
  type FeePreference,
  waitForOnChainTransactionId,
} from "../../../lib/aleoTransactions";
import { LockedContentCard } from "../../../components/LockedContentCard";

interface CreatorPageProps {
  params: Promise<{ creatorId: string }>;
}

type SubscribeState = "idle" | "wallet" | "verifying" | "success";

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

const formatCredits = (microcredits: string | null): string => {
  const value = Number(microcredits ?? "0");
  return `${(value / 1_000_000).toFixed(2)} credits / month`;
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

function accentColor(handle: string): string {
  const palette = ["#7c6fcd", "#4e9ea3", "#8a7fbd", "#5a9e72", "#9e7a4e", "#6a7fbd", "#a07090"];
  let hash = 0;
  for (let i = 0; i < handle.length; i += 1) {
    hash = handle.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

function getInitials(creator: CreatorWithContent): string {
  const name = creator.displayName ?? creator.handle;
  return name
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export default function CreatorPage({ params }: CreatorPageProps) {
  const { creatorId } = use(params);
  const wallet = useWallet();
  const { connected, address, network } = wallet;

  const [creator, setCreator] = useState<CreatorWithContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribeState, setSubscribeState] = useState<SubscribeState>("idle");
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [subscribeTxId, setSubscribeTxId] = useState<string | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [subscriptionActiveUntil, setSubscriptionActiveUntil] = useState<string | null>(null);
  const [walletRole, setWalletRole] = useState<AppRole | null>(null);
  const [showMembership, setShowMembership] = useState(false);

  useEffect(() => {
    fetchCreatorByHandle(creatorId)
      .then((data) => {
        setCreator(data.creator);
        setError(null);
      })
      .catch((err) => {
        setError("Creator not found or server unavailable.");
      });
  }, [creatorId]);

  useEffect(() => {
    setWalletRole(getWalletRole(address));
  }, [address]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
        }
        return;
      }

      const subscriptionPrice = BigInt(creator.subscriptionPriceMicrocredits ?? "0");
      if (subscriptionPrice <= 0n) {
        if (!cancelled) {
          setHasSubscription(true);
          setSubscriptionActiveUntil(null);
        }
        return;
      }

      if (!connected || !address) {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
        }
        return;
      }

      try {
        const status = await fetchSubscriptionStatus(creator.handle, address);
        if (!cancelled) {
          setHasSubscription(status.active);
          setSubscriptionActiveUntil(status.activeUntil);
        }
      } catch {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, connected, creator]);

  const canAccessContent = useMemo(() => {
    if (!creator) return false;
    const subscriptionPrice = Number(creator.subscriptionPriceMicrocredits ?? "0");
    return subscriptionPrice === 0 || hasSubscription;
  }, [creator, hasSubscription]);

  const creatorWalletReady = useMemo(
    () => Boolean(creator?.walletAddress && creator.walletAddress.startsWith("aleo1")),
    [creator],
  );

  const onSubscribe = async (): Promise<void> => {
    if (!creator) return;

    if (!connected || !address) {
      setSubscribeError("Connect your Aleo wallet before subscribing.");
      return;
    }

    if (walletRole === "creator") {
      setSubscribeError("Creator wallets cannot subscribe. Connect a fan wallet.");
      return;
    }

    if (hasSubscription) {
      setSubscribeError("This subscription is already active.");
      return;
    }

    if (network !== Network.TESTNET) {
      try {
        const switched = await wallet.switchNetwork(Network.TESTNET);
        if (!switched && wallet.network !== Network.TESTNET) {
          throw new Error("Switch wallet network to Aleo testnet and try again.");
        }
      } catch {
        setSubscribeError("Switch wallet network to Aleo testnet and try again.");
        return;
      }
    }

    setSubscribeError(null);
    setSubscribeTxId(null);

    try {
      setSubscribeState("wallet");
      if (!creatorWalletReady) {
        setSubscribeError("Creator wallet address is missing. The creator needs to update their profile.");
        setSubscribeState("idle");
        return;
      }
      const subscriptionPrice = BigInt(creator.subscriptionPriceMicrocredits ?? "0");
      if (subscriptionPrice <= 0n) {
        setHasSubscription(true);
        setSubscribeState("success");
        return;
      }

      const runSubscriptionAttempt = async (feePreference: FeePreference): Promise<string> => {
        const walletTxId = await executeCreditsTransfer({
          wallet,
          recipientAddress: creator.walletAddress,
          amountMicrocredits: creator.subscriptionPriceMicrocredits ?? "0",
          feePreference,
        });

        setSubscribeTxId(walletTxId);
        setSubscribeState("verifying");

        const chainTxId = await waitForOnChainTransactionId(wallet, walletTxId, CREDITS_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });
        setSubscribeTxId(chainTxId);
        await runWithPendingRetry(() =>
          verifyPurchase({
            kind: "subscription",
            txId: chainTxId,
            creatorHandle: creator.handle,
            walletAddressHint: address ?? undefined,
          }),
        );

        const status = await fetchSubscriptionStatus(creator.handle, address ?? "");
        setHasSubscription(status.active);
        setSubscriptionActiveUntil(status.activeUntil);

        return chainTxId;
      };

      const isShieldWallet = String(wallet.wallet?.adapter?.name ?? "").toLowerCase().includes("shield");
      let chainTxId: string;

      try {
        chainTxId = await runSubscriptionAttempt("auto");
      } catch (error) {
        const message = (error as Error).message ?? "";
        const shouldRetryShieldWithAlternateFee =
          isShieldWallet &&
          /status "rejected"|transaction was not confirmed/i.test(message);

        if (!shouldRetryShieldWithAlternateFee) {
          throw error;
        }

        if (process.env.NODE_ENV !== "production") {
          console.warn("[InnerCircle][Shield] retrying subscription with alternate fee order", {
            reason: message,
          });
        }

        chainTxId = await runSubscriptionAttempt("aleo_first");
      }

      setSubscribeTxId(chainTxId);
      setHasSubscription(true);
      setSubscribeState("success");
    } catch (err) {
      const message = formatWalletError((err as Error).message || "Subscription transaction failed.");
      setSubscribeError(message);
      setSubscribeState("idle");
    }
  };

  if (error) {
    return (
      <main className="creator-page">
        <div className="card card--panel">
          <p className="t-error t-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!creator) {
    return (
      <main className="creator-page">
        <div className="card card--panel" style={{ textAlign: "center", padding: "var(--s8)" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p className="t-muted t-sm" style={{ marginTop: "var(--s3)" }}>
            Loading creator...
          </p>
        </div>
      </main>
    );
  }

  const color = accentColor(creator.handle);
  const initials = getInitials(creator);
  const subscriptionLabel = formatCredits(creator.subscriptionPriceMicrocredits);
  const activeUntilLabel = subscriptionActiveUntil
    ? new Date(subscriptionActiveUntil).toLocaleString()
    : null;

  return (
    <main className="creator-page">
      <div className="card creator-hero" style={{ marginBottom: "var(--s6)" }}>
        <div className="creator-hero__inner">
          <div
            className="creator-hero__avatar"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${color}33, ${color}11)`,
              border: `1px solid ${color}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1rem",
              fontWeight: 600,
              color,
              letterSpacing: "0.04em",
            }}
          >
            {initials}
          </div>
          <div className="stack stack-2">
            <div className="stack stack-1">
              <span className="t-xs t-dim" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
                @{creator.handle}
                {creator.isVerified ? " · Verified" : ""}
              </span>
              <h2>{creator.displayName ?? creator.handle}</h2>
            </div>
            {creator.bio ? <p className="t-sm t-muted">{creator.bio}</p> : null}
            <div className="row row-2">
              <span className="badge badge--locked">Private Channel</span>
            </div>
          </div>
        </div>
      </div>

      <div className="creator-content-grid">
        <div className="stack stack-4">
          <div>
            <p className="dashboard__panel-title">
              Content {creator.contents.length > 0 ? `· ${creator.contents.length} items` : ""}
            </p>
            {creator.contents.length === 0 ? (
              <div className="card card--panel" style={{ textAlign: "center", padding: "var(--s6)" }}>
                <p className="t-muted t-sm">No content published yet.</p>
              </div>
            ) : (
              <div className="grid-2" style={{ gap: "var(--s3)" }}>
                {creator.contents.map((item) => {
                  const card = <LockedContentCard title={item.title} locked={!canAccessContent} />;
                  if (!canAccessContent) {
                    return <div key={item.id}>{card}</div>;
                  }
                  return (
                    <Link key={item.id} href={`/content/${item.id}`} style={{ textDecoration: "none" }}>
                      {card}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="stack stack-3">
          <div className="card card--panel">
            <div
              className="row between"
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => setShowMembership((v) => !v)}
            >
              <p className="dashboard__panel-title" style={{ marginBottom: 0 }}>Membership</p>
              <span
                className="t-dim"
                style={{
                  fontSize: "1.25rem",
                  transition: "transform 0.25s",
                  transform: showMembership ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            </div>

            {showMembership && (
              <>
                <div className="stack stack-1" style={{ marginTop: "var(--s2)", marginBottom: "var(--s3)" }}>
                  <span className="t-xs t-dim">Subscription price</span>
                  <span className="t-lg" style={{ fontFamily: "var(--font-sans)", fontWeight: 600, letterSpacing: "-0.02em", color }}>
                    {subscriptionLabel}
                  </span>
                  <span className="t-xs t-dim">Paid via {CREDITS_PROGRAM_ID}/transfer_public</span>
                </div>
                <p className="t-sm t-muted" style={{ marginBottom: "var(--s3)" }}>
                  Payments go directly from your public balance to the creator&apos;s public balance through{" "}
                  <code>credits.aleo</code>. Subscription access is tracked from the verified payment history.
                </p>

                {!creatorWalletReady ? (
                  <p className="t-sm t-error" style={{ marginBottom: "var(--s3)" }}>
                    This creator has not finished wallet setup yet, so subscriptions are temporarily unavailable.
                  </p>
                ) : null}

                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={onSubscribe}
                  disabled={
                    subscribeState === "wallet" ||
                    subscribeState === "verifying" ||
                    walletRole === "creator" ||
                    hasSubscription ||
                    !creatorWalletReady
                  }
                  style={{ width: "100%" }}
                >
                  {walletRole === "creator"
                    ? "Creator wallet locked"
                    : hasSubscription
                      ? "Subscription Active"
                      : !creatorWalletReady
                        ? "Creator setup incomplete"
                        : subscribeState === "wallet"
                          ? "Preparing wallet transfer..."
                          : subscribeState === "verifying"
                            ? "Verifying payment on-chain..."
                            : subscribeState === "success"
                              ? "Subscribed"
                              : "Subscribe"}
                </button>

                {subscribeTxId ? (
                  <p className="t-xs t-dim" style={{ marginTop: "var(--s2)", wordBreak: "break-all" }}>
                    tx: {subscribeTxId}
                  </p>
                ) : null}

                {subscribeState === "success" ? (
                  <p className="t-sm t-success" style={{ marginTop: "var(--s2)" }}>
                    Subscription verified. Locked content is now available without a separate proof transaction.
                  </p>
                ) : null}

                {hasSubscription && activeUntilLabel ? (
                  <p className="t-sm t-success" style={{ marginTop: "var(--s2)" }}>
                    Active until {activeUntilLabel}
                  </p>
                ) : null}

                {subscribeError ? (
                  <p className="t-sm t-error" style={{ marginTop: "var(--s2)" }}>
                    {subscribeError}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
