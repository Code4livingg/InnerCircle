"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@/lib/walletContext";
import { WalletConnectButton } from "../../components/WalletConnectButton";
import { ApiError, fetchFanProfile, saveFanProfile } from "../../lib/api";
import {
  claimWalletRoleWithBackend,
  getWalletRole,
  syncWalletRoleFromBackend,
  WalletRoleConflictError,
  type AppRole,
} from "../../lib/walletRole";

const PRIVACY_GUARANTEES = [
  { icon: "🔐", text: "Your wallet role is enforced server-side, not just in the browser." },
  { icon: "🔗", text: "Subscriptions and PPV access stay bound to your wallet address." },
  { icon: "#️⃣", text: "Only hashed wallet references are stored for fan activity records." },
  { icon: "🎯", text: "Discover personalization works without exposing your purchase history." },
];

export default function SettingsPage() {
  const router = useRouter();
  const { address, connected } = useWallet();

  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    monthlyBudgetCredits: "5",
    favoriteCategories: "",
  });

  useEffect(() => {
    if (!connected || !address) { setRole(getWalletRole(null)); return; }
    let active = true;
    setRole(getWalletRole(address));
    void syncWalletRoleFromBackend(address).then((r) => { if (!active) return; setRole(r); }).catch(() => undefined);
    void fetchFanProfile(address).then((data) => {
      if (!active || !data.profile) return;
      setForm({
        monthlyBudgetCredits: (Number(data.profile.monthlyBudgetMicrocredits) / 1_000_000).toFixed(2),
        favoriteCategories: data.profile.favoriteCategories.join(", "),
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [address, connected]);

  const saveProfile = async () => {
    if (!connected || !address) { setError("Connect your wallet first."); return; }
    setLoading(true); setError(null); setSuccess(null);
    try {
      const lockedRole = await claimWalletRoleWithBackend(address, "user");
      setRole(lockedRole);
      await saveFanProfile({
        walletAddress: address,
        monthlyBudgetMicrocredits: Math.round(Number(form.monthlyBudgetCredits || "0") * 1_000_000),
        favoriteCategories: form.favoriteCategories.split(",").map((i) => i.trim()).filter(Boolean),
      });
      setSuccess("Preferences saved. Discover will now recommend creators around your budget.");
      router.refresh();
    } catch (err) {
      if (err instanceof WalletRoleConflictError) {
        setRole(err.existingRole);
        setError(`This wallet is locked as ${err.existingRole}. Use a different wallet for ${err.requestedRole}.`);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message || "Failed to save fan profile.");
      }
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = role === "creator" ? "Creator" : role === "user" ? "Fan" : "Not set";
  const roleColor = role === "creator" ? "var(--c-violet)" : role === "user" ? "var(--c-success)" : "var(--c-text-3)";

  return (
    <main style={{ padding: "var(--s6) var(--s4) var(--s10)", maxWidth: 760, margin: "0 auto" }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: "var(--s6)" }}>
        <p className="section__label">Account</p>
        <h1>Settings</h1>
        <p className="t-muted" style={{ maxWidth: 460, marginTop: "var(--s1)" }}>
          Manage your private fan preferences. Nothing here creates a public profile.
        </p>
      </div>

      <div className="stack stack-4">

        {/* Wallet panel */}
        <div className="card card--panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--s3)" }}>
            <div>
              <p className="dashboard__panel-title">Wallet Identity</p>
              <p className="t-sm t-muted" style={{ marginBottom: "var(--s3)", maxWidth: 400 }}>
                Your wallet is your identity on InnerCircle — no email or password required.
              </p>
            </div>
            {role !== null && (
              <span style={{
                padding: "4px 12px",
                borderRadius: "var(--r-pill)",
                background: `${roleColor}18`,
                border: `1px solid ${roleColor}44`,
                color: roleColor,
                fontSize: "0.72rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}>
                {roleLabel}
              </span>
            )}
          </div>
          {connected && address ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", padding: "var(--s3)", borderRadius: "var(--r-md)", background: "rgba(255,255,255,0.02)", border: "1px solid var(--c-border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-success)", flexShrink: 0 }} />
              <code style={{ fontSize: "0.8rem", color: "var(--c-text-2)", wordBreak: "break-all" }}>{address.slice(0, 20)}…{address.slice(-10)}</code>
            </div>
          ) : (
            <WalletConnectButton />
          )}
        </div>

        {/* Role lock info */}
        <div className="card card--panel">
          <p className="dashboard__panel-title">Role Lock</p>
          <p className="t-sm t-muted" style={{ marginBottom: "var(--s2)" }}>
            Current role: <strong style={{ color: roleColor }}>{roleLabel}</strong>
          </p>
          <p className="t-xs t-dim" style={{ lineHeight: 1.65 }}>
            Once a wallet is registered as a fan or creator, that role is permanent and enforced on-chain.
            Use a separate wallet if you need both roles.
          </p>
          <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s3)", flexWrap: "wrap" }}>
            {role === "creator" && (
              <Link href="/creator-studio/dashboard" className="btn btn--secondary btn--sm">Open Creator Studio</Link>
            )}
            <Link href="/docs#how-it-works" className="btn btn--ghost btn--sm">Learn More →</Link>
          </div>
        </div>

        {/* Fan preferences */}
        {role === "creator" ? (
          <div className="card card--panel">
            <p className="dashboard__panel-title">Creator Wallet Detected</p>
            <p className="t-sm t-muted">
              This wallet is locked as a creator, so fan preferences are disabled here.
              To follow or subscribe as a fan, use a separate wallet.
            </p>
          </div>
        ) : (
          <div className="card card--panel">
            <div style={{ marginBottom: "var(--s4)" }}>
              <p className="dashboard__panel-title">Private Discover Preferences</p>
              <p className="t-sm t-muted">
                Used only for tailoring Creator recommendations. Never creates a public profile.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s3)", marginBottom: "var(--s4)" }}>
              <div className="form-group">
                <label className="form-label">Monthly Budget (credits)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlyBudgetCredits}
                  onChange={(e) => setForm((p) => ({ ...p, monthlyBudgetCredits: e.target.value }))}
                  placeholder="5.00"
                />
                <span className="t-xs t-dim" style={{ marginTop: "4px", display: "block" }}>
                  Helps filter creators whose tier price fits your budget
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Favorite Categories</label>
                <input
                  className="form-input"
                  value={form.favoriteCategories}
                  onChange={(e) => setForm((p) => ({ ...p, favoriteCategories: e.target.value }))}
                  placeholder="music, art, tech, gaming"
                />
                <span className="t-xs t-dim" style={{ marginTop: "4px", display: "block" }}>
                  Comma-separated list of categories you prefer
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn btn--primary"
                onClick={() => void saveProfile()}
                disabled={loading || !connected}
                style={{ minWidth: 160 }}
              >
                {loading ? "Saving…" : "Save Preferences"}
              </button>
              {!connected && <span className="t-xs t-dim">Connect wallet to save</span>}
            </div>

            {success && (
              <div style={{ marginTop: "var(--s3)", padding: "var(--s2) var(--s3)", borderRadius: "var(--r-md)", background: "rgba(90,158,114,0.08)", border: "1px solid rgba(90,158,114,0.2)" }}>
                <p className="t-sm t-success">✓ {success}</p>
              </div>
            )}
            {error && (
              <div style={{ marginTop: "var(--s3)", padding: "var(--s2) var(--s3)", borderRadius: "var(--r-md)", background: "rgba(255,50,50,0.06)", border: "1px solid rgba(255,50,50,0.15)" }}>
                <p className="t-sm t-error">⚠ {error}</p>
              </div>
            )}
          </div>
        )}

        {/* Privacy guarantees */}
        <div className="card card--panel">
          <p className="dashboard__panel-title">Privacy Guarantees</p>
          <div className="stack stack-2">
            {PRIVACY_GUARANTEES.map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", gap: "var(--s2)", alignItems: "flex-start" }}>
                <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <p className="t-sm t-muted" style={{ lineHeight: 1.6 }}>{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation links */}
        <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          <Link href="/docs" className="btn btn--ghost btn--sm">📖 Read Docs</Link>
          <Link href="/discover" className="btn btn--ghost btn--sm">🔭 Discover Creators</Link>
          <Link href="/library" className="btn btn--ghost btn--sm">📚 My Library</Link>
        </div>

      </div>
    </main>
  );
}
