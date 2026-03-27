"use client";

import { Network } from "@provablehq/aleo-types";
import { useWallet } from "@/lib/walletContext";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import { displayIdentity } from "@/features/anonymous/identity";
import {
  WalletName,
  WalletReadyState,
} from "@provablehq/aleo-wallet-standard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const readErrorMessage = (error: unknown): string => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (/invalid connect payload/i.test(rawMessage)) {
    return "Wallet connection request was rejected. Please reconnect or choose a different wallet.";
  }
  if (/no response/i.test(rawMessage)) {
    return "Shield wallet did not respond. Reopen the Shield extension, disconnect this dApp, reconnect, and try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "Wallet action failed. Please try again.";
};

const isExpiredSessionError = (error: unknown): boolean =>
  /dapp not connected|connection expired|session expired|invalid connect payload/i.test(
    readErrorMessage(error),
  );

const readyStateLabel = (state: WalletReadyState): string => {
  if (state === WalletReadyState.INSTALLED) return "Installed";
  if (state === WalletReadyState.LOADABLE) return "Open App";
  if (state === WalletReadyState.NOT_DETECTED) return "Not Detected";
  return "Unavailable";
};

const isShieldWalletName = (name: string): boolean => name.toLowerCase().includes("shield");

/** Render a wallet icon - uses the adapter's built-in icon if available, else a letter fallback */
function WalletIcon({ name, icon, size = 20 }: { name: string; icon?: string; size?: number }) {
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        width={size}
        height={size}
        className="wallet-icon"
        style={{ borderRadius: 4, flexShrink: 0 }}
      />
    );
  }
  // letter fallback
  return (
    <span
      className="wallet-icon wallet-icon--fallback"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function WalletConnectButton() {
  const {
    wallets,
    wallet,
    connected,
    connecting,
    disconnecting,
    selectWallet,
    connect,
    disconnect,
  } = useWallet();

  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingWalletName, setPendingWalletName] = useState<WalletName | null>(null);
  const { enabled: anonEnabled, sessionId: anonSessionId } = useAnonymousMode();
  const identityLabel = displayIdentity({ anonymousMode: anonEnabled, sessionId: anonSessionId, fallback: "Wallet Connected" });

  const sortedWallets = useMemo(() => {
    const priority = (state: WalletReadyState): number => {
      if (state === WalletReadyState.INSTALLED) return 0;
      if (state === WalletReadyState.LOADABLE) return 1;
      if (state === WalletReadyState.NOT_DETECTED) return 2;
      return 3;
    };
    return [...wallets].sort((a, b) => {
      const aShield = isShieldWalletName(a.adapter.name);
      const bShield = isShieldWalletName(b.adapter.name);
      if (aShield !== bShield) return aShield ? -1 : 1;
      const p = priority(a.readyState) - priority(b.readyState);
      if (p !== 0) return p;
      return a.adapter.name.localeCompare(b.adapter.name);
    });
  }, [wallets]);

  const handleConnect = useCallback(async () => {
    const selectedWalletName = wallet?.adapter.name as WalletName | undefined;
    try {
      setErrorMessage(null);
      await connect(Network.TESTNET);
    } catch (error) {
      if (isExpiredSessionError(error)) {
        let retryError: unknown = error;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await disconnect().catch(() => undefined);
            if (selectedWalletName) selectWallet(selectedWalletName);
            await new Promise((resolve) => setTimeout(resolve, 140));
            await connect(Network.TESTNET);
            return;
          } catch (innerError) {
            retryError = innerError;
          }
        }
        setErrorMessage(readErrorMessage(retryError));
        return;
      }
      setErrorMessage(readErrorMessage(error));
    }
  }, [connect, disconnect, selectWallet, wallet]);

  const handleSelectWallet = useCallback(
    (name: WalletName) => {
      setErrorMessage(null);
      setPendingWalletName(name);
      selectWallet(name);
    },
    [selectWallet],
  );

  const handleMainClick = useCallback(async () => {
    if (connected) {
      try {
        setErrorMessage(null);
        await disconnect();
      } catch (error) {
        setErrorMessage(readErrorMessage(error));
      }
      return;
    }
    if (!wallet) {
      setMenuOpen((prev) => !prev);
      return;
    }
    await handleConnect();
  }, [connected, disconnect, wallet, handleConnect]);

  // Auto-select Shield if installed
  useEffect(() => {
    if (wallet || connected || connecting || disconnecting) return;
    const installedShield = wallets.find(
      (entry) =>
        isShieldWalletName(entry.adapter.name) &&
        entry.readyState === WalletReadyState.INSTALLED,
    );
    if (!installedShield) return;
    selectWallet(installedShield.adapter.name as WalletName);
  }, [wallet, wallets, connected, connecting, disconnecting, selectWallet]);

  // Auto-connect pending wallet
  useEffect(() => {
    if (!pendingWalletName) return;
    if (!wallet || wallet.adapter.name !== pendingWalletName) return;
    if (connected || connecting || disconnecting) return;
    void handleConnect().finally(() => setPendingWalletName(null));
  }, [pendingWalletName, wallet, connected, connecting, disconnecting, handleConnect]);

  useEffect(() => {
    if (!connected) return;
    setErrorMessage(null);
    setMenuOpen(false);
    setPendingWalletName(null);
  }, [connected]);

  // Close on outside click
  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const node = rootRef.current;
      if (!node || node.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, []);

  const selectedIcon = wallet?.adapter.icon as string | undefined;
  const selectedName = wallet?.adapter.name;

  return (
    <div className="wallet-connect" ref={rootRef}>

      {/* -- Main trigger button -- */}
      <button
        type="button"
        className={`wcb-btn${connected ? " wcb-btn--connected" : ""}`}
        onClick={() => { void handleMainClick(); }}
        disabled={connecting || disconnecting}
      >
        {/* Shield wallet icon when selected but not connected */}
        {!connected && selectedIcon && (
          <WalletIcon name={selectedName ?? ""} icon={selectedIcon} size={16} />
        )}
        {/* Lock icon when no wallet selected yet */}
        {!connected && !selectedIcon && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        {/* Connected checkmark icon */}
        {connected && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>
          {disconnecting
            ? "Disconnecting..."
            : connecting
              ? "Connecting..."
              : connected
                ? identityLabel
                : selectedName
                  ? `Connect ${selectedName}`
                  : "Connect Wallet"}
        </span>
        {/* Chevron to open picker when no wallet yet selected */}
        {!connected && !wallet && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.7 }}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* -- "Choose a different wallet" inline link (compact, no extra column height) -- */}
      {!connected && wallet && (
        <button
          type="button"
          className="wallet-connect__switch"
          onClick={() => setMenuOpen((prev) => !prev)}
          disabled={connecting || disconnecting}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Change wallet
        </button>
      )}

      {/* -- Connected address pill -- */}
      {connected && (
        <p className="wallet-connect__address">{identityLabel}</p>
      )}

      {/* -- Wallet picker dropdown -- */}
      {menuOpen && !connected && (
        <div className="wallet-connect__menu card card--panel">
          <p className="wallet-connect__menu-title">Select Wallet</p>
          <div className="wallet-connect__menu-list">
            {sortedWallets.map((entry) => {
              const selected = wallet?.adapter.name === entry.adapter.name;
              const pending = pendingWalletName === entry.adapter.name && !connected;
              const icon = entry.adapter.icon as string | undefined;
              return (
                <button
                  key={entry.adapter.name}
                  type="button"
                  className={`wallet-connect__menu-item${selected ? " wallet-connect__menu-item--active" : ""}`}
                  onClick={() => handleSelectWallet(entry.adapter.name as WalletName)}
                  disabled={connecting || disconnecting}
                >
                  {/* Wallet icon + name */}
                  <span className="wallet-connect__menu-identity">
                    <WalletIcon name={entry.adapter.name} icon={icon} size={22} />
                    <span className="wallet-connect__menu-name">{entry.adapter.name}</span>
                  </span>
                  {/* State badge */}
                  <span className={`wallet-connect__menu-state${entry.readyState === WalletReadyState.INSTALLED ? " wallet-connect__menu-state--installed" : ""}`}>
                    {pending ? "Connecting..." : readyStateLabel(entry.readyState)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {errorMessage && <p className="wallet-connect__error">{errorMessage}</p>}
    </div>
  );
}
