"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/walletContext";
import { ApiError } from "../../lib/api";
import {
  claimWalletRoleWithBackend,
  getWalletRole,
  syncWalletRoleFromBackend,
  type AppRole,
  WalletRoleConflictError,
} from "../../lib/walletRole";

export default function RolePage() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [lockedRole, setLockedRole] = useState<AppRole | null>(null);

  useEffect(() => {
    if (!connected || !address) {
      setLockedRole(getWalletRole(null));
      return;
    }

    setLockedRole(getWalletRole(address));
    void syncWalletRoleFromBackend(address)
      .then((role) => setLockedRole(role))
      .catch(() => undefined);
  }, [address, connected]);

  const choose = async (role: "user" | "creator") => {
    if (!connected || !address) {
      setError("Connect your wallet first. Role lock is wallet-specific.");
      return;
    }

    if (lockedRole && lockedRole !== role) {
      setError(`This wallet is permanently locked as ${lockedRole}. Use a different wallet for ${role}.`);
      return;
    }

    if (lockedRole === role) {
      setError(null);
      router.push(role === "creator" ? "/creator-studio/onboarding" : "/settings?setup=fan");
      return;
    }

    try {
      await claimWalletRoleWithBackend(address, role);
      setError(null);
      setLockedRole(role);
      router.push(role === "creator" ? "/creator-studio/onboarding" : "/settings?setup=fan");
    } catch (err) {
      if (err instanceof WalletRoleConflictError) {
        setLockedRole(err.existingRole);
        setError(`This wallet is locked as ${err.existingRole}. Use a different wallet for ${err.requestedRole}.`);
        return;
      }
      if (err instanceof ApiError) {
        setError(err.message);
        return;
      }
      setError((err as Error).message || "Failed to set wallet role.");
    }
  };

  return (
    <main className="section" style={{ minHeight: "calc(100vh - 60px)", display: "flex", alignItems: "center" }}>
      <div className="container">
        <div className="stack stack-4" style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
          <div className="stack stack-2">
            <p className="section__label">Welcome</p>
            <h2>How will you use InnerCircle?</h2>
            <p className="t-muted">Choose your wallet role. Each wallet is permanently locked to one role.</p>
          </div>

          {lockedRole && (
            <div className="card card--panel">
              <p className="t-sm">
                This wallet is already locked as <strong>{lockedRole === "creator" ? "Creator" : "Fan"}</strong>.
              </p>
            </div>
          )}

          {error && (
            <div className="card card--panel">
              <p className="t-sm" style={{ color: "var(--c-error)" }}>{error}</p>
            </div>
          )}

          <div className="role-grid">
            <button
              className="role-card"
              onClick={() => void choose("user")}
              id="role-fan"
              disabled={lockedRole === "creator"}
            >
              <span className="role-card__icon">O</span>
              <span className="role-card__title">I&apos;m a Fan</span>
              <span className="role-card__desc">
                Build a fan profile, set your budget, follow creators, and get recommendations that match what you can spend.
              </span>
            </button>

            <button
              className="role-card"
              onClick={() => void choose("creator")}
              id="role-creator"
              disabled={lockedRole === "user"}
            >
              <span className="role-card__icon">*</span>
              <span className="role-card__title">I&apos;m a Creator</span>
              <span className="role-card__desc">
                Publish public posts, subscription content, and PPV content while tracking followers, revenue, and subscribers.
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
