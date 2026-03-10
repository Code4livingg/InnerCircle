"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
    if (!connected || !address) {
      setRole(getWalletRole(null));
      return;
    }

    let active = true;
    setRole(getWalletRole(address));

    void syncWalletRoleFromBackend(address)
      .then((resolved) => {
        if (!active) return;
        setRole(resolved);
      })
      .catch(() => undefined);

    void fetchFanProfile(address)
      .then((data) => {
        if (!active || !data.profile) return;
        setForm({
          monthlyBudgetCredits: (Number(data.profile.monthlyBudgetMicrocredits) / 1_000_000).toFixed(2),
          favoriteCategories: data.profile.favoriteCategories.join(", "),
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [address, connected]);

  const saveProfile = async () => {
    if (!connected || !address) {
      setError("Connect your wallet first.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const lockedRole = await claimWalletRoleWithBackend(address, "user");
      setRole(lockedRole);
      await saveFanProfile({
        walletAddress: address,
        monthlyBudgetMicrocredits: Math.round(Number(form.monthlyBudgetCredits || "0") * 1_000_000),
        favoriteCategories: form.favoriteCategories
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
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

  return (
    <main style={{ padding: "var(--s6) var(--s4)", maxWidth: 720, margin: "0 auto" }}>
      <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
        <p className="section__label">Account</p>
        <h1 style={{ fontSize: "2rem" }}>Private Fan Preferences</h1>
      </div>

      <div className="stack stack-4">
        <div className="card card--panel">
          <p className="dashboard__panel-title">Wallet</p>
          <p className="t-sm t-muted" style={{ marginBottom: "var(--s3)" }}>
            Your wallet is your identity. No email or password required.
          </p>
          <WalletConnectButton />
        </div>

        <div className="card card--panel">
          <p className="dashboard__panel-title">Permanent Role Lock</p>
          <p className="t-sm t-muted" style={{ marginBottom: "var(--s2)" }}>
            Current role: <strong style={{ color: "var(--c-text-1)" }}>{role === "creator" ? "Creator" : role === "user" ? "Fan" : "Not set"}</strong>
          </p>
          <p className="t-xs t-dim">
            Once a wallet becomes a fan or creator, it stays that way forever. Use a separate wallet if you want the other role.
          </p>
        </div>

        {role === "creator" ? (
          <div className="card card--panel">
            <p className="dashboard__panel-title">Creator Wallet Detected</p>
            <p className="t-sm t-muted">
              This wallet is locked as creator, so fan profile features are disabled here. Use another wallet for following and subscriptions.
            </p>
          </div>
        ) : (
          <div className="card card--panel stack stack-4">
            <div className="stack stack-1">
              <p className="dashboard__panel-title">Private Discover Preferences</p>
              <p className="t-sm t-muted">
                Nothing here creates a public fan profile. We only use your private preferences to suggest creators around your budget.
              </p>
            </div>

            <div className="grid-2" style={{ gap: "var(--s3)" }}>
              <div className="form-group">
                <label className="form-label">Monthly Budget (credits)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlyBudgetCredits}
                  onChange={(event) => setForm((prev) => ({ ...prev, monthlyBudgetCredits: event.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Favorite Categories</label>
                <input
                  className="form-input"
                  value={form.favoriteCategories}
                  onChange={(event) => setForm((prev) => ({ ...prev, favoriteCategories: event.target.value }))}
                  placeholder="music, art, tech"
                />
              </div>
            </div>

            <button className="btn btn--primary" onClick={() => void saveProfile()} disabled={loading}>
              {loading ? "Saving..." : "Save Preferences"}
            </button>

            {success ? <p className="t-sm t-success">{success}</p> : null}
            {error ? <p className="t-sm t-error">{error}</p> : null}
          </div>
        )}

        <div className="card card--panel">
          <p className="dashboard__panel-title">Privacy</p>
          <div className="stack stack-2">
            {[
              "Your wallet role is enforced server-side, not just in the browser.",
              "Subscriptions and PPV access stay bound to your wallet.",
              "We only store hashed wallet references for fan activity records.",
              "Public content discovery can be personalized without exposing your purchases.",
            ].map((item) => (
              <div key={item} className="row row-2">
                <span style={{ color: "var(--c-success)", fontSize: "0.875rem", flexShrink: 0 }}>OK</span>
                <p className="t-sm t-muted">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
