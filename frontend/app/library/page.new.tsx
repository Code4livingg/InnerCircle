"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMySubscriptions, type MySubscriptionEntry } from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";
import { useWallet } from "@/lib/walletContext";

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
        if (!cancelled) {
          setSubscriptions([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const walletToken = await getWalletSessionToken(wallet);
        const data = await fetchMySubscriptions(walletToken);
        if (cancelled) return;
        setSubscriptions(data.subscriptions.filter((entry) => entry.active));
      } catch (err) {
        if (cancelled) return;
        setSubscriptions([]);
        setError((err as Error).message || "Failed to load subscriptions.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [tab, wallet]);

  return (
    <main style={{ padding: "var(--s6) var(--s4)", maxWidth: "var(--max-w)", margin: "0 auto" }}>
      <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
        <p className="section__label">My Library</p>
        <h1 style={{ fontSize: "2rem" }}>Your Content</h1>
      </div>

      <div className="filter-bar" style={{ marginBottom: "var(--s6)" }}>
        <button
          className={`filter-pill${tab === "subscriptions" ? " filter-pill--active" : ""}`}
          onClick={() => setTab("subscriptions")}
        >
          Subscriptions
        </button>
        <button
          className={`filter-pill${tab === "purchases" ? " filter-pill--active" : ""}`}
          onClick={() => setTab("purchases")}
        >
          Purchases
        </button>
      </div>

      {tab === "subscriptions" && subscriptions.length > 0 ? (
        <div className="stack stack-4">
          {subscriptions.map((subscription) => (
            <Link
              key={subscription.txId}
              href={`/creator/${subscription.creatorHandle}`}
              className="card card--panel"
              style={{ display: "block", textDecoration: "none" }}
            >
              <div className="stack stack-2">
                <div className="row row-2" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p className="t-sm t-muted">@{subscription.creatorHandle}</p>
                    <h3 style={{ fontSize: "1.15rem" }}>{subscription.creatorDisplayName}</h3>
                  </div>
                  <span className="badge badge--secure">Active</span>
                </div>
                <p className="t-sm t-muted">
                  {subscription.tierName ?? "Subscription"} · {(Number(subscription.tierPriceMicrocredits) / 1_000_000).toFixed(2)} credits/month
                </p>
                <p className="t-sm t-success">
                  Active until {new Date(subscription.activeUntil).toLocaleString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state__icon">{tab === "subscriptions" ? "O" : "[]"}</span>
          <span className="empty-state__title">
            {loading
              ? "Loading subscriptions..."
              : tab === "subscriptions"
                ? "No active subscriptions"
                : "No purchases yet"}
          </span>
          <span className="empty-state__desc">
            {error
              ? error
              : tab === "subscriptions"
                ? "Your active creator subscriptions will appear here after verification completes."
                : "Pay-per-view purchases will appear here after you unlock content."}
          </span>
          <Link href="/discover" className="btn btn--primary btn--sm">
            Browse Creators
          </Link>
        </div>
      )}
    </main>
  );
}
