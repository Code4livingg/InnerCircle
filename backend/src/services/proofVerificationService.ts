import { env } from "../config/env.js";
import { sha256Hex } from "../utils/crypto.js";
import type { ExplorerTransition, ExplorerTransitionIO, ExplorerTx } from "./aleoExplorerService.js";
import { ExplorerRequestError, extractFeePayerAddress, fetchExplorerTx, isExecuteTx } from "./aleoExplorerService.js";
import { approximateExpiryDateFromBlockHeights, tierFromPriceMicrocredits } from "./subscriptionService.js";

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

export interface ZkExecutionProofInput {
  programId: string;
  transitionName: string;
  publicInputs: {
    circleId?: string;
    currentBlock?: number;
    expiresAt?: number;
    tier?: number;
  };
  executionProof: string;
  verifyingKey?: string;
  programSource?: string;
}

export interface VerifiedZkSubscriptionProof {
  verified: true;
  circleId: string;
  currentBlock: number;
  expiresAtBlock: number;
  expiresAt: Date;
  tier: number;
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
  const transition =
    findTransition(tx, "credits.aleo", "transfer_public") ??
    findTransition(tx, "credits.aleo", "transfer_private_to_public");
  if (!transition) {
    throw new Error("credits.aleo direct transfer transition not found in transaction");
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

const verifyMatchedExecuteTransition = ({
  tx,
  txId,
  transition,
  expectedFieldId,
  expectedFieldLabel,
  expectedPriceMicrocredits,
  expectedPriceLabel,
  walletAddressHint,
  anonymousSubjectId,
  expectedTier,
  expectedTierLabel = "tier",
}: {
  tx: ExplorerTx;
  txId: string;
  transition: ExplorerTransition;
  expectedFieldId: string;
  expectedFieldLabel: string;
  expectedPriceMicrocredits?: bigint;
  expectedPriceLabel?: string;
  walletAddressHint?: string;
  anonymousSubjectId?: string;
  expectedTier?: number;
  expectedTierLabel?: string;
}): { walletHash: string } => {
  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${txId} is not accepted yet`);
  }

  const expectedField = toFieldLiteral(expectedFieldId);
  const publicInputs = publicInputsFromTransition(transition);
  if (!includesLiteral(publicInputs, expectedField)) {
    throw new Error(`${transition.function} public ${expectedFieldLabel} mismatch`);
  }

  if (typeof expectedPriceMicrocredits === "bigint") {
    const priceInputs = publicInputs.filter((value) => normalizeLiteral(value) !== normalizeLiteral(expectedField));
    if (hasUnsignedIntegerLiteral(priceInputs)) {
      const expectedU64Price = toU64Literal(expectedPriceMicrocredits);
      const expectedU128Price = `${expectedPriceMicrocredits}u128`;
      if (!includesLiteral(priceInputs, expectedU64Price) && !includesLiteral(priceInputs, expectedU128Price)) {
        throw new Error(`${transition.function} public ${expectedPriceLabel ?? "amount"} mismatch`);
      }
    }
  }

  if (typeof expectedTier === "number") {
    const expectedTierLiteral = `${expectedTier}u8`;
    if (!includesLiteral(publicInputs, expectedTierLiteral)) {
      throw new Error(`${transition.function} public ${expectedTierLabel} mismatch`);
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

  return verifyMatchedExecuteTransition({
    tx,
    txId,
    transition,
    expectedFieldId,
    expectedFieldLabel,
    expectedPriceMicrocredits,
    expectedPriceLabel,
    walletAddressHint,
    anonymousSubjectId,
  });
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

const stripVisibilitySuffix = (value: string): string => value.trim().replace(/\.(public|private)$/i, "");

const normalizeFieldLiteral = (value: string): string => stripVisibilitySuffix(value).replace(/field$/i, "");

const parseUnsignedLiteral = (value: string, suffix: "u8" | "u32" | "u64"): number => {
  const normalized = stripVisibilitySuffix(value);
  const match = new RegExp(`^(\\d+)${suffix}$`, "i").exec(normalized);
  if (!match) {
    throw new Error(`Expected ${suffix} literal, received "${value}"`);
  }

  return Number.parseInt(match[1], 10);
};

const parseBooleanLiteral = (value: string): boolean => {
  const normalized = stripVisibilitySuffix(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Expected boolean literal, received "${value}"`);
};

const stringifyTransitionValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }

  return String(value ?? "");
};

const extractTransitionIoValues = (ioEntries: unknown[]): string[] => {
  return ioEntries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return { type: "", value: stringifyTransitionValue(entry) };
      }

      const io = entry as { type?: unknown; value?: unknown };
      return {
        type: typeof io.type === "string" ? io.type : "",
        value: stringifyTransitionValue(io.value ?? entry),
      };
    })
    .filter((entry) => entry.type.toLowerCase().includes("public"))
    .map((entry) => entry.value);
};

const computeSubscriptionProofNullifier = (
  ownerAddress: string,
  circleId: string,
  expiresAtBlock: number,
): string => sha256Hex(`${ownerAddress.trim().toLowerCase()}:${circleId.trim()}:${expiresAtBlock}`);

type AleoProofSdkModule = {
  AleoNetworkClient: new (host: string) => {
    getProgram: (programId: string) => Promise<string>;
    getDeploymentTransactionForProgram?: (programId: string) => Promise<unknown>;
  };
  Execution: {
    fromString: (value: string) => {
      transitions: () => unknown[];
    };
  };
  Program: {
    fromString: (value: string) => unknown;
  };
  VerifyingKey: {
    fromString: (value: string) => unknown;
  };
  verifyFunctionExecution: (
    execution: unknown,
    verifyingKey: unknown,
    program: unknown,
    functionId: string,
  ) => boolean;
};

const loadAleoProofSdk = async (): Promise<AleoProofSdkModule> => {
  return (await import("@provablehq/sdk/testnet.js")) as AleoProofSdkModule;
};

const parseLatestBlockHeight = (value: unknown, depth = 0): number | undefined => {
  if (depth > 6 || value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === "bigint") {
    return value >= 0n ? Number(value) : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const rawNumber = Number.parseInt(trimmed, 10);
    if (Number.isFinite(rawNumber) && /^\d+$/.test(trimmed)) {
      return rawNumber;
    }

    const literalMatch = trimmed.match(/(\d+)/);
    if (literalMatch) {
      return Number.parseInt(literalMatch[1], 10);
    }

    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseLatestBlockHeight(item, depth + 1);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const parsed = parseLatestBlockHeight(nested, depth + 1);
      if (parsed !== undefined) return parsed;
    }
  }

  return undefined;
};

const fetchExplorerLatestBlockHeight = async (): Promise<number> => {
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const url = `${base}/${env.aleoNetwork}/block/height/latest`;
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain" },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExplorerRequestError(response.status, `Explorer latest block fetch failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  const height = parseLatestBlockHeight(payload);
  if (height === undefined) {
    throw new Error("Explorer returned an invalid latest block height.");
  }

  return height;
};

const findVerifyingKeyInDeployment = (deploymentTx: unknown, functionName: string): string | undefined => {
  const deployment = (deploymentTx as { deployment?: unknown })?.deployment;
  const verifyingKeys = (deployment as { verifying_keys?: unknown })?.verifying_keys;

  if (Array.isArray(verifyingKeys)) {
    for (const entry of verifyingKeys) {
      if (
        Array.isArray(entry) &&
        entry.length >= 2 &&
        typeof entry[0] === "string" &&
        entry[0] === functionName &&
        Array.isArray(entry[1]) &&
        typeof entry[1][1] === "string"
      ) {
        return entry[1][1];
      }
    }
  }

  if (verifyingKeys && typeof verifyingKeys === "object") {
    const nested = (verifyingKeys as Record<string, unknown>)[functionName];
    if (Array.isArray(nested) && typeof nested[1] === "string") {
      return nested[1];
    }
  }

  return undefined;
};

/**
 * Verifies a locally generated Aleo execution proof for a subscription invoice.
 * The proof binds the circle and tier without sending the private invoice record to the backend.
 * The client still includes expiresAt from the locally cached invoice receipt because verify_subscription no longer exposes it publicly.
 */
export const verifyZKProof = async (
  input: ZkExecutionProofInput,
): Promise<VerifiedZkSubscriptionProof> => {
  if (input.programId !== env.paymentProofProgramId) {
    throw new Error(`Unexpected proof program. Expected "${env.paymentProofProgramId}".`);
  }

  if (input.transitionName !== "verify_subscription") {
    throw new Error('Unexpected proof transition. Expected "verify_subscription".');
  }

  const circleFromPayload = input.publicInputs.circleId?.trim();
  const expiresAtFromPayload = input.publicInputs.expiresAt;
  const tierFromPayload = input.publicInputs.tier;
  const latestBlockHeight = await fetchExplorerLatestBlockHeight();

  if (env.proofVerificationMode === "mock") {
    if (!circleFromPayload) {
      throw new Error("Mock ZK verification requires the circle public input.");
    }

    const expiresAtBlock = Number(expiresAtFromPayload ?? 0);
    const tier = Number(tierFromPayload ?? 1);

    if (expiresAtBlock <= latestBlockHeight) {
      throw new Error("Subscription invoice expired.");
    }

    return {
      verified: true,
      circleId: normalizeFieldLiteral(circleFromPayload),
      currentBlock: latestBlockHeight,
      expiresAtBlock,
      expiresAt: approximateExpiryDateFromBlockHeights(latestBlockHeight, expiresAtBlock),
      tier,
    };
  }

  const sdk = await loadAleoProofSdk();
  const execution = sdk.Execution.fromString(input.executionProof);
  const transitions = execution.transitions();
  if (!Array.isArray(transitions) || transitions.length !== 1) {
    throw new Error("Expected a single-transition execution proof.");
  }

  const transition = transitions[0] as {
    programId: () => string;
    functionName: () => string;
    inputs: (convertToJs: boolean) => unknown[];
    outputs: (convertToJs: boolean) => unknown[];
  };

  if (transition.programId() !== input.programId) {
    throw new Error(`Proof program mismatch. Expected "${input.programId}".`);
  }

  if (transition.functionName() !== input.transitionName) {
    throw new Error(`Proof transition mismatch. Expected "${input.transitionName}".`);
  }

  let verifyingKey = input.verifyingKey?.trim();
  let programSource = input.programSource?.trim();

  if (!programSource || !verifyingKey) {
    const networkClient = new sdk.AleoNetworkClient(env.aleoEndpoint);
    if (!programSource) {
      programSource = (await networkClient.getProgram(input.programId)).trim();
    }

    if (!verifyingKey && typeof networkClient.getDeploymentTransactionForProgram === "function") {
      const deploymentTx = await networkClient.getDeploymentTransactionForProgram(input.programId);
      verifyingKey = findVerifyingKeyInDeployment(deploymentTx, input.transitionName);
    }
  }

  if (!programSource) {
    throw new Error("Missing Aleo program source for proof verification.");
  }

  if (!verifyingKey) {
    throw new Error("Missing verifying key for proof verification.");
  }

  const verified = sdk.verifyFunctionExecution(
    execution,
    sdk.VerifyingKey.fromString(verifyingKey),
    sdk.Program.fromString(programSource),
    input.transitionName,
  );

  if (!verified) {
    throw new Error("Execution proof failed Aleo verification.");
  }

  const publicInputs = extractTransitionIoValues(transition.inputs(true));
  const publicOutputs = extractTransitionIoValues(transition.outputs(true));

  if (publicInputs.length < 2) {
    throw new Error("Subscription proof did not expose the expected public inputs.");
  }

  const circleId = normalizeFieldLiteral(publicInputs[0]);
  const tier = parseUnsignedLiteral(publicInputs[1], "u8");
  const expiresAtBlock = Number(expiresAtFromPayload ?? 0);

  if (publicOutputs.length < 1 || !parseBooleanLiteral(publicOutputs[0])) {
    throw new Error("Subscription proof did not return a successful verification output.");
  }

  if (circleFromPayload && normalizeFieldLiteral(circleFromPayload) !== circleId) {
    throw new Error("Proof circle public input mismatch.");
  }

  if (typeof expiresAtFromPayload !== "number" || !Number.isFinite(expiresAtBlock) || expiresAtBlock <= 0) {
    throw new Error("Subscription proof is missing the invoice expiry metadata.");
  }

  if (typeof tierFromPayload === "number" && tierFromPayload !== tier) {
    throw new Error("Proof tier public input mismatch.");
  }

  if (expiresAtBlock <= latestBlockHeight) {
    throw new Error("Subscription invoice expired.");
  }

  return {
    verified: true,
    circleId,
    currentBlock: latestBlockHeight,
    expiresAtBlock,
    expiresAt: approximateExpiryDateFromBlockHeights(latestBlockHeight, expiresAtBlock),
    tier,
  };
};

export { computeSubscriptionProofNullifier };

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

  const currentSubscriptionPaymentFunctions = [
    "pay_and_subscribe",
    "pay_and_subscribe_public",
    "pay_and_subscribe_usdcx",
    "pay_and_subscribe_usdcx_public",
  ];
  const legacySubscriptionPaymentFunctions = ["pay_and_subscribe", "pay_and_subscribe_v2"];
  const supportedSubscriptionFunctions = new Set([
    ...currentSubscriptionPaymentFunctions,
    ...legacySubscriptionPaymentFunctions,
    "verify_subscription",
  ]);

  if (input.functionName && !supportedSubscriptionFunctions.has(input.functionName)) {
    throw new Error(`Unsupported transition "${input.functionName}"`);
  }

  const currentCandidates = input.functionName
    ? currentSubscriptionPaymentFunctions.filter((entry) => entry === input.functionName)
    : currentSubscriptionPaymentFunctions;
  const legacyCandidates = input.functionName
    ? legacySubscriptionPaymentFunctions.filter((entry) => entry === input.functionName)
    : legacySubscriptionPaymentFunctions;
  const allowVerifySubscription = !input.functionName || input.functionName === "verify_subscription";

  const tx = await fetchExplorerTx(input.purchaseTxId);
  if (!isExecuteTx(tx)) {
    throw new Error(`Expected execute tx, got ${String((tx as { type?: unknown }).type)}`);
  }

  const currentTransition = tx.execution.transitions.find(
    (transition) =>
      transition.program === env.paymentProofProgramId &&
      currentCandidates.includes(transition.function),
  );
  if (currentTransition) {
    const verified = verifyMatchedExecuteTransition({
      tx,
      txId: input.purchaseTxId,
      transition: currentTransition,
      expectedFieldId: input.creatorFieldId,
      expectedFieldLabel: "creatorId",
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      expectedPriceLabel: "subscriptionPriceMicrocredits",
      walletAddressHint: input.walletAddressHint,
    });

    return {
      walletHash: verified.walletHash,
      resourceFieldId: input.creatorFieldId,
      provedByTxId: input.purchaseTxId,
    };
  }

  if (allowVerifySubscription) {
    const verifyTransition = tx.execution.transitions.find(
      (transition) =>
        transition.program === env.paymentProofProgramId &&
        transition.function === "verify_subscription",
    );

    if (verifyTransition) {
      const verified = verifyMatchedExecuteTransition({
        tx,
        txId: input.purchaseTxId,
        transition: verifyTransition,
        expectedFieldId: input.creatorFieldId,
        expectedFieldLabel: "circleId",
        walletAddressHint: input.walletAddressHint,
        expectedTier: typeof input.expectedPriceMicrocredits === "bigint"
          ? tierFromPriceMicrocredits(input.expectedPriceMicrocredits)
          : undefined,
      });

      return {
        walletHash: verified.walletHash,
        resourceFieldId: input.creatorFieldId,
        provedByTxId: input.purchaseTxId,
      };
    }
  }

  const legacyTransition = tx.execution.transitions.find(
    (transition) =>
      transition.program === env.subscriptionProgramId &&
      legacyCandidates.includes(transition.function),
  );
  if (legacyTransition) {
    const verified = verifyMatchedExecuteTransition({
      tx,
      txId: input.purchaseTxId,
      transition: legacyTransition,
      expectedFieldId: input.creatorFieldId,
      expectedFieldLabel: "creatorId",
      expectedPriceMicrocredits: input.expectedPriceMicrocredits,
      expectedPriceLabel: "subscriptionPriceMicrocredits",
      walletAddressHint: input.walletAddressHint,
    });

    return {
      walletHash: verified.walletHash,
      resourceFieldId: input.creatorFieldId,
      provedByTxId: input.purchaseTxId,
    };
  }

  if (!input.expectedRecipientAddress) {
    const foundTransitions = tx.execution.transitions.map(
      (transition) => `${transition.program}/${transition.function}`,
    );
    throw new Error(
      `No supported subscription transition found in transaction ${input.purchaseTxId}. ` +
      `Found transitions: ${foundTransitions.join(", ") || "none"}`,
    );
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
      walletHash: subjectHash(`${env.tipProgramId}:prove_tip_v2:${input.txId ?? input.creatorFieldId}`),
      resourceFieldId: input.creatorFieldId,
      provedByTxId: input.txId,
    };
  }

  if (!input.txId) {
    throw new Error("Missing txId. Expected an on-chain execute tx calling prove_tip_v2.");
  }

  const tx = await fetchExplorerTx(input.txId);
  const proofTransition =
    findTransition(tx, env.tipProgramId, "prove_tip_v2") ??
    findTransition(tx, env.tipProgramId, "prove_tip");

  if (proofTransition) {
    if (!txAppearsAccepted(tx)) {
      throw new Error(`Transaction ${input.txId} is not accepted yet`);
    }

    const publicInputs = publicInputsFromTransition(proofTransition);
    assertIncludesLiteral(publicInputs, toFieldLiteral(input.creatorFieldId), `${proofTransition.function} public creatorId`);
    assertIncludesLiteral(publicInputs, toU64Literal(input.amountMicrocredits), `${proofTransition.function} public amount`);

    return {
      walletHash: subjectHash(`${env.tipProgramId}:${proofTransition.function}:${input.txId}`),
      resourceFieldId: input.creatorFieldId,
      provedByTxId: input.txId,
    };
  }

  if (findTransition(tx, env.tipProgramId, "tip_private_v3")) {
    throw new Error("tip_private_v3 payment tx is private. Submit the prove_tip_v2 txId for backend verification.");
  }

  const legacyTransition =
    findTransition(tx, env.tipProgramId, "tip_private") ??
    findTransition(tx, env.tipProgramId, "tip_private_v2");
  if (!legacyTransition) {
    throw new Error("prove_tip_v2 or legacy tip_private transition not found in transaction");
  }

  if (!txAppearsAccepted(tx)) {
    throw new Error(`Transaction ${input.txId} is not accepted yet`);
  }

  const publicInputs = publicInputsFromTransition(legacyTransition);
  assertIncludesLiteral(publicInputs, toFieldLiteral(input.creatorFieldId), `${legacyTransition.function} public creatorId`);
  assertIncludesLiteral(publicInputs, input.creatorAddress, `${legacyTransition.function} public creatorAddress`);
  assertIncludesLiteral(publicInputs, toU64Literal(input.amountMicrocredits), `${legacyTransition.function} public amount`);

  return {
    walletHash: subjectHash(`${env.tipProgramId}:${legacyTransition.function}:${input.txId}`),
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
    throw new Error("Missing purchaseTxId. Expected an on-chain credits.aleo direct transfer.");
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
