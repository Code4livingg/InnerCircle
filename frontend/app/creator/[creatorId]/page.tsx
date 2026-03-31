"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState, useRef } from "react";
import { useWallet } from "@/lib/walletContext";
import { Network } from "@provablehq/aleo-types";
import { anonLabelFromSeed } from "@/features/anonymous/identity";
import { registerSubscriptionAnonSession } from "@/features/anonymous/registerAnonSession";
import { readAnonymousMode } from "@/features/anonymous/storage";
import { readStoredCreatorPaymentPreferences } from "@/lib/creatorPaymentPreferences";
import {
  analyzeSubscriptionSpendability,
  describeSubscriptionPaymentRoute,
  formatMicrocreditsAsCredits,
  payAndSubscribe,
  type SubscriptionPaymentAsset,
  type SubscriptionPaymentVisibility,
  type SubscriptionPaymentRoute,
  type SubscriptionPaymentStatus,
  type SubscriptionSpendability,
} from "@/lib/proofs";
import {
  ApiError,
  type CreatorPaymentAsset,
  type CreatorPaymentVisibility,
  activateSubscription,
  createSubscription,
  createAnonymousTip,
  createTip,
  fetchCreatorByHandle,
  fetchSubscriptionStatus,
  fetchSubscriptionTiers,
  fetchTipLeaderboard,
  type SubscriptionExecutionProof,
  type SubscriptionTier,
  type TipLeaderboardEntry,
  type CreatorWithContent,
} from "../../../lib/api";
import { getWalletRole, type AppRole } from "../../../lib/walletRole";
import { getWalletSessionToken } from "../../../lib/walletSession";
import {
  clearCachedSubscriptionStatus,
  persistSubscriptionStatus,
  readCachedSubscriptionStatus,
} from "@/lib/subscriptionStatusCache";
import {
  executeCreditsTransfer,
  executeAnonymousTip,
  fetchLatestBlockHeight,
  proveAnonymousTipReceipt,
  type FeePreference,
  waitForOnChainTransactionId,
} from "../../../lib/aleoTransactions";
import { CREDITS_PROGRAM_ID, TIP_PROGRAM_ID } from "@/lib/programIds";
import { LockedContentCard } from "../../../components/LockedContentCard";

interface CreatorPageProps {
  params: Promise<{ creatorId: string }>;
}

type SubscribeState = "idle" | "wallet" | "verifying" | "success";
type SubscriptionProgressStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const runWithPendingRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const maxAttempts = 45;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = error instanceof ApiError && error.code === "TX_PENDING";
      const isLastAttempt = i === maxAttempts - 1;
      if (!shouldRetry || isLastAttempt) {
        throw error;
      }
      await wait(2000);
    }
  }

  throw new Error("Timed out waiting for on-chain confirmation.");
};

const isRetryableSubscriptionSyncError = (error: unknown): boolean => {
  if (error instanceof ApiError) {
    return error.code === "TX_PENDING" || error.status >= 500;
  }

  const message = (error as Error)?.message?.toLowerCase() ?? "";
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
};

const runWithSubscriptionSyncRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const maxAttempts = 12;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = i === maxAttempts - 1;
      if (!isRetryableSubscriptionSyncError(error) || isLastAttempt) {
        throw error;
      }
      await wait(3000);
    }
  }

  throw new Error("Timed out waiting for backend subscription sync.");
};

const isTipAlreadyRecorded = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 409 &&
  /already recorded/i.test(error.message ?? "");

const isNonFatalTipRecordError = (error: unknown): boolean => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  if (message.includes("request failed") || message.includes("failed to fetch")) {
    return true;
  }

  return error instanceof ApiError && error.status >= 500;
};

const getCreatorLoadErrorMessage = (error: unknown, creatorId: string): string => {
  const normalizedCreatorId = creatorId.trim();

  if (error instanceof ApiError) {
    if (error.status === 404) {
      return `Creator "${normalizedCreatorId}" not found.`;
    }

    return error.message || "Failed to load creator.";
  }

  const message = (error as Error)?.message?.trim();
  if (message) {
    return message;
  }

  return "Failed to load creator.";
};

const formatCredits = (microcredits: string | null): string => {
  const value = Number(microcredits ?? "0");
  return `${(value / 1_000_000).toFixed(2)} credits / month`;
};

const formatUsdcxPrice = (microcredits: string | null): string => {
  const value = Number(microcredits ?? "0");
  return `$${(value / 1_000_000).toFixed(2)} USDCx / month`;
};

const formatTierCredits = (
  microcredits: string | null,
  paymentAsset: SubscriptionPaymentAsset = "ALEO_CREDITS",
): string => {
  const value = Number(microcredits ?? "0");
  if (!Number.isFinite(value) || value <= 0) {
    return "Free access";
  }
  return paymentAsset === "USDCX" ? formatUsdcxPrice(microcredits) : formatCredits(microcredits);
};

const estimateIsoFromExpiryBlock = async (expiresAtBlock: number): Promise<string> => {
  const currentBlock = Number(await fetchLatestBlockHeight());
  const remainingBlocks = Math.max(expiresAtBlock - currentBlock, 0);
  const approxBlockDurationMs = Math.floor((30 * 24 * 60 * 60 * 1000) / 15_000);
  return new Date(Date.now() + remainingBlocks * approxBlockDurationMs).toISOString();
};

const isAleoAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^aleo1[0-9a-z]{20,}$/i.test(value.trim());

const isShieldWalletAdapter = (wallet: ReturnType<typeof useWallet>): boolean =>
  String(wallet.wallet?.adapter?.name ?? "").toLowerCase().includes("shield");

const buildSubscriptionSteps = (
  currentStep: SubscriptionProgressStep,
): Array<{ id: SubscriptionProgressStep; label: string; status: "done" | "loading" | "pending" }> => {
  const labels: Array<{ id: SubscriptionProgressStep; label: string }> = [
    { id: 1, label: "Preparing transaction" },
    { id: 2, label: "Generating ZK proof" },
    { id: 3, label: "Submitting to Aleo network" },
    { id: 4, label: "Waiting for confirmation" },
    { id: 5, label: "Verifying subscription" },
    { id: 6, label: "Subscription Active!" },
  ];

  return labels.map((step) => ({
    ...step,
    status:
      currentStep === 0
        ? "pending"
        : step.id < currentStep
          ? "done"
          : step.id === currentStep
            ? "loading"
            : "pending",
  }));
};

const formatWalletError = (message: string): string => {
  if (/signer_changed|wallet session changed/i.test(message)) {
    return "Wallet session changed. Please try again.";
  }
  if (/no selected account/i.test(message)) {
    return "Wallet account is not selected. Open wallet extension, select account, reconnect, and retry.";
  }
  if (/transaction proving failed/i.test(message)) {
    return message;
  }
  if (/wallet has not exposed the private subscription invoice record yet/i.test(message)) {
    return "Payment was accepted on-chain, but the wallet has not exposed the private invoice record to the app yet. Wait a moment for wallet sync, then press Subscribe again to resume proof generation without paying twice.";
  }
  if (/insufficient balance/i.test(message)) {
    return message;
  }
  if (/failed to execute transaction/i.test(message)) {
    return `${message}. Reconnect wallet and confirm the account has enough testnet balance for fees.`;
  }
  return message;
};

const describeSubscriptionStage = (status: SubscriptionPaymentStatus): string => {
  switch (status.stage) {
    case "selecting_route":
      return "Inspecting private records and public balance...";
    case "submitting_private":
      return "Submitting private invoice payment...";
    case "funding_public_balance":
      return "Funding public balance for Shield compatibility...";
    case "submitting_public":
      return status.route === "private_to_public_fallback"
        ? "Retrying invoice mint from public balance..."
        : "Minting invoice from public balance...";
    case "awaiting_finality":
      return "Waiting for Aleo finality...";
    case "recovering_invoice":
      return "Recovering the minted private invoice from the wallet...";
    case "resuming_invoice":
      return "Resuming invoice recovery from the last accepted payment...";
    case "proving_invoice":
      return "Generating a local proof for subscription registration...";
    case "accepted":
      return "Transaction accepted by wallet.";
    case "waiting_finality":
      return "Waiting for Aleo finality (30-90s)...";
    case "fetching_proof":
      return "Retrieving execution proof...";
    default:
      return "Preparing subscription invoice...";
  }
};

const toMicrocredits = (value: string): string => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "0";
  }
  return String(Math.floor(parsed * 1_000_000));
};

function accentColor(handle: string): string {
  const palette = ["#7c6fcd", "#4e9ea3", "#8a7fbd", "#5a9e72", "#9e7a4e", "#6a7fbd", "#a07090"];
  let hash = 0;
  for (let i = 0; i < handle.length; i += 1) {
    hash = handle.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

function getInitials(creator: CreatorWithContent): string {
  const name = creator.displayName ?? creator.handle;
  return name
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export default function CreatorPage({ params }: CreatorPageProps) {
  const { creatorId } = use(params);
  const wallet = useWallet();
  const { connected, address, network } = wallet;

  const [creator, setCreator] = useState<CreatorWithContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribeState, setSubscribeState] = useState<SubscribeState>("idle");
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [subscribeTxId, setSubscribeTxId] = useState<string | null>(null);
  const [membershipProofLabel, setMembershipProofLabel] = useState<string | null>(null);
  const [subscriptionSpendability, setSubscriptionSpendability] = useState<SubscriptionSpendability | null>(null);
  const [spendabilityLoading, setSpendabilityLoading] = useState(false);
  const [subscribeProgressLabel, setSubscribeProgressLabel] = useState<string | null>(null);
  const [subscriptionProgressStep, setSubscriptionProgressStep] = useState<SubscriptionProgressStep>(0);
  const [subscribeRoute, setSubscribeRoute] = useState<SubscriptionPaymentRoute | null>(null);
  const [anonRegistrationNotice, setAnonRegistrationNotice] = useState<string | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [subscriptionActiveUntil, setSubscriptionActiveUntil] = useState<string | null>(null);
  const [subscriptionTierName, setSubscriptionTierName] = useState<string | null>(null);
  const [activeTierId, setActiveTierId] = useState<string | null>(null);
  const [walletRole, setWalletRole] = useState<AppRole | null>(null);
  const [showMembership, setShowMembership] = useState(false);
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [selectedPaymentAsset, setSelectedPaymentAsset] = useState<SubscriptionPaymentAsset>("ALEO_CREDITS");
  const [selectedPaymentVisibility, setSelectedPaymentVisibility] = useState<SubscriptionPaymentVisibility>("PUBLIC");
  const [tipAmount, setTipAmount] = useState("");
  const [tipMessage, setTipMessage] = useState("");
  const [tipAnonymous, setTipAnonymous] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [tipLoading, setTipLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<TipLeaderboardEntry[]>([]);
  const processingRef = useRef(false);
  const cancelledByAccountChangeRef = useRef(false);
  const lockedSignerAddressRef = useRef<string | null>(null);
  const latestPaymentTxIdRef = useRef<string | null>(null);
  const latestVerifyTxIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetchCreatorByHandle(creatorId)
      .then((data) => {
        const storedPaymentPreferences = readStoredCreatorPaymentPreferences(data.creator.handle);
        setCreator(
          storedPaymentPreferences
            ? {
              ...data.creator,
              acceptedPaymentAssets: storedPaymentPreferences.acceptedPaymentAssets,
              acceptedPaymentVisibilities: storedPaymentPreferences.acceptedPaymentVisibilities,
            }
            : data.creator,
        );
        setError(null);
      })
      .catch((err) => {
        console.error("[InnerCircle] Failed to load creator page", {
          creatorId,
          error: err,
        });
        setCreator(null);
        setError(getCreatorLoadErrorMessage(err, creatorId));
      });
  }, [creatorId]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) return;
      try {
        const data = await fetchSubscriptionTiers(creator.handle);
        if (cancelled) return;
        setTiers(data.tiers);
        if (data.tiers.length > 0) {
          setSelectedTierId((prev) => prev ?? data.tiers[0].id);
        }
      } catch {
        if (!cancelled) {
          setTiers([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [creator]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) return;
      try {
        const data = await fetchTipLeaderboard(creator.handle);
        if (!cancelled) {
          setLeaderboard(data.supporters);
        }
      } catch {
        if (!cancelled) {
          setLeaderboard([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [creator]);

  useEffect(() => {
    setWalletRole(getWalletRole(address));
  }, [address]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator) {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
        }
        return;
      }

      const subscriptionPrice = BigInt(creator.subscriptionPriceMicrocredits ?? "0");
      if (subscriptionPrice <= 0n) {
        if (!cancelled) {
          setHasSubscription(true);
          setSubscriptionActiveUntil(null);
        }
        return;
      }

      if (!connected || !isAleoAddress(address)) {
        if (!cancelled) {
          setHasSubscription(false);
          setSubscriptionActiveUntil(null);
          setSubscriptionTierName(null);
          setActiveTierId(null);
        }
        return;
      }

      const cachedStatus = readCachedSubscriptionStatus(creator.handle, address);
      if (cachedStatus && !cancelled) {
        setHasSubscription(cachedStatus.active);
        setSubscriptionActiveUntil(cachedStatus.activeUntil);
        setSubscriptionTierName(cachedStatus.tierName);
        setActiveTierId(cachedStatus.tierId);
      }

      try {
        const status = await fetchSubscriptionStatus(creator.handle, address);
        if (!cancelled) {
          setHasSubscription(status.active);
          setSubscriptionActiveUntil(status.activeUntil);
          setSubscriptionTierName(status.tierName);
          setActiveTierId(status.tierId);
          if (status.active) {
            persistSubscriptionStatus(creator.handle, address, {
              active: true,
              activeUntil: status.activeUntil,
              tierName: status.tierName,
              tierId: status.tierId,
              tierPriceMicrocredits: status.tierPriceMicrocredits ?? status.priceMicrocredits ?? null,
            });
          } else {
            clearCachedSubscriptionStatus(creator.handle, address);
          }
          if (status.tierId) {
            setSelectedTierId(status.tierId);
          }
        }
      } catch {
        if (!cancelled) {
          if (!cachedStatus) {
            setHasSubscription(false);
            setSubscriptionActiveUntil(null);
            setSubscriptionTierName(null);
            setActiveTierId(null);
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, connected, creator]);

  useEffect(() => {
    const adapter = wallet.wallet?.adapter;
    if (!adapter || typeof adapter.on !== "function" || typeof adapter.off !== "function") {
      return;
    }

    // Abort the in-flight subscription flow if Shield switches accounts mid-proof/submit.
    const handleAccountChange = (): void => {
      if (!processingRef.current) {
        return;
      }

      cancelledByAccountChangeRef.current = true;
      processingRef.current = false;
      lockedSignerAddressRef.current = null;
      latestPaymentTxIdRef.current = null;
      latestVerifyTxIdRef.current = null;
      setSubscribeState("idle");
      setSubscribeProgressLabel(null);
      setSubscriptionProgressStep(0);
      setSubscribeRoute(null);
      setSubscribeError("Wallet session changed. Please try again.");
    };

    adapter.on("accountChange", handleAccountChange);

    return () => {
      adapter.off("accountChange", handleAccountChange);
    };
  }, [wallet.wallet?.adapter]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!creator || !connected || !address || walletRole === "creator" || hasSubscription) {
        if (!cancelled) {
          setSubscriptionSpendability(null);
          setSpendabilityLoading(false);
        }
        return;
      }

      const targetTier = tiers.find((tier) => tier.id === selectedTierId) ?? null;
      const targetAmount = BigInt(targetTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0");
      if (targetAmount <= 0n) {
        if (!cancelled) {
          setSubscriptionSpendability(null);
          setSpendabilityLoading(false);
        }
        return;
      }

      try {
        setSpendabilityLoading(true);
        const spendability = await analyzeSubscriptionSpendability(wallet, targetAmount);
        if (!cancelled) {
          setSubscriptionSpendability(spendability);
        }
      } catch {
        if (!cancelled) {
          setSubscriptionSpendability(null);
        }
      } finally {
        if (!cancelled) {
          setSpendabilityLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, connected, creator, hasSubscription, selectedTierId, tiers, wallet, walletRole]);

  useEffect(() => {
    const acceptedAssets = (creator?.acceptedPaymentAssets ?? ["ALEO_CREDITS"]) as CreatorPaymentAsset[];
    const acceptedVisibilities = (creator?.acceptedPaymentVisibilities ?? ["PUBLIC", "PRIVATE"]) as CreatorPaymentVisibility[];

    setSelectedPaymentAsset((prev) =>
      acceptedAssets.includes(prev as CreatorPaymentAsset)
        ? prev
        : ((acceptedAssets[0] ?? "ALEO_CREDITS") as SubscriptionPaymentAsset),
    );
    setSelectedPaymentVisibility((prev) =>
      acceptedVisibilities.includes(prev as CreatorPaymentVisibility)
        ? prev
        : ((acceptedVisibilities[0] ?? "PUBLIC") as SubscriptionPaymentVisibility),
    );
  }, [creator]);

  const canAccessContent = useMemo(() => {
    if (!creator) return false;
    const subscriptionPrice = Number(creator.subscriptionPriceMicrocredits ?? "0");
    return subscriptionPrice === 0 || hasSubscription;
  }, [creator, hasSubscription]);

  const onSubscribe = async (): Promise<void> => {
    if (!creator) return;

    if (!connected || !address) {
      setSubscribeError("Connect your Aleo wallet before subscribing.");
      return;
    }

    if (walletRole === "creator") {
      setSubscribeError("Creator wallets cannot subscribe. Connect a fan wallet.");
      return;
    }

    if (hasSubscription) {
      setSubscribeError("This subscription is already active.");
      return;
    }

    if (network !== Network.TESTNET) {
      try {
        const switched = await wallet.switchNetwork(Network.TESTNET);
        if (!switched && wallet.network !== Network.TESTNET) {
          throw new Error("Switch wallet network to Aleo testnet and try again.");
        }
      } catch {
        setSubscribeError("Switch wallet network to Aleo testnet and try again.");
        return;
      }
    }

    const signerAddress = wallet.address?.trim().toLowerCase() ?? null;
    if (!isAleoAddress(signerAddress)) {
      setSubscribeError("Please disable Anonymous Mode in Shield to continue.");
      return;
    }

    if (isShieldWalletAdapter(wallet) && readAnonymousMode()) {
      setSubscribeError("Please disable Anonymous Mode in Shield to continue.");
      return;
    }

    setSubscribeError(null);
    setSubscribeTxId(null);
    setMembershipProofLabel(null);
    setSubscribeProgressLabel(null);
    setSubscribeRoute(null);
    setAnonRegistrationNotice(null);
    setSubscriptionProgressStep(1);
    processingRef.current = true;
    cancelledByAccountChangeRef.current = false;
    lockedSignerAddressRef.current = signerAddress;
    latestPaymentTxIdRef.current = null;
    latestVerifyTxIdRef.current = null;

    try {
      setSubscribeState("wallet");
      const selectedPrice = selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0";
      const subscriptionPrice = BigInt(selectedPrice);
      const anonymousModeEnabled = readAnonymousMode();
      if (subscriptionPrice <= 0n) {
        setHasSubscription(true);
        setSubscribeState("success");
        return;
      }
      if (!creator.walletAddress || !creator.walletAddress.startsWith("aleo1")) {
        throw new Error("Creator wallet address is missing. The creator needs to update their profile.");
      }

      const ensureSignerUnchanged = async (): Promise<void> => {
        if (cancelledByAccountChangeRef.current) {
          throw new Error("SIGNER_CHANGED");
        }

        const currentAddress = wallet.address?.trim().toLowerCase() ?? null;
        if (!currentAddress || currentAddress !== lockedSignerAddressRef.current) {
          throw new Error("SIGNER_CHANGED");
        }
      };

      const syncToBackend = async (
        paymentTxId: string,
        verifyTxId: string,
        proof: SubscriptionExecutionProof | null,
        nullifier: string,
        signer: string,
        tier: number,
        expiresAtBlock: number,
      ): Promise<{ expiresAt: string; tierId: string | null; tierName: string | null; priceMicrocredits: string }> => {
        const attemptSync = async (): Promise<{
          expiresAt: string;
          tierId: string | null;
          tierName: string | null;
          priceMicrocredits: string;
        }> => {
          if (anonymousModeEnabled) {
            return {
              expiresAt: await estimateIsoFromExpiryBlock(expiresAtBlock),
              tierId: selectedTier?.id ?? null,
              tierName: selectedTier?.tierName ?? null,
              priceMicrocredits: selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0",
            };
          }

          const walletToken = await getWalletSessionToken(wallet);
          if (proof) {
            const synced = await createSubscription(
              {
                kind: "subscription",
                executionProof: proof,
                nullifier,
                circleId: creator.creatorFieldId,
                tierId: selectedTier?.id,
                paymentTxId,
              },
              walletToken,
            );
            return {
              expiresAt: synced.expiresAt,
              tierId: synced.tierId,
              tierName: synced.tierName,
              priceMicrocredits: synced.priceMicrocredits,
            };
          }

          const activated = await activateSubscription(
            {
              txId: verifyTxId,
              paymentTxId,
              circleId: creator.creatorFieldId,
              nullifier,
              tierId: selectedTier?.id,
              address: signer,
            },
            walletToken,
          );

          return {
            expiresAt: activated.expiresAt,
            tierId: selectedTier?.id ?? null,
            tierName: selectedTier?.tierName ?? null,
            priceMicrocredits: selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0",
          };
        };

        return runWithSubscriptionSyncRetry(attemptSync);
      };

      const runSubscriptionAttempt = async (
        feePreference: FeePreference,
      ): Promise<{
        paymentTxId: string;
        verifyTxId: string;
        route: SubscriptionPaymentRoute;
        proof: SubscriptionExecutionProof | null;
        nullifier: string;
        tier: number;
        expiresAtBlock: number;
      }> => {
        await ensureSignerUnchanged();
        setSubscriptionProgressStep(2);
        const { invoice, proof, transactionId, verifyTransactionId, route, fallbackReceipt } = await payAndSubscribe({
          wallet,
          circleId: creator.creatorFieldId,
          creatorAddress: creator.walletAddress,
          amountMicrocredits: selectedPrice,
          paymentAsset: selectedPaymentAsset,
          paymentVisibility: selectedPaymentVisibility,
          feeAleo: undefined,
          feePreference,
          signerAddress,
          onStatus: (status) => {
            setSubscribeRoute(status.route ?? null);
            setSubscribeProgressLabel(describeSubscriptionStage(status));
            if (status.route) {
              setSubscribeRoute(status.route);
            }
            switch (status.stage) {
              case "selecting_route":
                setSubscriptionProgressStep(1);
                break;
              case "proving_invoice":
                setSubscriptionProgressStep(2);
                break;
              case "submitting_private":
              case "funding_public_balance":
              case "submitting_public":
                setSubscriptionProgressStep(3);
                break;
              case "awaiting_finality":
                setSubscriptionProgressStep(4);
                if (status.transactionId) {
                  latestPaymentTxIdRef.current = status.transactionId;
                  setSubscribeTxId(status.transactionId);
                }
                break;
              case "accepted":
              case "waiting_finality":
              case "fetching_proof":
                setSubscriptionProgressStep(5);
                if (status.verifyTransactionId) {
                  latestVerifyTxIdRef.current = status.verifyTransactionId;
                }
                break;
              default:
                break;
            }
          },
        });

        setSubscribeRoute(route);
        setSubscribeTxId(transactionId);
        latestPaymentTxIdRef.current = transactionId;
        const resolvedVerifyTxId = verifyTransactionId ?? fallbackReceipt?.txId;
        if (!resolvedVerifyTxId) {
          throw new Error("Subscription verification transaction was not available after payment confirmation.");
        }
        latestVerifyTxIdRef.current = resolvedVerifyTxId;
        setSubscriptionProgressStep(5);
        if (fallbackReceipt && !verifyTransactionId) {
          setSubscribeProgressLabel("Wallet transcript API unavailable. Finalizing with on-chain tx verification...");
        }

        return {
          paymentTxId: transactionId,
          verifyTxId: resolvedVerifyTxId,
          route,
          proof,
          nullifier: invoice.nullifier,
          tier: invoice.tier,
          expiresAtBlock: invoice.expiresAt,
        };
      };

      const isShieldWallet = isShieldWalletAdapter(wallet);
      let result: {
        paymentTxId: string;
        verifyTxId: string;
        route: SubscriptionPaymentRoute;
        proof: SubscriptionExecutionProof | null;
        nullifier: string;
        tier: number;
        expiresAtBlock: number;
      };

      try {
        result = await runSubscriptionAttempt("auto");
      } catch (error) {
        const message = (error as Error).message ?? "";
        const shouldRetryShieldWithAlternateFee =
          isShieldWallet &&
          /status "rejected"|transaction was not confirmed/i.test(message);

        if (!shouldRetryShieldWithAlternateFee) {
          throw error;
        }

        if (process.env.NODE_ENV !== "production") {
          console.warn("[InnerCircle][Shield] retrying subscription with alternate fee order", {
            reason: message,
          });
        }

        result = await runSubscriptionAttempt("aleo_first");
      }

      await ensureSignerUnchanged();
      setSubscribeProgressLabel("Syncing subscription with backend...");
      const syncedSubscription = await syncToBackend(
        result.paymentTxId,
        result.verifyTxId,
        result.proof,
        result.nullifier,
        signerAddress,
        result.tier,
        result.expiresAtBlock,
      );
      setSubscribeTxId(result.paymentTxId);
      setHasSubscription(true);
      setSubscriptionActiveUntil(syncedSubscription.expiresAt);
      setSubscriptionTierName(syncedSubscription.tierName ?? selectedTier?.tierName ?? null);
      setActiveTierId(syncedSubscription.tierId ?? selectedTier?.id ?? null);
      setSubscriptionProgressStep(6);
      setSubscribeProgressLabel(null);
      setMembershipProofLabel(
        result.route === "private_record"
          ? "✔ Subscription Active! Private route confirmed on-chain."
          : "✔ Subscription Active! Public balance route confirmed on-chain.",
      );
      setSubscribeState("success");
      if (!anonymousModeEnabled) {
        persistSubscriptionStatus(creator.handle, signerAddress, {
          active: true,
          activeUntil: syncedSubscription.expiresAt,
          tierName: syncedSubscription.tierName ?? selectedTier?.tierName ?? null,
          tierId: syncedSubscription.tierId ?? selectedTier?.id ?? null,
          tierPriceMicrocredits: syncedSubscription.priceMicrocredits ?? selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? null,
        });
      }
      if (anonymousModeEnabled) {
        void registerSubscriptionAnonSession({
          circleId: creator.creatorFieldId,
          tier: result.tier,
          expiresAtBlock: result.expiresAtBlock,
          subscriberSeed: signerAddress,
        })
          .then(() => {
            setAnonRegistrationNotice("Anonymous browsing enabled for this subscription.");
          })
          .catch((error) => {
            console.warn("[InnerCircle] Failed to register anonymous subscription session", {
              creatorHandle: creator.handle,
              error,
            });
          });
      }
    } catch (err) {
      const rawMessage = (err as Error).message || "Subscription transaction failed.";
      if (/already exists in the ledger/i.test(rawMessage)) {
        console.warn("[InnerCircle] stale private record detected; ask Shield to refresh records before retry.");
      }

      const txAlreadySubmitted = Boolean(latestPaymentTxIdRef.current);
      const message = /timed out waiting|timeout/i.test(rawMessage)
        ? "Transaction is taking longer than usual. Check your activity in Shield — your subscription may still activate."
        : txAlreadySubmitted
          ? "Subscription transaction is already on-chain. Backend sync is still catching up."
          : formatWalletError(rawMessage);
      setSubscribeError(message);
      setSubscribeProgressLabel(null);
      setSubscriptionProgressStep(txAlreadySubmitted ? 4 : 0);
      setSubscribeState(txAlreadySubmitted ? "verifying" : "idle");
    }
    finally {
      processingRef.current = false;
      lockedSignerAddressRef.current = null;
      cancelledByAccountChangeRef.current = false;
    }
  };

  const onTip = async (): Promise<void> => {
    if (!creator) return;
    setTipError(null);
    setTipSuccess(null);

    if (!connected || !address) {
      setTipError("Connect your Aleo wallet before tipping.");
      return;
    }

    const microcredits = toMicrocredits(tipAmount);
    if (microcredits === "0") {
      setTipError("Enter a tip amount greater than zero.");
      return;
    }

    const refreshLeaderboard = async (): Promise<void> => {
      try {
        const data = await fetchTipLeaderboard(creator.handle);
        setLeaderboard(data.supporters);
      } catch {
        // Ignore leaderboard refresh failures after a successful tip.
      }
    };

    try {
      setTipLoading(true);

      if (tipAnonymous) {
        if (!creator.walletAddress) {
          throw new Error("Creator wallet address is missing. The creator must update their profile first.");
        }

        const requestTxId = await executeAnonymousTip({
          wallet,
          creatorFieldId: creator.creatorFieldId,
          creatorAddress: creator.walletAddress,
          amountMicrocredits: microcredits,
        });

        const fundedTipTxId = await waitForOnChainTransactionId(wallet, requestTxId, TIP_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });
        if (!fundedTipTxId) {
          throw new Error("Anonymous tip funding transaction was submitted, but the finalized on-chain tx id is not available yet.");
        }

        const proveRequestTxId = await proveAnonymousTipReceipt({
          wallet,
          creatorFieldId: creator.creatorFieldId,
          amountMicrocredits: microcredits,
        });

        const proofTxId = await waitForOnChainTransactionId(wallet, proveRequestTxId, TIP_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });
        if (!proofTxId) {
          throw new Error("Anonymous tip proof transaction was submitted, but the finalized on-chain tx id is not available yet.");
        }

        try {
          await runWithPendingRetry(() =>
            createAnonymousTip({
              creatorHandle: creator.handle,
              amountMicrocredits: microcredits,
              message: tipMessage || undefined,
              txId: proofTxId,
            }),
          );
          setTipSuccess("Anonymous tip sent successfully.");
        } catch (error) {
          if (isTipAlreadyRecorded(error)) {
            setTipSuccess("Anonymous tip already recorded.");
          } else if (isNonFatalTipRecordError(error)) {
            setTipSuccess("Anonymous tip sent on-chain. Backend verification pending.");
          } else {
            throw error;
          }
        }
      } else {
        if (!creator.walletAddress) {
          throw new Error("Creator wallet address is missing. The creator must update their profile first.");
        }

        let walletToken: string | undefined;
        try {
          walletToken = await getWalletSessionToken(wallet);
        } catch (error) {
          const message = (error as Error).message ?? "";
          if (!/message signing/i.test(message)) {
            throw error;
          }
        }
        const requestTxId = await executeCreditsTransfer({
          wallet,
          recipientAddress: creator.walletAddress,
          amountMicrocredits: microcredits,
        });

        const chainTxId = await waitForOnChainTransactionId(wallet, requestTxId, CREDITS_PROGRAM_ID, {
          attempts: 60,
          delayMs: 2000,
        });
        if (!chainTxId) {
          throw new Error("Tip transaction was submitted, but the finalized on-chain tx id is not available yet.");
        }

        try {
          await runWithPendingRetry(() =>
            createTip(
              {
                creatorHandle: creator.handle,
                amountMicrocredits: microcredits,
                message: tipMessage || undefined,
                txId: chainTxId,
              },
              walletToken,
            ),
          );
          setTipSuccess("Tip sent successfully.");
        } catch (error) {
          if (isTipAlreadyRecorded(error)) {
            setTipSuccess("Tip already recorded.");
          } else if (isNonFatalTipRecordError(error)) {
            setTipSuccess("Tip sent on-chain. Backend verification pending.");
          } else {
            throw error;
          }
        }
      }

      setTipAmount("");
      setTipMessage("");
      await refreshLeaderboard();
    } catch (error) {
      const message = (error as Error).message || "Failed to send tip.";
      if (tipAnonymous && /no private credits record large enough/i.test(message)) {
        setTipError(
          "Anonymous tips need one private credits record large enough for the full amount. Uncheck 'Tip anonymously' to use the direct transfer route, or consolidate your private credits first.",
        );
      } else {
        setTipError(message);
      }
    } finally {
      setTipLoading(false);
    }
  };

  if (error) {
    return (
      <main className="creator-page">
        <div className="card card--panel">
          <p className="t-error t-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!creator) {
    return (
      <main className="creator-page">
        <div className="card card--panel" style={{ textAlign: "center", padding: "var(--s8)" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p className="t-muted t-sm" style={{ marginTop: "var(--s3)" }}>
            Loading creator...
          </p>
        </div>
      </main>
    );
  }

  const color = accentColor(creator.handle);
  const initials = getInitials(creator);
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? null;
  const activeTier = tiers.find((tier) => tier.id === activeTierId) ?? null;
  const acceptedPaymentAssets = (creator.acceptedPaymentAssets ?? ["ALEO_CREDITS"]) as CreatorPaymentAsset[];
  const acceptedPaymentVisibilities = (creator.acceptedPaymentVisibilities ?? ["PUBLIC", "PRIVATE"]) as CreatorPaymentVisibility[];
  const activeTierPrice = activeTier ? Number(activeTier.priceMicrocredits) : 0;
  const displayedPriceMicrocredits =
    selectedTier?.priceMicrocredits ?? creator.subscriptionPriceMicrocredits ?? "0";
  const subscriptionLabel = selectedPaymentAsset === "USDCX"
    ? formatUsdcxPrice(displayedPriceMicrocredits)
    : formatCredits(displayedPriceMicrocredits);
  const activeUntilLabel = subscriptionActiveUntil
    ? new Date(subscriptionActiveUntil).toLocaleString()
    : null;
  const walletBadgeLabel = hasSubscription
    ? "Subscriber"
    : walletRole === "creator"
      ? "Creator wallet"
      : walletRole === "user"
        ? "Fan wallet"
        : "Wallet connected";
  const tierNote =
    tiers.length === 0
      ? "This creator has not published tiers yet. Subscribers still unlock all private content."
      : "Select a tier to subscribe. Higher tiers unlock all lower-tier content.";
  const spendabilityRouteLabel =
    subscriptionSpendability && subscriptionSpendability.recommendedRoute !== "insufficient_balance" && subscriptionSpendability.recommendedRoute !== "wallet_unreadable"
      ? describeSubscriptionPaymentRoute(subscriptionSpendability.recommendedRoute)
      : null;
  const totalPrivateCreditsLabel = subscriptionSpendability
    ? formatMicrocreditsAsCredits(BigInt(subscriptionSpendability.totalPrivateMicrocredits))
    : null;
  const largestPrivateRecordLabel = subscriptionSpendability
    ? formatMicrocreditsAsCredits(BigInt(subscriptionSpendability.largestPrivateRecordMicrocredits))
    : null;
  const publicBalanceLabel =
    subscriptionSpendability?.publicBalanceMicrocredits != null
      ? formatMicrocreditsAsCredits(BigInt(subscriptionSpendability.publicBalanceMicrocredits))
      : null;
  const subscriptionButtonLabel = selectedPaymentAsset === "USDCX"
    ? `Subscribe with USDCx (${formatUsdcxPrice(displayedPriceMicrocredits).replace(" / month", "")})`
    : `Subscribe (${subscriptionLabel})`;
  const subscriptionSteps = buildSubscriptionSteps(subscriptionProgressStep);

  return (
    <main className="creator-page">
      <div className="card creator-hero" style={{ marginBottom: "var(--s6)" }}>
        <div className="creator-hero__inner">
          <div
            className="creator-hero__avatar"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${color}33, ${color}11)`,
              border: `1px solid ${color}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1rem",
              fontWeight: 600,
              color,
              letterSpacing: "0.04em",
            }}
          >
            {initials}
          </div>
          <div className="stack stack-2">
            <div className="stack stack-1">
              <span className="t-xs t-dim" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
                @{creator.handle}
                {creator.isVerified ? " · Verified" : ""}
              </span>
              <h2>{creator.displayName ?? creator.handle}</h2>
            </div>
            {creator.bio ? <p className="t-sm t-muted">{creator.bio}</p> : null}
            <div className="row row-2">
              <span className="badge badge--locked">Private Channel</span>
              <span className="badge badge--secure">ZK Invoice</span>
              {connected ? (
                <span className={`badge badge--dot ${hasSubscription ? "badge--secure" : "badge--neutral"}`}>
                  {walletBadgeLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="creator-content-grid">
        <div className="stack stack-4">
          <div className="card card--panel tier-panel">
            <div className="tier-panel__header">
              <div>
                <p className="dashboard__panel-title">Subscription tiers</p>
                <p className="t-xs t-dim">Support the creator and unlock the private feed.</p>
              </div>
              {hasSubscription ? <span className="badge badge--secure badge--dot">Active</span> : null}
            </div>
            <div className="tier-grid">
              {tiers.length === 0 ? (
                <div className="tier-card tier-card--placeholder">
                  <div className="tier-card__header">
                    <span className="tier-card__icon tier-card__icon--inner">IC</span>
                    <div className="tier-card__meta">
                      <span className="tier-card__name">Standard</span>
                      <span className="tier-card__price">{formatTierCredits(displayedPriceMicrocredits, selectedPaymentAsset)}</span>
                    </div>
                  </div>
                  <div className="tier-card__perks">
                    <span className="tier-card__perk">Private posts and uploads</span>
                    <span className="tier-card__perk">Member-only discussions</span>
                  </div>
                  <span className="tier-card__tag tier-card__tag--live">On-chain</span>
                </div>
              ) : (
                tiers.map((tier) => {
                  const isSelected = tier.id === selectedTierId;
                  const isActive = hasSubscription && activeTierId === tier.id;
                  const tagLabel = isActive ? "Active" : Number(tier.priceMicrocredits) > 0 ? "On-chain" : "Free";
                  return (
                    <button
                      type="button"
                      key={tier.id}
                      className={`tier-card${isSelected ? " tier-card--selected" : ""}${isActive ? " tier-card--active" : ""}`}
                      onClick={() => setSelectedTierId(tier.id)}
                    >
                      <div className="tier-card__header">
                        <span className="tier-card__icon tier-card__icon--inner">{tier.tierName.slice(0, 2).toUpperCase()}</span>
                        <div className="tier-card__meta">
                          <span className="tier-card__name">{tier.tierName}</span>
                          <span className="tier-card__price">{formatTierCredits(tier.priceMicrocredits, selectedPaymentAsset)}</span>
                        </div>
                      </div>
                      {tier.description ? <p className="t-xs t-dim">{tier.description}</p> : null}
                      <div className="tier-card__perks">
                        {(tier.benefits.length > 0 ? tier.benefits : ["Private posts", "Community access"]).map((perk) => (
                          <span key={`${tier.id}-${perk}`} className="tier-card__perk">
                            {perk}
                          </span>
                        ))}
                      </div>
                      <span className={`tier-card__tag${tagLabel === "On-chain" || tagLabel === "Active" ? " tier-card__tag--live" : ""}`}>
                        {tagLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="t-xs t-dim" style={{ marginTop: "var(--s2)" }}>
              {tierNote}
            </p>
          </div>
          <div>
            <p className="dashboard__panel-title">
              Content {creator.contents.length > 0 ? `· ${creator.contents.length} items` : ""}
            </p>
            {creator.contents.length === 0 ? (
              <div className="card card--panel" style={{ textAlign: "center", padding: "var(--s6)" }}>
                <p className="t-muted t-sm">No content published yet.</p>
              </div>
            ) : (
              <div className="grid-2" style={{ gap: "var(--s3)" }}>
                {creator.contents.map((item) => {
                  const requiredTier = item.subscriptionTierId
                    ? tiers.find((tier) => tier.id === item.subscriptionTierId)
                    : null;
                  const requiredTierPrice = requiredTier ? Number(requiredTier.priceMicrocredits) : 0;
                  const hasTierAccess =
                    requiredTierPrice === 0 || (activeTierPrice > 0 && activeTierPrice >= requiredTierPrice);
                  const isUnlocked = canAccessContent && hasTierAccess;
                  const card = <LockedContentCard title={item.title} locked={!isUnlocked} />;
                  if (!isUnlocked) {
                    return <div key={item.id}>{card}</div>;
                  }
                  return (
                    <Link key={item.id} href={`/content/${item.id}`} style={{ textDecoration: "none" }}>
                      {card}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="stack stack-3">
          <div className="card card--panel membership-panel">
            <div
              className="row between"
              style={{ cursor: "pointer", userSelect: "none", padding: "0 0 var(--s2)", borderBottom: "1px solid var(--c-border)" }}
              onClick={() => setShowMembership((v) => !v)}
            >
              <p className="dashboard__panel-title" style={{ marginBottom: 0 }}>Membership</p>
              <span
                className="t-dim"
                style={{
                  fontSize: "1rem",
                  transition: "transform 0.25s",
                  transform: showMembership ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            </div>

            {showMembership && (
              <>
                {/* Price + Status Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--s2) 0" }}>
                  <div>
                    <span className="t-lg" style={{ fontFamily: "var(--font-sans)", fontWeight: 700, letterSpacing: "-0.02em", color }}>
                      {subscriptionLabel}
                    </span>
                    {selectedTier ? (
                      <span className="t-xs t-dim" style={{ display: "block", marginTop: "2px" }}>{selectedTier.tierName} tier</span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className="badge badge--secure" style={{ fontSize: "0.6rem", padding: "2px 8px" }}>ZK Invoice</span>
                    <span className="badge badge--secure" style={{ fontSize: "0.6rem", padding: "2px 8px" }}>Private</span>
                  </div>
                </div>

                {/* Short explainer */}
                <p className="t-xs t-dim" style={{ lineHeight: "1.55", marginBottom: "var(--s3)", opacity: 0.7 }}>
                  Subscription is secured via a private Aleo invoice with local ZK proof — your wallet stays hidden from the creator.
                </p>

                {!hasSubscription ? (
                  <>
                    {/* Payment Options — compact two-row layout */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s2)", marginBottom: "var(--s3)" }}>
                      {/* Payment Asset */}
                      <div>
                        <span className="sidebar-section-label" style={{ marginBottom: "6px" }}>Asset</span>
                        <div className="payment-option-group">
                          {acceptedPaymentAssets.map((asset) => (
                            <button
                              type="button"
                              key={asset}
                              className={`btn ${selectedPaymentAsset === asset ? "btn--primary" : "btn--ghost"}`}
                              onClick={() => setSelectedPaymentAsset(asset as SubscriptionPaymentAsset)}
                            >
                              {asset === "ALEO_CREDITS" ? "Credits" : "USDCx"}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Payment Route */}
                      <div>
                        <span className="sidebar-section-label" style={{ marginBottom: "6px" }}>Route</span>
                        <div className="payment-option-group">
                          {acceptedPaymentVisibilities.map((visibility) => (
                            <button
                              type="button"
                              key={visibility}
                              className={`btn ${selectedPaymentVisibility === visibility ? "btn--primary" : "btn--ghost"}`}
                              onClick={() => setSelectedPaymentVisibility(visibility as SubscriptionPaymentVisibility)}
                            >
                              {visibility === "PUBLIC" ? "Public" : "Private"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* USDCx note — only when selected */}
                    {selectedPaymentAsset === "USDCX" ? (
                      <div className="usdcx-info" style={{ marginBottom: "var(--s3)" }}>
                        <p>USDCx Stablecoin</p>
                        <p className="t-xs t-dim">
                          Privacy-preserving USDC on Aleo.{" "}
                          <a
                            href="https://usdcx.aleo.dev/"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "rgba(0, 200, 83, 0.9)", textDecoration: "underline" }}
                          >
                            Mint testnet USDCx →
                          </a>
                        </p>
                      </div>
                    ) : null}

                    {/* Balance check — only when wallet connected */}
                    {connected && (
                      <div style={{ marginBottom: "var(--s3)", padding: "var(--s2)", borderRadius: "var(--r-md)", background: "rgba(255,255,255,0.02)", border: "1px solid var(--c-border)" }}>
                        <span className="t-xs t-dim" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--c-success)", display: "inline-block" }} />
                          {selectedPaymentAsset === "USDCX"
                            ? "Requires private USDCx token record"
                            : spendabilityLoading
                              ? "Scanning wallet..."
                              : subscriptionSpendability
                                ? `${publicBalanceLabel ?? "0"} public · ${totalPrivateCreditsLabel ?? "0"} private`
                                : "Wallet connected"
                          }
                        </span>
                      </div>
                    )}
                  </>
                ) : null}

                <button
                  type="button"
                  className={`btn btn--primary btn--subscribe${hasSubscription ? " btn--subscribed" : ""}`}
                  onClick={onSubscribe}
                  disabled={
                    subscribeState === "wallet" ||
                    subscribeState === "verifying" ||
                    walletRole === "creator" ||
                    hasSubscription
                  }
                >
                  {walletRole === "creator"
                    ? "Creator wallet locked"
                    : hasSubscription
                      ? "✓ Subscribed"
                      : subscribeState === "wallet"
                        ? subscribeRoute === "public_balance"
                          ? "Minting via public balance..."
                          : subscribeRoute === "private_to_public_fallback"
                            ? "Running Shield fallback..."
                            : "Preparing ZK invoice..."
                        : subscribeState === "verifying"
                          ? "Registering invoice proof..."
                        : subscribeState === "success"
                            ? "✓ Subscribed"
                            : subscriptionButtonLabel}
                </button>

                {subscribeTxId ? (
                  <p className="t-xs t-dim" style={{ marginTop: "var(--s2)", wordBreak: "break-all" }}>
                    tx: {subscribeTxId}
                  </p>
                ) : null}

                {subscribeState === "success" ? (
                  <p className="t-sm t-success" style={{ marginTop: "var(--s2)" }}>
                    {membershipProofLabel ?? "✔ Subscription Verified Privately"}
                  </p>
                ) : null}

                {anonRegistrationNotice ? (
                  <p className="t-xs t-success" style={{ marginTop: "var(--s1)", opacity: 0.9 }}>
                    {anonRegistrationNotice}
                  </p>
                ) : null}

                {subscribeProgressLabel ? (
                  <p className="t-xs t-dim" style={{ marginTop: "var(--s2)" }}>
                    {subscribeProgressLabel}
                  </p>
                ) : null}

                {subscriptionProgressStep > 0 ? (
                  <div className="subscription-steps">
                    {subscriptionSteps.map((step) => (
                      <div key={step.id} className="row" style={{ justifyContent: "space-between", gap: "var(--s2)" }}>
                        <span className="t-xs">{step.label}</span>
                        <span
                          className={`badge ${
                            step.status === "done"
                              ? "badge--secure"
                              : step.status === "loading"
                                ? "badge--locked"
                                : "badge--neutral"
                          }`}
                        >
                          {step.status === "done" ? "Done" : step.status === "loading" ? "Loading" : "Pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {subscribeRoute ? (
                  <p className="t-xs t-dim" style={{ marginTop: "var(--s1)" }}>
                    Route: {describeSubscriptionPaymentRoute(subscribeRoute)}
                  </p>
                ) : null}

                {latestVerifyTxIdRef.current ? (
                  <p className="t-xs t-dim" style={{ marginTop: "var(--s1)", wordBreak: "break-all" }}>
                    verify tx: {latestVerifyTxIdRef.current}
                  </p>
                ) : null}

                {hasSubscription && activeUntilLabel ? (
                  <p className="t-sm t-success" style={{ marginTop: "var(--s2)" }}>
                    Active until {activeUntilLabel}
                  </p>
                ) : null}

                {subscribeError ? (
                  <p className="t-sm t-error" style={{ marginTop: "var(--s2)" }}>
                    {subscribeError}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="card card--panel tip-panel">
            <p className="dashboard__panel-title" style={{ marginBottom: "var(--s3)" }}>💰 Tip the Creator</p>
            <div className="stack stack-3">
              <div className="form-group">
                <span className="sidebar-section-label">Amount (credits)</span>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2.50"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <span className="sidebar-section-label">Message (optional)</span>
                <textarea
                  className="form-textarea"
                  placeholder="Share a note with the creator"
                  value={tipMessage}
                  onChange={(e) => setTipMessage(e.target.value)}
                />
              </div>
              <label className="anon-check">
                <input
                  type="checkbox"
                  checked={tipAnonymous}
                  onChange={(e) => setTipAnonymous(e.target.checked)}
                />
                <span className="t-xs t-dim">Send tip anonymously</span>
              </label>
              <button
                type="button"
                className="btn btn--primary btn--tip"
                onClick={onTip}
                disabled={tipLoading}
              >
                {tipLoading ? "Sending tip..." : "Send Tip"}
              </button>
              {tipError ? <p className="t-sm t-error">{tipError}</p> : null}
              {tipSuccess ? <p className="t-sm t-success">{tipSuccess}</p> : null}
            </div>

            <div className="supporters-section">
              <span className="sidebar-section-label">Top Supporters</span>
              {leaderboard.length === 0 ? (
                <p className="t-xs t-dim">No tips yet — be the first!</p>
              ) : (
                <div className="stack stack-1">
                  {leaderboard.slice(0, 5).map((supporter, index) => (
                    <div key={supporter.supporter} className="supporter-row">
                      <span className="row" style={{ gap: "8px" }}>
                        <span className="supporter-rank">{index + 1}</span>
                        <span className="t-xs">{anonLabelFromSeed(supporter.supporter)}</span>
                      </span>
                      <span className="t-xs t-dim">
                        {(Number(supporter.totalMicrocredits) / 1_000_000).toFixed(2)} credits
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
