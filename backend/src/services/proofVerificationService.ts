import { env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";
import type { ExplorerTransition, ExplorerTransitionIO, ExplorerTx } from "./aleoExplorerService.js";
import { extractFeePayerAddress, fetchExplorerTx, isExecuteTx } from "./aleoExplorerService.js";

export interface SubscriptionProofInput {
  creatorFieldId: string;
  proveTxId?: string;
  functionName?: string;
  walletAddressHint?: string;
}

export interface ContentAccessProofInput {
  contentFieldId: string;
  proveTxId?: string;
  walletAddressHint?: string;
}

export interface AccessPassProofInput {
  creatorFieldId: string;
  contentFieldId: string;
  proveTxId?: string;
  walletAddressHint?: string;
}

export interface VerifiedOwnership {
  walletHash: string;
  resourceFieldId: string;
  provedByTxId?: string;
}

export interface SubscriptionPaymentInput {
  creatorFieldId: string;
  purchaseTxId?: string;
  functionName?: string;
  walletAddressHint?: string;
  expectedPriceMicrocredits?: bigint;
  expectedRecipientAddress?: string;
}

export interface PpvPaymentInput {
  contentFieldId: string;
  purchaseTxId?: string;
  walletAddressHint?: string;
  expectedPriceMicrocredits?: bigint;
  expectedRecipientAddress?: string;
}

export interface AccessPassPaymentInput {
  creatorFieldId: string;
  contentFieldId: string;
  purchaseTxId?: string;
  walletAddressHint?: string;
  expectedPriceMicrocredits?: bigint;
  expectedRecipientAddress?: string;
}

export interface TipProofInput {
  creatorFieldId: string;
  creatorAddress: string;
  amountMicrocredits: bigint;
  txId?: string;
}

export interface TipPaymentInput {
  creatorFieldId: string;
  purchaseTxId?: string;
  walletAddressHint?: string;
  expectedPriceMicrocredits: bigint;
  expectedRecipientAddress: string;
}

const toFieldLiteral = (value: string): string => (value.endsWith("field") ? value : `${value}field`);
const toU64Literal = (value: bigint): string => `${value}u64`;

const normalizeLiteral = (value: string): string => value.trim().replace(/\.(public|private)$/i, "");

const includesLiteral = (values: string[], expected: string): boolean => {
  const normalizedExpected = normalizeLiteral(expected);
  return values.some((value) => normalizeLiteral(value) === normalizedExpected);
};

const assertIncludesLiteral = (values: string[], expected: string, label: string): void => {
  if (!includesLiteral(values, expected)) {
    throw new Error(`${label} mismatch`);
  }
};

const hasUnsignedIntegerLiteral = (values: string[]): boolean => {
  return values.some((value) => /^\d+u(8|16|32|64|128)$/i.test(normalizeLiteral(value)));
};

const subjectHash = (value: string): string => sha256Hex(value.toLowerCase());

const walletHash = (walletAddress: string): string => subjectHash(walletAddress);

const resolveWalletAddress = (value?: string): string => {
  if (!value) throw new Error("Missing wallet address (cannot bind session)");
  return value;
};

const txAppearsAccepted = (tx: ExplorerTx): boolean => {
  const maybeStatus = (tx as { status?: unknown }).status;
  if (typeof maybeStatus !== "string") {
    return true;
  }

  const normalized = maybeStatus.trim().toLowerCase();
  if (!normalized) return true;

  return normalized === "accepted" || normalized === "confirmed" || normalized === "finalized";
};

const findTransition = (
  tx: ExplorerTx,
  program: string,
  functionName: string,
): ExplorerTransition | undefined => {
  if (!isExecuteTx(tx)) {
    throw new Error(`Expected execute tx, got ${String((tx as { type?: unknown }).type)}`);
  }

  return tx.execution.transitions.find((t: ExplorerTransition) => t.program === program && t.function === functionName);
};

const publicInputsFromTransition = (transition: ExplorerTransition): string[] => {
  return (transition.inputs ?? [])
    .filter((io: ExplorerTransitionIO) => io.type === "public")
    .map((io: ExplorerTransitionIO) => io.value ?? "");
};

const verifyDirectCreditsTransfer = async ({
  txId,
  expectedRecipientAddress,
  expectedPriceMicrocredits,
  walletAddressHint,
}: {
  txId: string;
  expectedRecipientAddress: string;
  expectedPriceMicrocredits?: bigint;
  walletAddressHint?: string;
}): Promise<{ walletHash: string }> => {
  const tx = await fetchExplorerTx(txId);
  const transition = findTransition(tx, "credits.aleo", "transfer_public");
  if (!transition) {
    throw new Error("credits.aleo/transfer_public transition not found in transaction");
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${txId} is not accepted yet`);
  }

  const publicInputs = publicInputsFromTransition(transition);
  if (!includesLiteral(publicInputs, expectedRecipientAddress)) {
    throw new Error("credits.aleo transfer recipient mismatch");
  }

  if (typeof expectedPriceMicrocredits === "bigint") {
    const expectedPrice = toU64Literal(expectedPriceMicrocredits);
    if (!includesLiteral(publicInputs, expectedPrice)) {
      throw new Error("credits.aleo transfer amount mismatch");
    }
  }

  const address = extractFeePayerAddress(tx) ?? walletAddressHint;
  return {
    walletHash: walletHash(resolveWalletAddress(address)),
  };
};

const verifyExecuteTransition = async ({
  txId,
  programId,
  functionName,
  expectedFieldId,
  expectedFieldLabel,
  expectedPriceMicrocredits,
  expectedPriceLabel,
  walletAddressHint,
  anonymousSubjectId,
}: {
  txId: string;
  programId: string;
  functionName: string;
  expectedFieldId: string;
  expectedFieldLabel: string;
  expectedPriceMicrocredits?: bigint;
  expectedPriceLabel?: string;
  walletAddressHint?: string;
  anonymousSubjectId?: string;
}): Promise<{ walletHash: string }> => {
  const tx = await fetchExplorerTx(txId);
  const transition = findTransition(tx, programId, functionName);
  if (!transition) {
    throw new Error(`${functionName} transition not found in transaction`);
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${txId} is not accepted yet`);
  }

  const expectedField = toFieldLiteral(expectedFieldId);
  const publicInputs = publicInputsFromTransition(transition);
  if (!includesLiteral(publicInputs, expectedField)) {
    throw new Error(`${functionName} public ${expectedFieldLabel} mismatch`);
  }

  if (typeof expectedPriceMicrocredits === "bigint") {
    const priceInputs = publicInputs.filter((value) => normalizeLiteral(value) !== normalizeLiteral(expectedField));
    if (hasUnsignedIntegerLiteral(priceInputs)) {
      const expectedPrice = toU64Literal(expectedPriceMicrocredits);
      if (!includesLiteral(priceInputs, expectedPrice)) {
        throw new Error(`${functionName} public ${expectedPriceLabel ?? "amount"} mismatch`);
      }
    }
  }

  if (anonymousSubjectId) {
    return {
      walletHash: subjectHash(anonymousSubjectId),
    };
  }

  const address = extractFeePayerAddress(tx) ?? walletAddressHint;
  return {
    walletHash: walletHash(resolveWalletAddress(address)),
  };
};

const verifyMockOnly = (
  resourceFieldId: string,
  walletAddressHint?: string,
): VerifiedOwnership => {
  const address = resolveWalletAddress(walletAddressHint);
  return {
    walletHash: walletHash(address),
    resourceFieldId,
  };
};

const resolveAllowedFunctionName = (
  provided: string | undefined,
  allowed: string[],
  fallback: string,
): string => {
  if (!provided) return fallback;
  if (!allowed.includes(provided)) {
    throw new Error(`Unsupported transition "${provided}"`);
  }
  return provided;
};

export const verifySubscriptionProof = async (
  input: SubscriptionProofInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.creatorFieldId, input.walletAddressHint);
  }

  if (!input.proveTxId) {
    throw new Error("Missing proveTxId. Expected an on-chain execute tx calling prove_subscription.");
  }

  const functionName = resolveAllowedFunctionName(
    input.functionName,
    ["prove_subscription", "prove_subscription_v2"],
    "prove_subscription_v2",
  );

  const verified = await verifyExecuteTransition({
    txId: input.proveTxId,
    programId: env.subscriptionProgramId,
    functionName,
    expectedFieldId: input.creatorFieldId,
    expectedFieldLabel: "creatorId",
    anonymousSubjectId: `${env.subscriptionProgramId}:${functionName}:${input.proveTxId}`,
  });

  return {
    walletHash: verified.walletHash,
    resourceFieldId: input.creatorFieldId,
    provedByTxId: input.proveTxId,
  };
};

export const verifyContentAccessProof = async (
  input: ContentAccessProofInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.contentFieldId, input.walletAddressHint);
  }

  if (!input.proveTxId) {
    throw new Error("Missing proveTxId. Expected an on-chain execute tx calling prove_content_access.");
  }

  const verified = await verifyExecuteTransition({
    txId: input.proveTxId,
    programId: env.ppvProgramId,
    functionName: "prove_content_access",
    expectedFieldId: input.contentFieldId,
    expectedFieldLabel: "contentId",
    anonymousSubjectId: `${env.ppvProgramId}:prove_content_access:${input.proveTxId}`,
  });

  return {
    walletHash: verified.walletHash,
    resourceFieldId: input.contentFieldId,
    provedByTxId: input.proveTxId,
  };
};

export const verifyAccessPassProof = async (
  input: AccessPassProofInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.contentFieldId, input.walletAddressHint);
  }

  if (!input.proveTxId) {
    throw new Error("Missing proveTxId. Expected an on-chain execute tx calling prove_access.");
  }

  const tx = await fetchExplorerTx(input.proveTxId);
  const transition = findTransition(tx, env.accessPassProgramId, "prove_access");
  if (!transition) {
    throw new Error("prove_access transition not found in transaction");
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${input.proveTxId} is not accepted yet`);
  }

  const publicInputs = publicInputsFromTransition(transition);
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.creatorFieldId), "prove_access public creatorId");
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.contentFieldId), "prove_access public contentId");

  const address = extractFeePayerAddress(tx) ?? input.walletAddressHint;
  return {
    walletHash: walletHash(resolveWalletAddress(address)),
    resourceFieldId: input.contentFieldId,
    provedByTxId: input.proveTxId,
  };
};

export const verifySubscriptionPayment = async (
  input: SubscriptionPaymentInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.creatorFieldId, input.walletAddressHint);
  }

  if (!input.purchaseTxId) {
    throw new Error("Missing purchaseTxId. Expected an on-chain execute tx calling subscribe.");
  }

  const functionName = resolveAllowedFunctionName(
    input.functionName,
    ["pay_and_subscribe", "pay_and_subscribe_v2"],
    "pay_and_subscribe_v2",
  );

  let verified: { walletHash: string };
  try {
    verified = await verifyExecuteTransition({
      txId: input.purchaseTxId,
      programId: env.subscriptionProgramId,
      functionName,
      expectedFieldId: input.creatorFieldId,
      expectedFieldLabel: "creatorId",
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      expectedPriceLabel: "subscriptionPriceMicrocredits",
      walletAddressHint: input.walletAddressHint,
    });
  } catch (error) {
    if (!input.expectedRecipientAddress) {
      throw error;
    }

    verified = await verifyDirectCreditsTransfer({
      txId: input.purchaseTxId,
      expectedRecipientAddress: input.expectedRecipientAddress,
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      walletAddressHint: input.walletAddressHint,
    });
  }

  return {
    walletHash: verified.walletHash,
    resourceFieldId: input.creatorFieldId,
    provedByTxId: input.purchaseTxId,
  };
};

export const verifyPpvPayment = async (
  input: PpvPaymentInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.contentFieldId, input.walletAddressHint);
  }

  if (!input.purchaseTxId) {
    throw new Error("Missing purchaseTxId. Expected an on-chain execute tx calling buy_content.");
  }

  let verified: { walletHash: string };
  try {
    verified = await verifyExecuteTransition({
      txId: input.purchaseTxId,
      programId: env.ppvProgramId,
      functionName: "buy_content",
      expectedFieldId: input.contentFieldId,
      expectedFieldLabel: "contentId",
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      expectedPriceLabel: "ppvPriceMicrocredits",
      walletAddressHint: input.walletAddressHint,
    });
  } catch (error) {
    if (!input.expectedRecipientAddress) {
      throw error;
    }

    verified = await verifyDirectCreditsTransfer({
      txId: input.purchaseTxId,
      expectedRecipientAddress: input.expectedRecipientAddress,
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      walletAddressHint: input.walletAddressHint,
    });
  }

  return {
    walletHash: verified.walletHash,
    resourceFieldId: input.contentFieldId,
    provedByTxId: input.purchaseTxId,
  };
};

export const verifyAccessPassPayment = async (
  input: AccessPassPaymentInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.contentFieldId, input.walletAddressHint);
  }

  if (!input.purchaseTxId) {
    throw new Error("Missing purchaseTxId. Expected an on-chain execute tx calling buy_access.");
  }

  const tx = await fetchExplorerTx(input.purchaseTxId);
  const transition = findTransition(tx, env.accessPassProgramId, "buy_access");
  if (!transition) {
    throw new Error("buy_access transition not found in transaction");
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${input.purchaseTxId} is not accepted yet`);
  }

  const publicInputs = publicInputsFromTransition(transition);
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.creatorFieldId), "buy_access public creatorId");
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.contentFieldId), "buy_access public contentId");

  if (input.expectedRecipientAddress) {
    assertIncludesLiteral(publicInputs, input.expectedRecipientAddress, "buy_access public creatorAddress");
  }

  if (typeof input.expectedPriceMicrocredits === "bigint") {
    const expectedPrice = toU64Literal(input.expectedPriceMicrocredits);
    assertIncludesLiteral(publicInputs, expectedPrice, "buy_access public price");
  }

  const address = extractFeePayerAddress(tx) ?? input.walletAddressHint;
  return {
    walletHash: walletHash(resolveWalletAddress(address)),
    resourceFieldId: input.contentFieldId,
    provedByTxId: input.purchaseTxId,
  };
};

export const verifyTipProof = async (
  input: TipProofInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return {
      walletHash: subjectHash(`${env.tipProgramId}:tip_private:${input.txId ?? input.creatorFieldId}`),
      resourceFieldId: input.creatorFieldId,
      provedByTxId: input.txId,
    };
  }

  if (!input.txId) {
    throw new Error("Missing txId. Expected an on-chain execute tx calling tip_private.");
  }

  const tx = await fetchExplorerTx(input.txId);
  const transition = findTransition(tx, env.tipProgramId, "tip_private");
  if (!transition) {
    throw new Error("tip_private transition not found in transaction");
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${input.txId} is not accepted yet`);
  }

  const publicInputs = publicInputsFromTransition(transition);
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.creatorFieldId), "tip_private public creatorId");
  assertIncludesLiteral(publicInputs, input.creatorAddress, "tip_private public creatorAddress");
  assertIncludesLiteral(publicInputs, toU64Literal(input.amountMicrocredits), "tip_private public amount");

  return {
    walletHash: subjectHash(`${env.tipProgramId}:tip_private:${input.txId}`),
    resourceFieldId: input.creatorFieldId,
    provedByTxId: input.txId,
  };
};

export const verifyTipPayment = async (
  input: TipPaymentInput,
): Promise<VerifiedOwnership> => {
  if (env.proofVerificationMode === "mock") {
    return verifyMockOnly(input.creatorFieldId, input.walletAddressHint);
  }

  if (!input.purchaseTxId) {
    throw new Error("Missing purchaseTxId. Expected an on-chain credits.aleo transfer_public.");
  }

  const verified = await verifyDirectCreditsTransfer({
    txId: input.purchaseTxId,
    expectedRecipientAddress: input.expectedRecipientAddress,
    expectedPriceMicrocredits: input.expectedPriceMicrocredits,
    walletAddressHint: input.walletAddressHint,
  });

  return {
    walletHash: verified.walletHash,
    resourceFieldId: input.creatorFieldId,
    provedByTxId: input.purchaseTxId,
  };
};
