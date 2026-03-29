"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMySubscriptions, type MySubscriptionEntry } from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import { useWallet } from "@/lib/walletContext";

function SubscriptionCard({ sub }: { sub: MySubscriptionEntry }) {
  const price = (Number(sub.tierPriceMicrocredits) / 1_000_000).toFixed(2);
  const expiry = new Date(sub.activeUntil);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const expiryLabel = expiry.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const initials = (sub.creatorDisplayName ?? sub.creatorHandle)
    .split(/\s+/).map((w: string) => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");

  return (
    <Link href={`/creator/${sub.creatorHandle}`} style={{ textDecoration: "none" }}>
      <div className="lib-sub-card">
        <div className="lib-sub-card__avatar">{initials}</div>
        <div className="lib-sub-card__body">
          <div className="lib-sub-card__top">
            <div>
              <h3 className="lib-sub-card__name">{sub.creatorDisplayName ?? sub.creatorHandle}</h3>
              <p className="lib-sub-card__handle">@{sub.creatorHandle}</p>
            </div>
            <span className="badge badge--secure">Active</span>
          </div>
          <div className="lib-sub-card__meta">
            <span className="lib-sub-card__tier">{sub.tierName ?? "Standard"}</span>
            <span className="lib-sub-card__dot">·</span>
            <span className="lib-sub-card__price">{price} credits / month</span>
          </div>
          <div className="lib-sub-card__footer">
            <div className="lib-sub-card__expiry-bar">
              <div
                className="lib-sub-card__expiry-fill"
                style={{ width: `${Math.min(100, (daysLeft / 30) * 100)}%` }}
              />
            </div>
            <span className="lib-sub-card__expiry-label">
              {daysLeft > 0 ? `${daysLeft}d until ${expiryLabel}` : `Expired ${expiryLabel}`}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function LibraryPage() {
  const [tab, setTab] = useState<"subscriptions" | "purchases">("subscriptions");
  const [subscriptions, setSubscriptions] = useState<MySubscriptionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWallet();

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (tab !== "subscriptions" || !wallet.connected || !wallet.address) {
        if (!cancelled) { setSubscriptions([]); setLoading(false); setError(null); }
        return;
      }
      try {
        setLoading(true); setError(null);
        const walletToken = await getWalletSessionToken(wallet);
        const data = await fetchMySubscriptions(walletToken);
        if (cancelled) return;
        setSubscriptions(data.subscriptions.filter((e) => e.active));
      } catch (err) {
        if (cancelled) return;
        setSubscriptions([]);
        setError((err as Error).message || "Failed to load subscriptions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [tab, wallet]);

  return (
    <main className="lib-page">
      <div className="container">

        {/* Header */}
        <div className="page-header" style={{ marginBottom: "var(--s6)" }}>
          <p className="section__label">My Library</p>
          <h1>Your Private Content</h1>
          <p className="t-muted" style={{ maxWidth: 480, marginTop: "var(--s1)" }}>
            Your subscriptions and purchases are stored as private records on Aleo. Invisible to everyone else.
          </p>
        </div>

        {/* Privacy notice badge */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "var(--s5)", flexWrap: "wrap" }}>
          <span className="badge badge--secure">ZK Verified Access</span>
          <span className="badge badge--locked">Private Records</span>
          <span className="badge badge--locked">No Public History</span>
        </div>

        {/* Tabs */}
        <div className="lib-tabs">
          <button
            className={`lib-tab${tab === "subscriptions" ? " lib-tab--active" : ""}`}
            onClick={() => setTab("subscriptions")}
          >
            <span className="lib-tab__icon">💎</span> Subscriptions
          </button>
          <button
            className={`lib-tab${tab === "purchases" ? " lib-tab--active" : ""}`}
            onClick={() => setTab("purchases")}
          >
            <span className="lib-tab__icon">🎬</span> Purchases
          </button>
        </div>

        {/* Content */}
        <div style={{ marginTop: "var(--s5)" }}>
          {/* Not connected */}
          {!wallet.connected && (
            <div className="lib-empty">
              <div className="lib-empty__icon">🔐</div>
              <h3 className="lib-empty__title">Connect your wallet</h3>
              <p className="lib-empty__desc">Your private subscriptions and purchases are tied to your Aleo wallet. Connect to view them.</p>
              <Link href="/wallet" className="btn btn--primary btn--sm">Connect Wallet</Link>
            </div>
          )}

          {/* Loading */}
          {wallet.connected && loading && (
            <div className="lib-subs-grid">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="lib-sub-card lib-sub-card--skeleton">
                  <div className="skeleton-card" style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0 }} />
                  <div className="stack stack-2" style={{ flex: 1 }}>
                    <div className="skeleton-card" style={{ height: 16, width: "60%" }} />
                    <div className="skeleton-card" style={{ height: 12, width: "40%" }} />
                    <div className="skeleton-card" style={{ height: 8, width: "100%", borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {wallet.connected && !loading && error && (
            <div className="card card--panel" style={{ borderColor: "var(--c-error-lo)" }}>
              <p className="t-sm t-error">{error}</p>
            </div>
          )}

          {/* Subscriptions loaded */}
          {wallet.connected && !loading && !error && tab === "subscriptions" && (
            subscriptions.length > 0 ? (
              <div className="lib-subs-grid">
                {subscriptions.map((sub) => <SubscriptionCard key={sub.txId} sub={sub} />)}
              </div>
            ) : (
              <div className="lib-empty">
                <div className="lib-empty__icon">◈</div>
                <h3 className="lib-empty__title">No active subscriptions</h3>
                <p className="lib-empty__desc">
                  Your active creator subscriptions will appear here after ZK verification completes.
                  Subscribe to any creator to populate this library.
                </p>
                <Link href="/discover" className="btn btn--primary btn--sm">Browse Creators</Link>
              </div>
            )
          )}

          {/* Purchases tab */}
          {tab === "purchases" && (
            <div className="lib-empty">
              <div className="lib-empty__icon">🎬</div>
              <h3 className="lib-empty__title">No PPV purchases yet</h3>
              <p className="lib-empty__desc">
                Pay-per-view content you&apos;ve unlocked will appear here. Each purchase is a private record — your viewing history is never exposed.
              </p>
              <Link href="/discover?view=PPV" className="btn btn--primary btn--sm">Browse PPV Content</Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
