"use client";

import Link from "next/link";
import { WalletConnectButton } from "../../components/WalletConnectButton";
import { useWallet } from "@/lib/walletContext";

export default function DashboardPage() {
  const { address, connected, network } = useWallet();

  return (
    <main className="dashboard">
      <div className="container">

        {/* Page header */}
        <div className="page-header stack stack-2" style={{ marginBottom: "var(--s8)" }}>
          <p className="section__label">Dashboard</p>
          <h1>Your Private Vault</h1>
          <p className="t-muted">
            All activity is private. No public record of your subscriptions or content access.
          </p>
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
                  <span className="t-sm" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                    {address.slice(0, 20)}...{address.slice(-8)}
                  </span>
                </div>
                <div className="stack stack-1">
                  <span className="t-xs t-dim">Network</span>
                  <span className="t-sm">{network ?? "Testnet"}</span>
                </div>
              </div>
            ) : (
              <div className="stack stack-3">
                <p className="t-sm t-muted">No wallet connected.</p>
                <WalletConnectButton />
              </div>
            )}
          </div>

          {/* Session status */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Session</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Sessions are ephemeral and exist only in your browser. No server stores your access tokens.
              </p>
              <div className="row row-2">
                <span className="badge badge--secure badge--dot">ZK Verified</span>
              </div>
            </div>
          </div>

          {/* Active subscriptions */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Active Subscriptions</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Your subscriptions are stored as private records on the Aleo blockchain.
                They are not visible to anyone else.
              </p>
              <Link href="/creators" className="btn btn--secondary btn--sm" style={{ alignSelf: "flex-start" }}>
                Browse Creators
              </Link>
            </div>
          </div>

          {/* Purchased content */}
          <div className="card card--panel">
            <p className="dashboard__panel-title">Content Access</p>
            <div className="stack stack-3">
              <p className="t-sm t-muted">
                Pay-per-view content you have unlocked. Access is session-based and
                requires a zero-knowledge proof each time.
              </p>
              <span className="badge badge--locked">Private Records</span>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
