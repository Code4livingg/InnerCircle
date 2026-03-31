"use client";

import type { WalletContextState } from "@/lib/walletContext";
import { executeProgramTransaction } from "@/lib/aleoTransactions";
import { PAYMENT_PROOF_PROGRAM_ID } from "@/lib/programIds";

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");
const toFieldLiteral = (value: string): string => `${normalizeFieldId(value)}field`;
const toU64Literal = (value: bigint): string => `${value.toString()}u64`;
const toU32Literal = (value: number): string => `${value}u32`;

export interface ExecutePublicSubscriptionInput {
  wallet: WalletContextState;
  circleId: string;
  creatorAddress: string;
  amountMicrocredits: bigint;
  expiresAtBlock: number;
  saltField: string;
  feeMicrocredits?: bigint;
}

export const executePublicSubscription = async ({
  wallet,
  circleId,
  creatorAddress,
  amountMicrocredits,
  expiresAtBlock,
  saltField,
  feeMicrocredits = 900_000n,
}: ExecutePublicSubscriptionInput): Promise<string> => {
  if (typeof window === "undefined") {
    throw new Error("Public Aleo execution must run in the browser.");
  }
  if (!wallet.address?.startsWith("aleo1")) {
    throw new Error("Connect an Aleo wallet before executing pay_and_subscribe_public.");
  }

  const normalizedCreator = creatorAddress.trim();
  if (!/^aleo1[0-9a-z]+$/i.test(normalizedCreator)) {
    throw new Error(`Invalid creator address: "${creatorAddress}".`);
  }
  if (amountMicrocredits <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  if (!Number.isInteger(expiresAtBlock) || expiresAtBlock <= 0) {
    throw new Error("expiresAtBlock must be a positive block height.");
  }
  if (feeMicrocredits <= 0n || feeMicrocredits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("feeMicrocredits must be a positive safe integer.");
  }

  const feeAleo = Number(feeMicrocredits) / 1_000_000;
  const txInputs = [
    toFieldLiteral(circleId),
    toU64Literal(amountMicrocredits),
    toU32Literal(expiresAtBlock),
    toFieldLiteral(saltField),
    normalizedCreator,
  ];

  console.info("[InnerCircle] pay_and_subscribe_public request", {
    programId: PAYMENT_PROOF_PROGRAM_ID,
    functionName: "pay_and_subscribe_public",
    inputs: txInputs,
    fee: `${feeMicrocredits.toString()}u64`,
    signer: wallet.address,
  });

  try {
    return await executeProgramTransaction({
      wallet,
      programId: PAYMENT_PROOF_PROGRAM_ID,
      functionName: "pay_and_subscribe_public",
      inputs: txInputs,
      feeAleo,
      privateFee: false,
    });
  } catch (error) {
    console.error("[InnerCircle] pay_and_subscribe_public failed", {
      programId: PAYMENT_PROOF_PROGRAM_ID,
      signer: wallet.address,
      inputs: txInputs,
      fee: `${feeMicrocredits.toString()}u64`,
      error,
    });
    throw error;
  }
};
