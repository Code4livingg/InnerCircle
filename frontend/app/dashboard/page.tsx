"use client";

import Link from "next/link";
import { WalletConnectButton } from "../../components/WalletConnectButton";
import { useWallet } from "@/lib/walletContext";

export default function DashboardPage() {
  const { address, connected, network } = useWallet();

  const truncateAddr = (addr: string) =>
    `${addr.slice(0, 10)}…${addr.slice(-8)}`;

  return (
    <main className="dashboard">
      <div className="container">

        {/* Page header */}
        <div className="page-header stack stack-2" style={{ marginBottom: "var(--s6)" }}>
          <p className="section__label">Dashboard</p>
          <h1>Your Private Vault</h1>
          <p className="t-muted" style={{ maxWidth: 480 }}>
            All activity is private. No public record of your subscriptions, content access, or identity.
          </p>
        </div>

        {/* Quick action bar */}
        <div style={{ display: "flex", gap: "var(--s2)", marginBottom: "var(--s6)", flexWrap: "wrap" }}>
          <Link href="/discover" className="btn btn--primary btn--sm">
            🔭 Discover Creators
          </Link>
          <Link href="/membership" className="btn btn--secondary btn--sm">
            💎 My Membership
          </Link>
          <Link href="/creator-studio/onboarding" className="btn btn--ghost btn--sm">
            🎨 Become a Creator
          </Link>
          <Link href="/docs" className="btn btn--ghost btn--sm">
            📖 Docs
          </Link>
        </div>

        {/* Dashboard grid */}
        <div className="dashboard__grid">

          {/* Wallet status */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Wallet</p>
            {connected && address ? (
              <div className="stack stack-3">
                <div className="wallet-status">
                  <div className="wallet-dot" />
                  <span className="t-sm t-success">Connected</span>
                </div>
                <div className="stack stack-1">
                  <span className="t-xs t-dim">Address</span>
                  <span className="t-sm" style={{ fontFamily: "monospace", wordBreak: "break-all", color: "var(--c-text-1)" }}>
                    {truncateAddr(address)}
                  </span>
                </div>
                <div className="stack stack-1">
                  <span className="t-xs t-dim">Network</span>
                  <span className="t-sm">{network ?? "Aleo Testnet 3"}</span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="badge badge--secure">ZK Enabled</span>
                  <span className="badge badge--locked">Private Records</span>
                </div>
              </div>
            ) : (
              <div className="stack stack-3">
                <p className="t-sm t-muted">Connect your Aleo wallet to access private features.</p>
                <WalletConnectButton />
              </div>
            )}
          </div>

          {/* Session status */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Privacy Status</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Sessions are ephemeral and exist only in your browser. No server stores your access tokens or identity.
              </p>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span className="badge badge--secure badge--dot">ZK Verified</span>
                <span className="badge badge--locked">Wallet Hidden</span>
              </div>
              <p className="t-xs t-dim" style={{ lineHeight: 1.6 }}>
                When you access content, a zero-knowledge proof is generated locally in your browser.
                The backend only sees the proof — never your wallet address.
              </p>
            </div>
          </div>

          {/* Active subscriptions */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Active Subscriptions</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Your subscriptions are stored as private records on the Aleo blockchain.
                They are not visible to anyone else — not even the creator.
              </p>
              <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
                <Link href="/discover" className="btn btn--secondary btn--sm" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span>🔭</span> Browse Creators
                </Link>
                <Link href="/creators" className="btn btn--ghost btn--sm">
                  View All
                </Link>
              </div>
            </div>
          </div>

          {/* Content access */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Content Access</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Pay-per-view content you have unlocked. Access is session-based and requires
                a zero-knowledge proof each visit — your history stays private.
              </p>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span className="badge badge--locked">Private Records</span>
                <span className="badge badge--secure">Session Scoped</span>
              </div>
            </div>
          </div>

          {/* Resources */}
          <div className="card card--panel" style={{ gridColumn: "span 2" }}>
            <p className="dashboard__panel-title">Resources</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--s3)" }}>
              {[
                { icon: "📖", title: "Documentation", desc: "Full product guide with ZK invoice system, payments, and creator tutorials.", href: "/docs" },
                { icon: "🎨", title: "Creator Studio", desc: "Upload content, manage tiers, track earnings, and go live.", href: "/creator-studio/dashboard" },
                { icon: "🔐", title: "Privacy Guide", desc: "Understand the ZK proof system and how your identity is protected.", href: "/docs#zk-invoice" },
              ].map(({ icon, title, desc, href }) => (
                <Link key={href} href={href} style={{ textDecoration: "none" }}>
                  <div style={{
                    padding: "var(--s3)",
                    borderRadius: "var(--r-md)",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--c-border)",
                    height: "100%",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                    className="creator-card"
                  >
                    <div style={{ fontSize: "1.5rem", marginBottom: "var(--s1)" }}>{icon}</div>
                    <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--c-text-1)", marginBottom: "4px" }}>{title}</h3>
                    <p style={{ fontSize: "0.8rem", color: "var(--c-text-3)", lineHeight: 1.6, margin: 0 }}>{desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
