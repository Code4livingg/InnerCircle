"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/walletContext";
import {
  fetchCreatorAnalytics,
  fetchCreatorByWallet,
  type CreatorAnalyticsResponse,
  type CreatorWithContent,
} from "../../../lib/api";

const panelStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(15,15,17,0.88), rgba(15,15,17,0.58))",
  border: "1px solid rgba(255,255,255,0.04)",
  borderRadius: "24px",
  padding: "var(--s5)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
  backdropFilter: "blur(18px)",
};

const metricCardStyle: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  minHeight: 172,
  background: "linear-gradient(180deg, rgba(15,15,17,0.92), rgba(15,15,17,0.55))",
  border: "1px solid rgba(255,255,255,0.04)",
  borderRadius: "24px",
  padding: "var(--s4)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
};

const formatCredits = (microcredits: string | null | undefined): string =>
  `${(Number(microcredits ?? "0") / 1_000_000).toFixed(2)}`;

function MetricCard({
  label,
  value,
  sub,
  accent,
  delayMs = 0,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  delayMs?: number;
}) {
  return (
    <div className="ic-fade-up" style={{ ...metricCardStyle, animationDelay: `${delayMs}ms` }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at top right, ${accent}14, transparent 45%)`,
          pointerEvents: "none",
        }}
      />
      <div className="stack stack-2" style={{ position: "relative", zIndex: 1 }}>
        <p className="dashboard__panel-title" style={{ marginBottom: 0 }}>
          {label}
        </p>
        <div
          style={{
            width: 28,
            height: 4,
            borderRadius: 999,
            background: accent,
            boxShadow: `0 0 20px ${accent}66`,
          }}
        />
        <span
          style={{
            fontSize: "2.75rem",
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: "-0.05em",
            color: "var(--c-text-1)",
          }}
        >
          {value}
        </span>
        <span className="t-xs t-muted">{sub}</span>
      </div>
    </div>
  );
}

function ActionRow({
  href,
  title,
  detail,
  primary = false,
}: {
  href: string;
  title: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--s3)",
        padding: "18px 22px",
        borderRadius: 18,
        textDecoration: "none",
        border: primary ? "1px solid rgba(225,29,72,0.34)" : "1px solid rgba(255,255,255,0.05)",
        background: primary ? "rgba(225,29,72,0.08)" : "rgba(255,255,255,0.02)",
        boxShadow: primary ? "0 0 24px rgba(225,29,72,0.12)" : "none",
      }}
    >
      <div className="stack stack-1">
        <span style={{ fontSize: "1rem", fontWeight: 500, color: "var(--c-text-1)" }}>{title}</span>
        <span className="t-xs t-muted">{detail}</span>
      </div>
      <span style={{ color: primary ? "var(--c-violet)" : "var(--c-text-2)", fontSize: "1rem" }}>
        {primary ? "->" : "+"}
      </span>
    </Link>
  );
}

function StatusRow({ label }: { label: string }) {
  return (
    <div className="row row-2" style={{ alignItems: "flex-start" }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(90,158,114,0.12)",
          color: "var(--c-success)",
          flexShrink: 0,
          fontSize: "0.75rem",
          marginTop: 2,
        }}
      >
        OK
      </span>
      <p className="t-sm t-muted">{label}</p>
    </div>
  );
}

export default function CreatorDashboardPage() {
  const { address } = useWallet();
  const [creator, setCreator] = useState<CreatorWithContent | null>(null);
  const [analytics, setAnalytics] = useState<CreatorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hydrateDashboard = async () => {
      if (!address) {
        setCreator(null);
        setAnalytics(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const [creatorData, analyticsData] = await Promise.all([
          fetchCreatorByWallet(address).catch(() => null),
          fetchCreatorAnalytics(address).catch(() => null),
        ]);

        setCreator(creatorData?.creator ?? null);
        setAnalytics(analyticsData);

        if (creatorData?.creator.handle) {
          localStorage.setItem("innercircle_creator_handle", creatorData.creator.handle);
        }
      } finally {
        setLoading(false);
      }
    };

    void hydrateDashboard();
  }, [address]);

  const handle = creator?.handle ?? null;
  const totalContent = creator?.contents.length ?? 0;
  const publishedCount = creator?.contents.filter((item) => item.isPublished).length ?? 0;
  const activeSubscribers = analytics?.stats.activeSubscriberCount ?? 0;
  const revenue = analytics ? formatCredits(analytics.stats.totalRevenueMicrocredits) : "--";
  const monthlyPrice = creator?.subscriptionPriceMicrocredits
    ? `${formatCredits(creator.subscriptionPriceMicrocredits)} credits/month`
    : "Free";
  const creatorName = creator?.displayName ?? creator?.handle ?? "Creator";

  if (loading) {
    return (
      <div className="stack stack-4" style={{ padding: "var(--s4) 0" }}>
        <div className="skeleton-card" style={{ minHeight: 220 }} />
        <div className="stats-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton-card" style={{ minHeight: 172 }} />
          ))}
        </div>
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="stack stack-4" style={{ padding: "var(--s4) 0", maxWidth: 920 }}>
        <div style={panelStyle}>
          <div className="stack stack-2">
            <span className="section__label">Creator Studio</span>
            <h1 style={{ fontSize: "2.25rem" }}>Finish Your Creator Setup</h1>
            <p className="t-sm t-muted" style={{ maxWidth: 560 }}>
              Your dashboard layout is ready, but this wallet does not have a creator profile yet. Register the channel first so content, subscribers, and earnings can populate here.
            </p>
            <div className="row row-2" style={{ marginTop: "var(--s2)", flexWrap: "wrap" }}>
              <Link href="/creator-studio/onboarding" className="btn btn--primary">
                Complete setup
              </Link>
              <Link href="/discover" className="btn btn--secondary">
                Explore creators
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack-6" style={{ padding: "var(--s4) 0" }}>
      <header className="ic-fade-up" style={{ position: "relative", paddingBottom: "var(--s2)" }}>
        <div
          style={{
            position: "absolute",
            top: -40,
            left: -40,
            width: 220,
            height: 220,
            background: "radial-gradient(circle, rgba(225,29,72,0.18) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(225,29,72,0.08)",
            border: "1px solid rgba(225,29,72,0.18)",
            marginBottom: "var(--s3)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--c-violet)",
              boxShadow: "0 0 8px rgba(225,29,72,0.55)",
            }}
          />
          <span className="section__label" style={{ marginBottom: 0 }}>
            Creator Studio
          </span>
        </div>

        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: "var(--s3)",
            flexWrap: "wrap",
          }}
        >
          <div className="stack stack-2">
            <h1 style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)", lineHeight: 1.02 }}>
              Welcome back, {creatorName}
            </h1>
            <p className="t-sm t-muted" style={{ maxWidth: 620 }}>
              Your private creator command center. Track what is live, what is earning, and what is still locked behind Aleo-first access.
            </p>
          </div>

          <Link href="/creator-studio/upload" className="btn btn--primary" id="dashboard-upload-btn">
            Upload Content
          </Link>
        </div>
      </header>

      <div className="stats-grid" style={{ alignItems: "stretch" }}>
        <MetricCard label="Total Content" value={String(totalContent)} sub="items uploaded" accent="var(--c-violet)" />
        <MetricCard
          label="Published"
          value={String(publishedCount)}
          sub="visible to subscribers"
          accent="var(--c-teal)"
          delayMs={100}
        />
        <MetricCard
          label="Subscribers"
          value={String(activeSubscribers)}
          sub="stored privately on-chain"
          accent="var(--c-success)"
          delayMs={200}
        />
        <MetricCard
          label="Revenue"
          value={revenue}
          sub="verified creator earnings"
          accent="var(--c-violet)"
          delayMs={300}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 1fr)",
          gap: "var(--s3)",
        }}
      >
        <section style={panelStyle}>
          <h2 style={{ fontSize: "2rem", marginBottom: "var(--s4)" }}>Quick Actions</h2>
          <div className="stack stack-2">
            <ActionRow href="/creator-studio/upload" title="Upload New Content" detail="Add new premium video, image, or audio drops." primary />
            <ActionRow href="/creator-studio/profile" title="Edit Profile" detail="Update your public identity, wallet address, and subscription price." />
            {handle ? (
              <ActionRow href={`/creator/${handle}`} title="View Public Profile" detail="See exactly how your creator page looks to fans." />
            ) : null}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={{ fontSize: "2rem", marginBottom: "var(--s4)" }}>Channel Status</h2>
          <div className="stack stack-3">
            <StatusRow label="Channel registered on-chain" />
            <StatusRow label={`Price: ${monthlyPrice}`} />
            <StatusRow
              label={
                creator.walletAddress?.startsWith("aleo1")
                  ? "Creator wallet configured for payouts"
                  : "Creator payout wallet still needs to be configured"
              }
            />
            {analytics ? (
              <StatusRow label={`This month: ${formatCredits(analytics.stats.monthlyRevenueMicrocredits)} credits verified`} />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

