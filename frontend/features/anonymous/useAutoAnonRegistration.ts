"use client";

import { useEffect, useState } from "react";
import { fetchLatestBlockHeight } from "@/lib/aleoTransactions";
import { listStoredSubscriptionInvoiceReceipts } from "@/lib/proofs";
import { useWallet } from "@/lib/walletContext";
import { registerSubscriptionAnonSession } from "./registerAnonSession";
import {
  clearAnonymousRegistration,
  getOrCreateSessionId,
  listAnonymousRegistrations,
  onAnonymousModeChange,
  readAnonymousMode,
  writeAnonymousRegistrationStatus,
} from "./storage";

const normalizeAddress = (value: string): string => value.trim().toLowerCase();

export const useAutoAnonRegistration = (): void => {
  const wallet = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => onAnonymousModeChange(() => setRefreshKey((value) => value + 1)), []);

  useEffect(() => {
    let cancelled = false;

    const writeInactiveStatus = (message: string): void => {
      if (cancelled) return;
      writeAnonymousRegistrationStatus({
        state: "inactive",
        message,
        updatedAt: Date.now(),
        activeCircleIds: [],
      });
    };

    const run = async (): Promise<void> => {
      const sessionId = getOrCreateSessionId();
      if (!sessionId) {
        writeInactiveStatus("Anonymous browsing is unavailable in this browser.");
        return;
      }

      const anonymousModeEnabled = readAnonymousMode();
      if (!anonymousModeEnabled) {
        writeInactiveStatus("Enable Anonymous Mode to browse with anonymous sessions.");
        return;
      }

      let latestBlock: number;
      try {
        latestBlock = Number(await fetchLatestBlockHeight());
      } catch (error) {
        console.warn("[InnerCircle] Failed to refresh anonymous session status", error);
        writeInactiveStatus("Unable to verify anonymous session status right now.");
        return;
      }

      if (cancelled) return;

      for (const registration of listAnonymousRegistrations()) {
        if (registration.expiresAtBlock <= latestBlock) {
          clearAnonymousRegistration(registration.circleId);
        }
      }

      const connectedAddress = wallet.address ? normalizeAddress(wallet.address) : null;
      const candidateReceipts = listStoredSubscriptionInvoiceReceipts().filter((receipt) => {
        const owner = normalizeAddress(receipt.owner);
        if (connectedAddress && owner !== connectedAddress) {
          return false;
        }
        return receipt.expiresAt > latestBlock;
      });

      for (const receipt of candidateReceipts) {
        if (cancelled) return;

        const existing = listAnonymousRegistrations().find((entry) => entry.circleId === receipt.circleId);
        if (
          existing &&
          existing.sessionId === sessionId &&
          existing.expiresAtBlock === receipt.expiresAt &&
          existing.tier === receipt.tier
        ) {
          continue;
        }

        try {
          await registerSubscriptionAnonSession({
            circleId: receipt.circleId,
            tier: receipt.tier,
            expiresAtBlock: receipt.expiresAt,
            subscriberSeed: receipt.owner,
          });
        } catch (error) {
          console.warn("[InnerCircle] Failed to auto-register anonymous session", {
            circleId: receipt.circleId,
            error,
          });
        }
      }

      if (cancelled) return;

      const activeRegistrations = listAnonymousRegistrations().filter(
        (entry) => entry.sessionId === sessionId && entry.expiresAtBlock > latestBlock,
      );

      if (activeRegistrations.length > 0) {
        writeAnonymousRegistrationStatus({
          state: "active",
          message: "Anonymous browsing is active for your current subscription.",
          updatedAt: Date.now(),
          activeCircleIds: activeRegistrations.map((entry) => entry.circleId),
        });
        return;
      }

      writeInactiveStatus(
        candidateReceipts.length > 0
          ? "Anonymous mode is on, but this subscription session is not registered yet."
          : "Anonymous browsing needs an active subscription.",
      );
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [refreshKey, wallet.address]);
};
