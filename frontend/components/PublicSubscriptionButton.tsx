"use client";

import { useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { executePublicSubscription } from "@/lib/publicSubscription";

interface PublicSubscriptionButtonProps {
  circleId: string;
  creatorAddress: string;
  amountMicrocredits: bigint;
  expiresAtBlock: number;
  saltField: string;
  feeMicrocredits?: bigint;
}

export function PublicSubscriptionButton({
  circleId,
  creatorAddress,
  amountMicrocredits,
  expiresAtBlock,
  saltField,
  feeMicrocredits = 900_000n,
}: PublicSubscriptionButtonProps) {
  const wallet = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setTxId(null);

    try {
      const transactionId = await executePublicSubscription({
        wallet,
        circleId,
        creatorAddress,
        amountMicrocredits,
        expiresAtBlock,
        saltField,
        feeMicrocredits,
      });
      setTxId(transactionId);
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Public subscription payment failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={() => { void handleClick(); }} disabled={submitting || !wallet.address}>
        {submitting ? "Submitting..." : "Subscribe"}
      </button>
      {txId ? <p>Submitted transaction: {txId}</p> : null}
      {error ? <p>{error}</p> : null}
    </div>
  );
}
