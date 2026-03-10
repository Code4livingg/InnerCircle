"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WalletConnectButton } from "../../components/WalletConnectButton";
import { useWallet } from "@/lib/walletContext";

export default function WalletPage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (connected) {
      router.push("/role");
    }
  }, [connected, router]);

  return (
    <main className="wallet-page">
      <div className="card wallet-card">
        <p className="section__label" style={{ marginBottom: "var(--s2)" }}>
          Connect Wallet
        </p>
        <h2 style={{ marginBottom: "var(--s2)" }}>Access the Vault</h2>
        <p className="t-muted" style={{ marginBottom: "var(--s5)" }}>
          Connect your Aleo wallet to subscribe to creators and access private content.
          No email. No account. No public trace.
        </p>

        <WalletConnectButton />

        <hr className="divider" />

        <p className="t-xs t-dim t-center" style={{ marginBottom: "var(--s2)" }}>
          Supported wallets
        </p>
        <div className="wallet-supported">
          <span className="wallet-chip">Shield Wallet</span>
          <span className="wallet-chip">Leo Wallet</span>
          <span className="wallet-chip">Puzzle Wallet</span>
          <span className="wallet-chip">Fox Wallet</span>
        </div>
      </div>
    </main>
  );
}
