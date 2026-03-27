"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Network } from "@provablehq/aleo-types";
import { LiveStreamPlayer } from "@/components/LiveStreamPlayer";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import {
  fetchLiveStreamById,
  fetchCreatorMessagingKey,
  type LiveStream,
  verifyLiveStreamPurchase,
} from "@/lib/api";
import {
  executeCreditsTransfer,
  waitForOnChainTransactionId,
} from "@/lib/aleoTransactions";
import { useWallet } from "@/lib/walletContext";
import { getWalletSessionToken } from "@/lib/walletSession";
import { PrivateCommentComposer } from "@/features/liveComments/PrivateCommentComposer";

interface LiveStreamPageProps {
  params: Promise<{ liveStreamId: string }>;
}

type PurchaseState = "idle" | "wallet" | "verifying" | "success";

const CREDITS_PROGRAM_ID = "credits.aleo";

const formatCredits = (microcredits: string | null): string =>
  `${(Number(microcredits ?? "0") / 1_000_000).toFixed(2)} credits`;

const formatWalletError = (message: string): string => {
  if (/no selected account/i.test(message)) {
    return "Wallet account is not selected. Open the wallet extension, select an account, reconnect, and retry.";
  }

  if (/failed to execute transaction/i.test(message)) {
    return `${message}. Reconnect the wallet and confirm the account has enough balance for fees.`;
  }

  return message;
};

export default function LiveStreamPage({ params }: LiveStreamPageProps) {
  const { liveStreamId } = use(params);
  const wallet = useWallet();
  const { connected, address, network } = wallet;
  const { enabled: anonEnabled } = useAnonymousMode();
  const [liveStream, setLiveStream] = useState<LiveStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseTxId, setPurchaseTxId] = useState<string | null>(null);
  const [playerNonce, setPlayerNonce] = useState(0);
  const [creatorPublicKey, setCreatorPublicKey] = useState<string | null>(null);

  useEffect(() => {
    const hydrateLiveStream = async () => {
      if (!connected || !address) {
        setLoading(false);
        setLiveStream(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const walletToken = await getWalletSessionToken(wallet);
        const response = await fetchLiveStreamById(liveStreamId, walletToken);
        setLiveStream(response.liveStream);
      } catch (loadError) {
        setError((loadError as Error).message || "Unable to load the live stream.");
        setLiveStream(null);
      } finally {
        setLoading(false);
      }
    };

    void hydrateLiveStream();
  }, [address, connected, liveStreamId]);

  useEffect(() => {
    if (!liveStream?.creatorId) {
      setCreatorPublicKey(null);
      return;
    }

    fetchCreatorMessagingKey(liveStream.creatorId)
      .then((data) => setCreatorPublicKey(data.publicKeyB64))
      .catch(() => setCreatorPublicKey(null));
  }, [liveStream]);

  const ensureWalletConnected = async (): Promise<void> => {
    if (!connected || !address) {
      throw new Error("Connect your Aleo wallet first.");
    }

    if (network !== Network.TESTNET) {
      const switched = await wallet.switchNetwork(Network.TESTNET);
      if (!switched && wallet.network !== Network.TESTNET) {
        throw new Error("Switch the wallet network to Aleo testnet and try again.");
      }
    }
  };

  const onVerifyLivePpv = async (): Promise<void> => {
    if (!liveStream) {
      return;
    }

    setPurchaseError(null);
    setPurchaseTxId(null);

    try {
      await ensureWalletConnected();

      if (!liveStream.creator.walletAddress || !liveStream.creator.walletAddress.startsWith("aleo1")) {
        throw new Error("Creator wallet address is missing. The creator needs to update their profile.");
      }

      setPurchaseState("wallet");
      const walletTxId = await executeCreditsTransfer({
        wallet,
        recipientAddress: liveStream.creator.walletAddress,
        amountMicrocredits: liveStream.ppvPriceMicrocredits ?? "0",
      });

      setPurchaseTxId(walletTxId);
      setPurchaseState("verifying");

      const chainTxId = await waitForOnChainTransactionId(wallet, walletTxId, CREDITS_PROGRAM_ID, {
        attempts: 60,
        delayMs: 2000,
      });

      setPurchaseTxId(chainTxId);

      const walletToken = await getWalletSessionToken(wallet);
      await verifyLiveStreamPurchase(
        liveStream.id,
        {
          txId: chainTxId,
          walletAddressHint: address ?? undefined,
        },
        walletToken,
      );

      setPurchaseState("success");
      setAccessError(null);
      setPlayerNonce((value) => value + 1);
    } catch (purchaseFailure) {
      setPurchaseState("idle");
      setPurchaseError(formatWalletError((purchaseFailure as Error).message || "Failed to verify live PPV access."));
    }
  };

  if (!connected || !address) {
    return (
      <main className="disc-page">
        <div className="disc-container">
          <div className="card card--panel" style={{ maxWidth: 720, margin: "4rem auto" }}>
            <p className="section__label">Live Access</p>
            <h1 style={{ fontSize: "2rem", margin: "0.5rem 0 1rem" }}>Connect your wallet to watch</h1>
            <p className="t-sm t-muted" style={{ marginBottom: "var(--s3)" }}>
              Only entitled Aleo wallets receive IVS playback URLs. Nothing is public by default.
            </p>
            <WalletConnectButton />
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="disc-page">
        <div className="disc-container">
          <div className="card card--panel" style={{ maxWidth: 960, margin: "4rem auto", textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
            <p className="t-sm t-muted" style={{ marginTop: "var(--s2)" }}>
              Loading live stream...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!liveStream) {
    return (
      <main className="disc-page">
        <div className="disc-container">
          <div className="card card--panel" style={{ maxWidth: 960, margin: "4rem auto" }}>
            <p className="t-sm t-error">{error ?? "Live stream not found."}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="disc-page">
      <div className="disc-container stack stack-5" style={{ maxWidth: 1180, paddingTop: "var(--s5)" }}>
        <div className="stack stack-2" style={{ maxWidth: 860 }}>
          <Link
            href="/discover"
            className="t-xs t-dim btn btn--ghost btn--sm"
            style={{ padding: 0, height: "auto", width: "fit-content" }}
          >
            Back to discover
          </Link>
          <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.8rem)", lineHeight: 1.05 }}>{liveStream.title}</h1>
          <p className="t-sm t-muted" style={{ fontSize: "0.98rem" }}>
            @{liveStream.creator.handle} -{" "}
            {liveStream.accessType === "PPV"
              ? `${formatCredits(liveStream.ppvPriceMicrocredits)} pay-per-view`
              : `Subscription access - ${formatCredits(liveStream.creator.subscriptionPriceMicrocredits)}/month`}
          </p>
          <div className="row row-2" style={{ flexWrap: "wrap" }}>
            <span className="badge badge--secure">End-to-End Encrypted</span>
            <span className="badge badge--secure">Creator-Only Messages</span>
            {anonEnabled ? <span className="badge badge--neutral">Anonymous Mode ON</span> : null}
          </div>
        </div>

        <section
          className="card card--panel stack stack-3"
          style={{
            padding: "clamp(1rem, 2vw, 1.35rem)",
            borderRadius: 28,
            background: "linear-gradient(180deg, rgba(15,15,17,0.94), rgba(15,15,17,0.72))",
          }}
        >
          <LiveStreamPlayer
            key={`${liveStream.id}:${playerNonce}`}
            liveStreamId={liveStream.id}
            onAccessDenied={setAccessError}
            onReady={() => setAccessError(null)}
          />
        </section>

        <PrivateCommentComposer liveStreamId={liveStream.id} creatorPublicKeyB64={creatorPublicKey} />

        <div className="card card--panel">
          <p className="t-xs t-dim">
            This stream is private by default. Playback requires a short-lived IVS URL bound to your wallet session.
            {liveStream.accessType === "PPV"
              ? " PPV viewers must verify their on-chain payment before the stream opens."
              : " Active creator subscriptions are checked before each playback URL is issued."}
          </p>
        </div>

        {accessError ? (
          <div className="card card--panel stack stack-3">
            <p className="section__label">Access required</p>
            <p className="t-sm t-error">{accessError}</p>

            {liveStream.accessType === "PPV" ? (
              <>
                <p className="t-sm t-muted">
                  Buy access once, verify it on-chain, and the player will retry without exposing the raw playback URL.
                </p>
                <div className="row row-3" style={{ flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={onVerifyLivePpv}
                    disabled={purchaseState === "wallet" || purchaseState === "verifying"}
                  >
                    {purchaseState === "wallet" && "Preparing wallet transfer..."}
                    {purchaseState === "verifying" && "Verifying PPV payment..."}
                    {purchaseState === "success" && "Live access verified"}
                    {purchaseState === "idle" && `Buy Live Access (${formatCredits(liveStream.ppvPriceMicrocredits)})`}
                  </button>

                  <Link href={`/creator/${liveStream.creator.handle}`} className="btn btn--secondary">
                    View creator page
                  </Link>
                </div>

                {purchaseTxId ? (
                  <p className="t-xs t-dim" style={{ wordBreak: "break-all" }}>
                    live purchase tx: {purchaseTxId}
                  </p>
                ) : null}
                {purchaseError ? <p className="t-sm t-error">{purchaseError}</p> : null}
              </>
            ) : (
              <div className="row row-3" style={{ flexWrap: "wrap" }}>
                <p className="t-sm t-muted">This creator's live stream is available to active subscribers only.</p>
                <Link href={`/creator/${liveStream.creator.handle}`} className="btn btn--secondary">
                  Open creator page
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
