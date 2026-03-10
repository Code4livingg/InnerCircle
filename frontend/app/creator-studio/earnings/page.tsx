"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { ApiError, fetchCreatorAnalytics, type CreatorAnalyticsResponse } from "../../../lib/api";
import { StatCard } from "../../../components/StatCard";

const formatCredits = (microcredits: string): string =>
  `${(Number(microcredits) / 1_000_000).toFixed(2)} credits`;

export default function EarningsPage() {
  const { address } = useWallet();
  const [analytics, setAnalytics] = useState<CreatorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalytics = async (): Promise<void> => {
      if (!address) {
        setAnalytics(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await fetchCreatorAnalytics(address);
        setAnalytics(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setAnalytics(null);
          setError("No creator profile is linked to this wallet yet.");
        } else {
          setAnalytics(null);
          setError((err as Error).message || "Failed to load creator earnings.");
        }
      } finally {
        setLoading(false);
      }
    };

    void loadAnalytics();
  }, [address]);

  const summary = useMemo(() => {
    if (!analytics) {
      return null;
    }

    const subscriptionRevenue = Number(analytics.stats.subscriptionRevenueMicrocredits);
    const ppvRevenue = Number(analytics.stats.ppvRevenueMicrocredits);
    const totalRevenue = Number(analytics.stats.totalRevenueMicrocredits);

    return {
      totalRevenueLabel: formatCredits(analytics.stats.totalRevenueMicrocredits),
      monthlyRevenueLabel: formatCredits(analytics.stats.monthlyRevenueMicrocredits),
      subscriptionRevenueLabel: formatCredits(analytics.stats.subscriptionRevenueMicrocredits),
      ppvRevenueLabel: formatCredits(analytics.stats.ppvRevenueMicrocredits),
      mixLabel:
        totalRevenue > 0
          ? `${Math.round((subscriptionRevenue / totalRevenue) * 100)}% subscription / ${Math.round((ppvRevenue / totalRevenue) * 100)}% PPV`
          : "No paid unlocks recorded yet",
    };
  }, [analytics]);

  return (
    <div style={{ padding: "var(--s4) 0" }}>
      <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
        <p className="section__label">Creator Studio</p>
        <h1 style={{ fontSize: "1.75rem" }}>
          {analytics ? `${analytics.creator.displayName ?? analytics.creator.handle} Earnings` : "Earnings"}
        </h1>
      </div>

      {loading ? (
        <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton-card">
              <div className="skeleton skeleton-line skeleton-line--short" />
              <div className="skeleton skeleton-line skeleton-line--medium" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <div className="card card--panel" style={{ maxWidth: 720 }}>
          <p className="t-sm t-error" style={{ marginBottom: "var(--s3)" }}>
            {error}
          </p>
          <Link href="/creator-studio/profile" className="btn btn--primary btn--sm">
            Open creator profile
          </Link>
        </div>
      ) : null}

      {!loading && analytics && summary ? (
        <div className="stack stack-4">
          <div className="stats-grid">
            <StatCard
              label="Total Revenue"
              value={summary.totalRevenueLabel}
              sub="all verified creator earnings"
              accent="var(--c-violet)"
            />
            <StatCard
              label="This Month"
              value={summary.monthlyRevenueLabel}
              sub="current month payout volume"
              accent="var(--c-teal)"
            />
            <StatCard
              label="Subscription Revenue"
              value={summary.subscriptionRevenueLabel}
              sub={`${analytics.stats.activeSubscriberCount} active subscribers`}
              accent="var(--c-success)"
            />
            <StatCard
              label="PPV Revenue"
              value={summary.ppvRevenueLabel}
              sub={`${analytics.stats.ppvPostCount} PPV posts available`}
            />
          </div>

          <div className="grid-2" style={{ gap: "var(--s3)" }}>
            <div className="card card--panel">
              <div className="row row-2" style={{ marginBottom: "var(--s2)" }}>
                <span style={{ color: "var(--c-violet)" }}>OK</span>
                <p style={{ fontWeight: 600, color: "var(--c-text-1)" }}>On-chain earnings</p>
              </div>
              <div className="stack stack-2">
                <p className="t-sm t-muted" style={{ lineHeight: 1.65 }}>
                  Revenue is settled directly to your Aleo wallet. OnlyAleo tracks verified payments and subscriber activity, but it does not hold creator funds in escrow.
                </p>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Revenue mix</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {summary.mixLabel}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Current subscription price</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {formatCredits(analytics.creator.subscriptionPriceMicrocredits)}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Total subscribers acquired</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {analytics.stats.totalSubscriberCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="card card--panel">
              <p className="dashboard__panel-title" style={{ marginBottom: "var(--s3)" }}>
                Channel performance
              </p>
              <div className="stack stack-2">
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Published posts</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {analytics.stats.publishedContentCount}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Subscription posts</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {analytics.stats.subscriptionPostCount}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Public posts</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {analytics.stats.publicPostCount}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">PPV posts</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    {analytics.stats.ppvPostCount}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="t-sm t-muted">Pending balance</span>
                  <span className="t-sm" style={{ color: "var(--c-text-1)" }}>
                    0.00 credits
                  </span>
                </div>
              </div>
            </div>
          </div>

          {analytics.stats.totalRevenueMicrocredits === "0" ? (
            <div className="empty-state">
              <span className="empty-state__icon">OK</span>
              <span className="empty-state__title">No verified earnings yet</span>
              <span className="empty-state__desc">
                Revenue will appear here as soon as subscribers or PPV buyers complete verified on-chain payments.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

