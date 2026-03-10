"use client";

import { Network } from "@provablehq/aleo-types";
import { useWallet } from "@/lib/walletContext";
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
    return "Wallet connection request was rejected by the extension payload format. Please reconnect, or choose a different wallet from the list.";
  }

  if (/no response/i.test(rawMessage)) {
    return "Shield wallet did not respond. Reopen the Shield extension, disconnect this dApp, reconnect, and try again.";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return "Wallet action failed. Please try again.";
};

const isExpiredSessionError = (error: unknown): boolean =>
  /dapp not connected|connection expired|session expired|invalid connect payload/i.test(
    readErrorMessage(error),
  );

const shortenAddress = (value: string): string =>
  value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;

const readyStateLabel = (state: WalletReadyState): string => {
  if (state === WalletReadyState.INSTALLED) return "Installed";
  if (state === WalletReadyState.LOADABLE) return "Open App";
  if (state === WalletReadyState.NOT_DETECTED) return "Not Detected";
  return "Unavailable";
};

const isShieldWalletName = (name: string): boolean => name.toLowerCase().includes("shield");

export function WalletConnectButton() {
  const {
    wallets,
    wallet,
    address,
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
  const [pendingWalletName, setPendingWalletName] = useState<WalletName | null>(
    null,
  );

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
      if (aShield !== bShield) {
        return aShield ? -1 : 1;
      }

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
            // Re-selecting helps when provider state was cleared by disconnect.
            if (selectedWalletName) {
              selectWallet(selectedWalletName);
            }
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

  useEffect(() => {
    if (!connected) return;
    setErrorMessage(null);
    setMenuOpen(false);
    setPendingWalletName(null);
  }, [connected]);

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

  useEffect(() => {
    if (!pendingWalletName) return;
    if (!wallet || wallet.adapter.name !== pendingWalletName) return;
    if (connected || connecting || disconnecting) return;

    void handleConnect().finally(() => {
      setPendingWalletName(null);
    });
  }, [
    pendingWalletName,
    wallet,
    connected,
    connecting,
    disconnecting,
    handleConnect,
  ]);

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

  const buttonLabel = useMemo(() => {
    if (disconnecting) return "Disconnecting...";
    if (connecting) return "Connecting...";
    if (connected) return "Disconnect Wallet";
    return "Connect Wallet";
  }, [connected, connecting, disconnecting]);

  return (
    <div className="wallet-button-wrapper wallet-connect" ref={rootRef}>
      <button
        type="button"
        className="btn btn--primary wallet-connect__trigger"
        onClick={() => {
          void handleMainClick();
        }}
        disabled={connecting || disconnecting}
      >
        {buttonLabel}
      </button>

      {!connected && wallet && (
        <p className="wallet-connect__selected">
          Selected: {wallet.adapter.name}
        </p>
      )}

      {!connected && wallet && (
        <button
          type="button"
          className="wallet-connect__switch"
          onClick={() => setMenuOpen((prev) => !prev)}
          disabled={connecting || disconnecting}
        >
          Choose a different wallet
        </button>
      )}

      {menuOpen && !connected && (
        <div className="wallet-connect__menu card card--panel">
          <p className="wallet-connect__menu-title">Select Wallet</p>
          <div className="wallet-connect__menu-list">
            {sortedWallets.map((entry) => {
              const selected = wallet?.adapter.name === entry.adapter.name;
              const pending =
                pendingWalletName === entry.adapter.name && !connected;
              return (
                <button
                  key={entry.adapter.name}
                  type="button"
                  className={`wallet-connect__menu-item${
                    selected ? " wallet-connect__menu-item--active" : ""
                  }`}
                  onClick={() =>
                    handleSelectWallet(entry.adapter.name as WalletName)
                  }
                  disabled={connecting || disconnecting}
                >
                  <span>{entry.adapter.name}</span>
                  <span className="wallet-connect__menu-state">
                    {pending ? "Connecting..." : readyStateLabel(entry.readyState)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {connected && address && (
        <p className="wallet-connect__address">{shortenAddress(address)}</p>
      )}
      {errorMessage && <p className="wallet-connect__error">{errorMessage}</p>}
    </div>
  );
}
