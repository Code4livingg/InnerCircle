"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState, useCallback } from "react";
import { useWallet } from "@/lib/walletContext";
import { Network } from "@provablehq/aleo-types";
import {
  ApiError,
  createAnonymousTip,
  createTip,
  fetchCreatorByHandle,
  fetchSubscriptionStatus,
  fetchSubscriptionTiers,
  fetchTipLeaderboard,
  type SubscriptionTier,
  type TipLeaderboardEntry,
  type CreatorWithContent,
  verifyPurchase,
} from "../../../lib/api";
import { getWalletRole, type AppRole } from "../../../lib/walletRole";
import { getWalletSessionToken } from "../../../lib/walletSession";
import {
  executeCreditsTransfer,
  executeAnonymousTip,
  type FeePreference,
  waitForOnChainTransactionId,
} from "../../../lib/aleoTransactions";
import { LockedContentCard } from "../../../components/LockedContentCard";

interface CreatorPageProps {
  params: Promise<{ creatorId: string }>;
}

type SubscribeState = "idle" | "wallet" | "verifying" | "success";

const CREDITS_PROGRAM_ID = "credits.aleo";
const TIP_PROGRAM_ID = process.env.NEXT_PUBLIC_TIP_PROGRAM_ID?.trim() || "tip_pay_v1_xwnxp.aleo";

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

const formatTierCredits = (microcredits: string | null): string => {
  const value = Number(microcredits ?? "0");
  if (!Number.isFinite(value) || value <= 0) {
    return "Free access";
  }
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

const toMicrocredits = (value: string): string => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "0";
  }
  return String(Math.round(parsed * 1_000_000));
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
  const [subscriptionTierName, setSubscriptionTierName] = useState<string | null>(null);
  const [activeTierId, setActiveTierId] = useState<string | null>(null);
  const [walletRole, setWalletRole] = useState<AppRole | null>(null);
  const [showMembership, setShowMembership] = useState(false);
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [tipMessage, setTipMessage] = useState("");
  const [tipAnonymous, setTipAnonymous] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [tipLoading, setTipLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<TipLeaderboardEntry[]>([]);

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
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) return;
      try {
        const data = await fetchSubscriptionTiers(creator.handle);
        if (cancelled) return;
        setTiers(data.tiers);
        if (data.tiers.length > 0) {
          setSelectedTierId((prev) => prev ?? data.tiers[0].id);
        }
      } catch {
        if (!cancelled) {
          setTiers([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [creator]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) return;
      try {
        const data = await fetchTipLeaderboard(creator.handle);
        if (!cancelled) {
          setLeaderboard(data.supporters);
        }
      } catch {
        if (!cancelled) {
          setLeaderboard([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [creator]);

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
          setSubscriptionTierName(status.tierName);
          setActiveTierId(status.tierId);
          if (status.tierId) {
            setSelectedTierId(status.tierId);
          }
        }
      } catch {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
          setSubscriptionTierName(null);
          setActiveTierId(null);
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
      const selectedPrice = selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0";
      const subscriptionPrice = BigInt(selectedPrice);
      if (subscriptionPrice <= 0n) {
        setHasSubscription(true);
        setSubscribeState("success");
        return;
      }

      const runSubscriptionAttempt = async (feePreference: FeePreference): Promise<string> => {
        const walletTxId = await executeCreditsTransfer({
          wallet,
          recipientAddress: creator.walletAddress,
          amountMicrocredits: selectedPrice,
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
            tierId: selectedTier?.id,
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

  const onTip = async (): Promise<void> => {
    if (!creator) return;
    setTipError(null);
    setTipSuccess(null);

    if (!connected || !address) {
      setTipError("Connect your Aleo wallet before tipping.");
      return;
    }

    const microcredits = toMicrocredits(tipAmount);
    if (microcredits === "0") {
      setTipError("Enter a tip amount greater than zero.");
      return;
    }

    try {
      setTipLoading(true);

      if (tipAnonymous) {
        if (!creator.walletAddress) {
          throw new Error("Creator wallet address is missing. The creator must update their profile first.");
        }

        const requestTxId = await executeAnonymousTip({
          wallet,
          creatorFieldId: creator.creatorFieldId,
          creatorAddress: creator.walletAddress,
          amountMicrocredits: microcredits,
        });

        const chainTxId = await waitForOnChainTransactionId(wallet, requestTxId, TIP_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });

        await runWithPendingRetry(() =>
          createAnonymousTip({
            creatorHandle: creator.handle,
            amountMicrocredits: microcredits,
            message: tipMessage || undefined,
            txId: chainTxId,
          }),
        );

        setTipSuccess("Anonymous tip sent successfully.");
      } else {
        if (!creator.walletAddress) {
          throw new Error("Creator wallet address is missing. The creator must update their profile first.");
        }

        let walletToken: string | undefined;
        try {
          walletToken = await getWalletSessionToken(wallet);
        } catch (error) {
          const message = (error as Error).message ?? "";
          if (!/message signing/i.test(message)) {
            throw error;
          }
        }
        const requestTxId = await executeCreditsTransfer({
          wallet,
          recipientAddress: creator.walletAddress,
          amountMicrocredits: microcredits,
        });

        const chainTxId = await waitForOnChainTransactionId(wallet, requestTxId, CREDITS_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });

        await runWithPendingRetry(() =>
          createTip(
            {
              creatorHandle: creator.handle,
              amountMicrocredits: microcredits,
              message: tipMessage || undefined,
              txId: chainTxId,
            },
            walletToken,
          ),
        );

        setTipSuccess("Tip sent successfully.");
      }

      setTipAmount("");
      setTipMessage("");
      const data = await fetchTipLeaderboard(creator.handle);
      setLeaderboard(data.supporters);
    } catch (error) {
      setTipError((error as Error).message || "Failed to send tip.");
    } finally {
      setTipLoading(false);
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
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? null;
  const activeTier = tiers.find((tier) => tier.id === activeTierId) ?? null;
  const activeTierPrice = activeTier ? Number(activeTier.priceMicrocredits) : 0;
  const displayedPriceMicrocredits =
    selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0";
  const subscriptionLabel = formatCredits(displayedPriceMicrocredits);
  const activeUntilLabel = subscriptionActiveUntil
    ? new Date(subscriptionActiveUntil).toLocaleString()
    : null;
  const walletBadgeLabel = hasSubscription
    ? "Subscriber"
    : walletRole === "creator"
      ? "Creator wallet"
      : walletRole === "user"
        ? "Fan wallet"
        : "Wallet connected";
  const tierNote =
    tiers.length === 0
      ? "This creator has not published tiers yet. Subscribers still unlock all private content."
      : "Select a tier to subscribe. Higher tiers unlock all lower-tier content.";

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
              {connected ? (
                <span className={`badge badge--dot ${hasSubscription ? "badge--secure" : "badge--neutral"}`}>
                  {walletBadgeLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="creator-content-grid">
        <div className="stack stack-4">
          <div className="card card--panel tier-panel">
            <div className="tier-panel__header">
              <div>
                <p className="dashboard__panel-title">Subscription tiers</p>
                <p className="t-xs t-dim">Support the creator and unlock the private feed.</p>
              </div>
              {hasSubscription ? <span className="badge badge--secure badge--dot">Active</span> : null}
            </div>
            <div className="tier-grid">
              {tiers.length === 0 ? (
                <div className="tier-card tier-card--placeholder">
                  <div className="tier-card__header">
                    <span className="tier-card__icon tier-card__icon--inner">IC</span>
                    <div className="tier-card__meta">
                      <span className="tier-card__name">Standard</span>
                      <span className="tier-card__price">{formatTierCredits(displayedPriceMicrocredits)}</span>
                    </div>
                  </div>
                  <div className="tier-card__perks">
                    <span className="tier-card__perk">Private posts and uploads</span>
                    <span className="tier-card__perk">Member-only discussions</span>
                  </div>
                  <span className="tier-card__tag tier-card__tag--live">On-chain</span>
                </div>
              ) : (
                tiers.map((tier) => {
                  const isSelected = tier.id === selectedTierId;
                  const isActive = hasSubscription && activeTierId === tier.id;
                  const tagLabel = isActive ? "Active" : Number(tier.priceMicrocredits) > 0 ? "On-chain" : "Free";
                  return (
                    <button
                      type="button"
                      key={tier.id}
                      className={`tier-card${isSelected ? " tier-card--selected" : ""}${isActive ? " tier-card--active" : ""}`}
                      onClick={() => setSelectedTierId(tier.id)}
                    >
                      <div className="tier-card__header">
                        <span className="tier-card__icon tier-card__icon--inner">{tier.tierName.slice(0, 2).toUpperCase()}</span>
                        <div className="tier-card__meta">
                          <span className="tier-card__name">{tier.tierName}</span>
                          <span className="tier-card__price">{formatTierCredits(tier.priceMicrocredits)}</span>
                        </div>
                      </div>
                      {tier.description ? <p className="t-xs t-dim">{tier.description}</p> : null}
                      <div className="tier-card__perks">
                        {(tier.benefits.length > 0 ? tier.benefits : ["Private posts", "Community access"]).map((perk) => (
                          <span key={`${tier.id}-${perk}`} className="tier-card__perk">
                            {perk}
                          </span>
                        ))}
                      </div>
                      <span className={`tier-card__tag${tagLabel === "On-chain" || tagLabel === "Active" ? " tier-card__tag--live" : ""}`}>
                        {tagLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="t-xs t-dim" style={{ marginTop: "var(--s2)" }}>
              {tierNote}
            </p>
          </div>
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
                  const requiredTier = item.subscriptionTierId
                    ? tiers.find((tier) => tier.id === item.subscriptionTierId)
                    : null;
                  const requiredTierPrice = requiredTier ? Number(requiredTier.priceMicrocredits) : 0;
                  const hasTierAccess =
                    requiredTierPrice === 0 || (activeTierPrice > 0 && activeTierPrice >= requiredTierPrice);
                  const isUnlocked = canAccessContent && hasTierAccess;
                  const card = <LockedContentCard title={item.title} locked={!isUnlocked} />;
                  if (!isUnlocked) {
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
                  {selectedTier ? (
                    <span className="t-xs t-dim">Selected tier: {selectedTier.tierName}</span>
                  ) : null}
                  {hasSubscription && subscriptionTierName ? (
                    <span className="t-xs t-dim">Active tier: {subscriptionTierName}</span>
                  ) : null}
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

          <div className="card card--panel">
            <p className="dashboard__panel-title" style={{ marginBottom: "var(--s2)" }}>Tip the creator</p>
            <div className="stack stack-2">
              <div className="form-group">
                <label className="form-label">Amount (credits)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2.50"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Message (optional)</label>
                <textarea
                  className="form-textarea"
                  placeholder="Share a note with the creator"
                  value={tipMessage}
                  onChange={(e) => setTipMessage(e.target.value)}
                />
              </div>
              <label className="row row-2" style={{ alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={tipAnonymous}
                  onChange={(e) => setTipAnonymous(e.target.checked)}
                />
                <span className="t-xs t-dim">Tip anonymously</span>
              </label>
              <button
                type="button"
                className="btn btn--primary"
                onClick={onTip}
                disabled={tipLoading}
              >
                {tipLoading ? "Sending tip..." : "Send tip"}
              </button>
              {tipError ? <p className="t-sm t-error">{tipError}</p> : null}
              {tipSuccess ? <p className="t-sm t-success">{tipSuccess}</p> : null}
            </div>

            <div className="stack stack-1" style={{ marginTop: "var(--s3)" }}>
              <span className="t-xs t-dim">Top supporters</span>
              {leaderboard.length === 0 ? (
                <p className="t-xs t-dim">No tips yet.</p>
              ) : (
                <div className="stack stack-1">
                  {leaderboard.slice(0, 5).map((supporter) => (
                    <div key={supporter.supporter} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="t-xs">{supporter.supporter}</span>
                      <span className="t-xs t-dim">
                        {(Number(supporter.totalMicrocredits) / 1_000_000).toFixed(2)} credits
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
