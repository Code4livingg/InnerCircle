import { Network, type TransactionOptions } from "@provablehq/aleo-types";
import type { WalletContextState } from "@/lib/walletContext";
import { fetchPublicBalance } from "./api";

const MICROCREDITS_PER_ALEO = 1_000_000n;
const DEFAULT_EXECUTION_FEE_ALEO = 0.25;
const ALEO_EXPLORER_API =
  process.env.NEXT_PUBLIC_ALEO_EXPLORER_API?.trim() || "https://api.explorer.provable.com/v1";
const ALEO_EXPLORER_NETWORK = "testnet";
const TIP_PROGRAM_ID = process.env.NEXT_PUBLIC_TIP_PROGRAM_ID?.trim() || "tip_pay_v5_xwnxp.aleo";
const PAYMENT_PROOF_PROGRAM_ID =
  process.env.NEXT_PUBLIC_PAYMENT_PROOF_PROGRAM_ID?.trim() || "sub_invoice_v8_xwnxp.aleo";
const SUBSCRIPTION_PROGRAM_ID =
  process.env.NEXT_PUBLIC_SUBSCRIPTION_PROGRAM_ID?.trim() || "sub_pay_v6_xwnxp.aleo";

interface TransactionResult {
  transactionId?: string;
}

interface ShieldAdapterTransactionOptions {
  programId: string;
  functionName: string;
  inputs: string[];
  fee?: string;
  privateFee?: boolean;
  recordIndices?: number[];
}

type CompatibleTransactionOptions = TransactionOptions | ShieldAdapterTransactionOptions;

interface RequestTransactionLike {
  requestTransaction?: (options: CompatibleTransactionOptions) => Promise<TransactionResult | undefined>;
}

interface ShieldRawExecutionRequestData {
  programId: string;
  functionName: string;
  inputs: string[];
  fee?: string;
  privateFee?: true;
}

interface LegacyRawExecutionRequestData {
  address: string;
  chainId: string;
  fee: number;
  feePrivate: boolean;
  recordIndices?: number[];
  transitions: Array<{
    program: string;
    functionName: string;
    inputs: string[];
  }>;
}

interface RequestExecutionLike {
  requestTransaction?: (
    requestData: LegacyRawExecutionRequestData | ShieldRawExecutionRequestData,
  ) => Promise<TransactionResult | undefined>;
  requestExecution?: (
    requestData: LegacyRawExecutionRequestData | ShieldRawExecutionRequestData,
  ) => Promise<TransactionResult | undefined>;
}

interface ExecutionReaderLike {
  getExecution?: (transactionId: string) => Promise<unknown>;
}

interface TransactionHistoryLike {
  requestTransactionHistory?: (program: string) => Promise<unknown>;
}

interface TransactionStatusLike {
  transactionStatus?: (transactionId: string) => Promise<unknown>;
}

interface WalletExecutionResult {
  accepted: boolean;
  chainTxId?: string;
  lastStatus?: string;
}

interface WalletHistoryRecord {
  id?: string;
  transactionId?: string;
  requestId?: string;
  ids: string[];
}

const getTransactionProgramId = (tx: CompatibleTransactionOptions): string =>
  "programId" in tx && typeof tx.programId === "string" && tx.programId.trim().length > 0
    ? tx.programId
    : "program" in tx && typeof tx.program === "string"
      ? tx.program
      : "";

const getTransactionFunctionName = (tx: CompatibleTransactionOptions): string =>
  "functionName" in tx && typeof tx.functionName === "string" && tx.functionName.trim().length > 0
    ? tx.functionName
    : "function" in tx && typeof tx.function === "string"
      ? tx.function
      : "";

const parseFeeLiteral = (fee: string): number | undefined => {
  const match = fee.trim().match(/^(\d+)u64$/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const toNumericTransactionFee = (fee: CompatibleTransactionOptions["fee"]): number | undefined => {
  if (typeof fee === "number" && Number.isFinite(fee) && fee > 0) {
    return fee;
  }
  if (typeof fee === "string") {
    return parseFeeLiteral(fee);
  }
  return undefined;
};

const toShieldFeeLiteral = (fee: CompatibleTransactionOptions["fee"]): string | undefined => {
  if (typeof fee === "string") {
    return /^(\d+)u64$/i.test(fee.trim()) ? fee.trim() : undefined;
  }
  if (typeof fee === "number" && Number.isFinite(fee) && Number.isInteger(fee) && fee > 0) {
    return `${fee}u64`;
  }
  return undefined;
};

const toLegacyTransactionOptions = (tx: CompatibleTransactionOptions): TransactionOptions => ({
  program: getTransactionProgramId(tx),
  function: getTransactionFunctionName(tx),
  inputs: [...tx.inputs],
  ...(typeof toNumericTransactionFee(tx.fee) === "number" ? { fee: toNumericTransactionFee(tx.fee) } : {}),
  ...(typeof tx.privateFee === "boolean" ? { privateFee: tx.privateFee } : {}),
  ...(Array.isArray(tx.recordIndices) && tx.recordIndices.length > 0 ? { recordIndices: tx.recordIndices } : {}),
});

const toShieldTransactionOptions = (tx: CompatibleTransactionOptions): ShieldAdapterTransactionOptions => ({
  programId: getTransactionProgramId(tx),
  functionName: getTransactionFunctionName(tx),
  inputs: [...tx.inputs],
  ...(typeof toShieldFeeLiteral(tx.fee) === "string" ? { fee: toShieldFeeLiteral(tx.fee) } : {}),
  ...(typeof tx.privateFee === "boolean" ? { privateFee: tx.privateFee } : {}),
  ...(Array.isArray(tx.recordIndices) && tx.recordIndices.length > 0 ? { recordIndices: tx.recordIndices } : {}),
});

const pickAnyOnChainTxId = (txs: WalletHistoryRecord[]): string | undefined => {
  for (const tx of txs) {
    for (const id of tx.ids) {
      if (isOnChainAleoTxId(id)) {
        return id;
      }
    }
    if (tx.transactionId && isOnChainAleoTxId(tx.transactionId)) {
      return tx.transactionId;
    }
    if (tx.id && isOnChainAleoTxId(tx.id)) {
      return tx.id;
    }
  }

  return undefined;
};

const getTransactionId = (result: unknown): string | undefined => {
  if (!result || typeof result !== "object") return undefined;

  const keys = [
    "transactionId",
    "transaction_id",
    "txId",
    "txid",
    "id",
    "eventId",
    "event_id",
    "hash",
    "txHash",
    "transactionHash",
  ];
  const root = result as Record<string, unknown>;

  for (const key of keys) {
    const value = root[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  for (const nestedKey of ["transaction", "result", "data", "payload"]) {
    const nested = root[nestedKey];
    if (!nested || typeof nested !== "object") continue;
    for (const key of keys) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  return undefined;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseConfiguredFeeAleo = (): number => {
  const raw =
    process.env.NEXT_PUBLIC_EXECUTION_FEE_ALEO ??
    process.env.NEXT_PUBLIC_TRANSACTION_FEE_ALEO;
  if (!raw) return DEFAULT_EXECUTION_FEE_ALEO;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXECUTION_FEE_ALEO;
  }
  return parsed;
};

const EXECUTION_FEE_ALEO = parseConfiguredFeeAleo();

const parseLatestBlockHeight = (value: unknown, depth = 0): bigint | undefined => {
  if (depth > 4 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return BigInt(trimmed);
    }
    return undefined;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    return undefined;
  }

  if (typeof value === "bigint") {
    return value >= 0n ? value : undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["height", "blockHeight", "block_height", "latestHeight", "latest_block_height"]) {
      const parsed = parseLatestBlockHeight(record[key], depth + 1);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return undefined;
};

const aleoToMicrocredits = (aleoAmount: number): bigint =>
  BigInt(Math.round(aleoAmount * Number(MICROCREDITS_PER_ALEO)));

const microcreditsToAleoString = (amount: bigint): string => {
  const whole = amount / MICROCREDITS_PER_ALEO;
  const fractional = (amount % MICROCREDITS_PER_ALEO).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional.length ? `${whole.toString()}.${fractional}` : whole.toString();
};

const MICROCREDIT_KEY_HINTS = new Set([
  "value",
  "plaintext",
  "microcredits",
  "balance",
  "amount",
  "account",
]);

const parseMicrocreditsValue = (
  value: unknown,
  depth = 0,
  keyHint?: string,
): bigint | undefined => {
  if (depth > 8 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const withU64 = /^([0-9]+)u64$/i.exec(trimmed);
    if (withU64) return BigInt(withU64[1]);

    if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);

    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return undefined;
    return BigInt(value);
  }

  if (typeof value === "bigint") {
    return value >= 0n ? value : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseMicrocreditsValue(item, depth + 1, keyHint);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    for (const [key, nested] of entries) {
      if (!MICROCREDIT_KEY_HINTS.has(key.toLowerCase())) continue;
      const parsed = parseMicrocreditsValue(nested, depth + 1, key);
      if (parsed !== undefined) return parsed;
    }

    // Some explorer responses wrap the literal under a single dynamic key.
    if (entries.length === 1) {
      const [key, nested] = entries[0];
      const parsed = parseMicrocreditsValue(nested, depth + 1, key);
      if (parsed !== undefined) return parsed;
    }
  }

  return undefined;
};

const parseMicrocreditsLiteral = (value: string): bigint | undefined => {
  const normalized = value.trim().replace(/\.(private|public)$/i, "").replace(/_/g, "");
  const withU64 = /^([0-9]+)u64$/i.exec(normalized);
  if (withU64) return BigInt(withU64[1]);
  if (/^[0-9]+$/.test(normalized)) return BigInt(normalized);
  return undefined;
};

const parseMicrocreditsFromRecordLiteral = (literal: string): bigint | undefined => {
  const match = literal.match(/microcredits:\s*([0-9_]+u64(?:\.(?:private|public))?)/i);
  return match ? parseMicrocreditsLiteral(match[1]) : undefined;
};

const findNestedFieldValue = (
  value: unknown,
  fieldName: string,
  depth = 0,
): unknown => {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedFieldValue(item, fieldName, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      if (key.toLowerCase() === fieldName.toLowerCase()) {
        return nested;
      }
    }
    for (const nested of Object.values(record)) {
      const found = findNestedFieldValue(nested, fieldName, depth + 1);
      if (found !== undefined) return found;
    }
  }

  return undefined;
};

const parsePrivateCreditsBalance = (
  record: unknown,
  literal?: string,
): bigint | undefined => {
  if (typeof literal === "string") {
    const parsedFromLiteral = parseMicrocreditsFromRecordLiteral(literal);
    if (parsedFromLiteral !== undefined) {
      return parsedFromLiteral;
    }
  }

  const nestedMicrocredits = findNestedFieldValue(record, "microcredits");
  if (typeof nestedMicrocredits === "string") {
    return parseMicrocreditsLiteral(nestedMicrocredits);
  }
  if (typeof nestedMicrocredits === "number" || typeof nestedMicrocredits === "bigint") {
    return parseMicrocreditsValue(nestedMicrocredits);
  }

  return undefined;
};

const findNestedString = (
  value: unknown,
  predicate: (candidate: string) => boolean,
  depth = 0,
): string | undefined => {
  if (depth > 8 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && predicate(trimmed) ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedString(item, predicate, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findNestedString(nested, predicate, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
};

const looksLikeRecordLiteral = (value: string): boolean =>
  /\{\s*owner:\s*aleo1/i.test(value) ||
  /owner:\s*aleo1/i.test(value);

const extractRecordLiteral = (record: unknown): string | undefined => {
  if (typeof record === "string") {
    return record.trim();
  }

  if (!record || typeof record !== "object") {
    return undefined;
  }

  const obj = record as Record<string, unknown>;
  const preferredKeys = [
    "plaintext",
    "recordPlaintext",
    "plaintextRecord",
    "record",
    "value",
    "data",
    "recordString",
    "ciphertext",
  ];

  for (const key of preferredKeys) {
    if (!(key in obj)) continue;
    const found = findNestedString(obj[key], looksLikeRecordLiteral, 1);
    if (found) return found;
  }

  return findNestedString(record, looksLikeRecordLiteral, 1);
};

const normalizeAleoLiteral = (value: string): string =>
  value.trim().replace(/\.(private|public)$/i, "").replace(/_/g, "");

const parseFieldLiteralValue = (value: string): string | undefined => {
  const match = /^([0-9]+)field$/i.exec(normalizeAleoLiteral(value));
  return match ? match[1] : undefined;
};

const parseU64LiteralValue = (value: string): bigint | undefined => {
  const match = /^([0-9]+)u64$/i.exec(normalizeAleoLiteral(value));
  return match ? BigInt(match[1]) : undefined;
};

const isRecordSpent = (record: unknown): boolean => {
  if (!record || typeof record !== "object") return false;
  const value = record as Record<string, unknown>;

  const direct = value.spent;
  if (typeof direct === "boolean") return direct;
  if (typeof direct === "string") return direct.trim().toLowerCase() === "true";

  const nestedStatus = value.status;
  if (typeof nestedStatus === "string" && /spent/i.test(nestedStatus)) return true;

  return false;
};

const fetchProgramRecords = async (
  wallet: WalletContextState,
  programId: string,
): Promise<unknown[]> => {
  if (typeof wallet.requestProgramRecords === "function") {
    const records = await wallet.requestProgramRecords(programId, true);
    return Array.isArray(records) ? records : [];
  }

  if (typeof wallet.requestRecordPlaintexts === "function") {
    const records = await wallet.requestRecordPlaintexts(programId);
    return Array.isArray(records) ? records : [];
  }

  throw new Error("Wallet does not support fetching private tip receipts.");
};

const parseTipReceiptCreatorId = (
  record: unknown,
  literal?: string,
): string | undefined => {
  if (typeof literal === "string") {
    const match = literal.match(/creator_id:\s*([0-9_]+field(?:\.(?:private|public))?)/i);
    if (match?.[1]) {
      return parseFieldLiteralValue(match[1]);
    }
  }

  const nested = findNestedFieldValue(record, "creator_id");
  if (typeof nested === "string") {
    return parseFieldLiteralValue(nested);
  }
  if (typeof nested === "number" && Number.isInteger(nested) && nested >= 0) {
    return String(nested);
  }
  if (typeof nested === "bigint" && nested >= 0n) {
    return nested.toString();
  }

  return undefined;
};

const parseTipReceiptAmount = (
  record: unknown,
  literal?: string,
): bigint | undefined => {
  if (typeof literal === "string") {
    const match = literal.match(/amount:\s*([0-9_]+u64(?:\.(?:private|public))?)/i);
    if (match?.[1]) {
      return parseU64LiteralValue(match[1]);
    }
  }

  const nested = findNestedFieldValue(record, "amount");
  if (typeof nested === "string") {
    return parseU64LiteralValue(nested) ?? parseMicrocreditsValue(nested);
  }
  if (typeof nested === "number" || typeof nested === "bigint") {
    return parseMicrocreditsValue(nested);
  }

  return undefined;
};

const recoverTipReceiptRecord = async (
  wallet: WalletContextState,
  tipProgramId: string,
  creatorFieldId: string,
  amountMicrocredits: bigint,
  options?: { attempts?: number; delayMs?: number },
): Promise<{ literal: string; index?: number }> => {
  const attempts = options?.attempts ?? 45;
  const delayMs = options?.delayMs ?? 2_000;
  const normalizedCreatorFieldId = creatorFieldId.trim().replace(/field$/i, "");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const records = await fetchProgramRecords(wallet, tipProgramId);

    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (isRecordSpent(record)) {
        continue;
      }

      const literal = extractRecordLiteral(record);
      if (!literal) {
        continue;
      }

      const recordCreatorId = parseTipReceiptCreatorId(record, literal);
      const recordAmount = parseTipReceiptAmount(record, literal);
      if (
        recordCreatorId === normalizedCreatorFieldId &&
        typeof recordAmount === "bigint" &&
        recordAmount === amountMicrocredits
      ) {
        return { literal, index };
      }
    }

    if (attempt < attempts - 1) {
      await wait(delayMs);
    }
  }

  throw new Error(
    "Tip payment succeeded on-chain, but the wallet has not exposed the private TipReceipt yet. Wait for wallet sync, then retry verification without sending a second tip.",
  );
};

const pickPrivateCreditsRecord = async (
  wallet: WalletContextState,
  minMicrocredits: bigint,
): Promise<{ literal: string; index?: number; balance?: bigint }> => {
  if (typeof wallet.requestRecordPlaintexts !== "function") {
    throw new Error("Wallet does not support private record access for anonymous tips.");
  }

  const records = await wallet.requestRecordPlaintexts("credits.aleo");
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("No private credits records found. You need private balance for anonymous tips.");
  }

  const candidates: Array<{ literal: string; index: number; balance: bigint }> = [];

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const literal = extractRecordLiteral(record);
    const balance = parsePrivateCreditsBalance(record, literal);

    if (literal && typeof balance === "bigint" && balance >= minMicrocredits) {
      candidates.push({ literal, index: i, balance });
    }
  }

  candidates.sort((left, right) => {
    if (left.balance === right.balance) {
      return left.index - right.index;
    }
    return right.balance > left.balance ? 1 : -1;
  });

  if (candidates.length > 0) {
    return candidates[0];
  }

  throw new Error("No private credits record large enough for this tip amount.");
};

const fetchExplorerPublicBalanceMicrocredits = async (address: string): Promise<bigint | undefined> => {
  if (!address || !address.startsWith("aleo1")) {
    return undefined;
  }

  const base = `${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/program/credits.aleo/mapping/account`;
  const urls = [
    `${base}/${address}`,
    `${base}/${encodeURIComponent(address)}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload: unknown = await response.json();
        const parsed = parseMicrocreditsValue(payload);
        if (parsed !== undefined) return parsed;
      } else {
        const payload = await response.text();
        const parsed = parseMicrocreditsValue(payload);
        if (parsed !== undefined) return parsed;
      }
    } catch {
      // Best effort only; wallet execution can still proceed if explorer lookup fails.
    }
  }

  return undefined;
};

export const fetchKnownPublicBalanceMicrocredits = async (
  address: string,
): Promise<bigint | undefined> => {
  if (!address || !address.startsWith("aleo1")) return undefined;

  try {
    const result = await fetchPublicBalance(address);
    return BigInt(result.publicBalanceMicrocredits);
  } catch {
    // Backend lookup can fail transiently (startup/explorer hiccup); try direct explorer as fallback.
    return await fetchExplorerPublicBalanceMicrocredits(address);
  }
};

const isRetryablePayloadFormatError = (error: unknown): boolean => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  return /invalid transaction payload|shield rejected the transaction payload|rejected the transaction payload|invalid aleo program|invalid_params|failed to parse input|failed to parse input #\d+ \\(u64\\.public\\)|invalid payload|could not create transaction/.test(
    message,
  );
};

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isOnChainAleoTxId(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^at1[0-9a-z]{20,}$/i.test(value.trim());
}

const isTemporaryWalletTxId = (value: string | null | undefined): boolean =>
  !!value && !isOnChainAleoTxId(value);

function isUserRejectedError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return /reject|denied|cancel|declined|not granted|user/i.test(message);
}

function isExtensionCrashedError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return /receiving end does not exist|could not establish connection|extension context invalidated|no response/i.test(message);
}

const isNoSelectedAccountError = (error: unknown): boolean => {
  const message = (error as Error)?.message ?? "";
  return /no selected account/i.test(message);
};

const noSelectedAccountMessage = (): string =>
  "No selected account in wallet. Open your wallet extension, select an account, reconnect, then retry.";

export const toFieldLiteral = (value: string): string => (value.endsWith("field") ? value : `${value}field`);

export const toFieldFromInteger = (value: bigint): string => `${value.toString()}field`;

const isFieldLiteral = (value: string): boolean => /^\d+field$/i.test(value.trim());

const isU64Literal = (value: string): boolean => /^\d+u64$/i.test(value.trim());

export const toU64Literal = (microcredits: string | number | bigint | null | undefined): string => {
  if (microcredits === null || microcredits === undefined || microcredits === "") {
    return "0u64";
  }

  let numericValue: bigint;
  if (typeof microcredits === "bigint") {
    numericValue = microcredits;
  } else if (typeof microcredits === "number") {
    if (!Number.isFinite(microcredits) || !Number.isInteger(microcredits) || !Number.isSafeInteger(microcredits)) {
      throw new Error("Microcredits number must be a safe integer.");
    }
    numericValue = BigInt(microcredits);
  } else {
    numericValue = BigInt(microcredits);
  }

  if (numericValue < 0n) {
    throw new Error("Microcredits must be non-negative.");
  }

  return `${numericValue}u64`;
};

export const fetchLatestBlockHeight = async (): Promise<bigint> => {
  const response = await fetch(`${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/block/height/latest`);
  if (!response.ok) {
    throw new Error("Failed to fetch latest Aleo block height.");
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

export const fetchLatestBlockHeightField = async (): Promise<string> =>
  toFieldFromInteger(await fetchLatestBlockHeight());

const isAleoRecordInput = (value: string): boolean =>
  /^record1[0-9a-z]+$/i.test(value) || (value.includes("owner:") && value.includes("microcredits:"));

const isLegacySubscriptionInvoiceProgram = (programId: string): boolean =>
  /^sub_invoice_v2_xwnxp\.aleo$/i.test(programId.trim());

const validateLiteralInputs = (programId: string, functionName: string, inputs: string[]): void => {
  const normalized = inputs.map((value) => value.trim());

  for (const value of normalized) {
    if (!value || /undefined|null|nan/i.test(value)) {
      throw new Error(`Invalid ${functionName} input literal: ${value || "(empty)"}`);
    }
  }

  if (functionName === "pay_and_subscribe") {
    if (isLegacySubscriptionInvoiceProgram(programId)) {
      if (normalized.length !== 4) {
        throw new Error(`pay_and_subscribe expects 4 inputs, received ${normalized.length}.`);
      }
      if (!isAleoRecordInput(normalized[0])) {
        throw new Error("pay_and_subscribe private payment record is missing or malformed.");
      }
      if (!isFieldLiteral(normalized[1])) {
        throw new Error(`pay_and_subscribe circle_id must be a field literal, got "${normalized[1]}".`);
      }
      if (!isU64Literal(normalized[2])) {
        throw new Error(`pay_and_subscribe amount must be a u64 literal, got "${normalized[2]}".`);
      }
      if (!/^(\d+)u32$/i.test(normalized[3])) {
        throw new Error(`pay_and_subscribe expiry block must be a u32 literal, got "${normalized[3]}".`);
      }
      return;
    }
    if (normalized.length !== 6) {
      throw new Error(`pay_and_subscribe expects 6 inputs, received ${normalized.length}.`);
    }
    if (!isAleoRecordInput(normalized[0])) {
      throw new Error("pay_and_subscribe private payment record is missing or malformed.");
    }
    if (!isFieldLiteral(normalized[1])) {
      throw new Error(`pay_and_subscribe circle_id must be a field literal, got "${normalized[1]}".`);
    }
    if (!isU64Literal(normalized[2])) {
      throw new Error(`pay_and_subscribe amount must be a u64 literal, got "${normalized[2]}".`);
    }
    if (!/^(\d+)u32$/i.test(normalized[3])) {
      throw new Error(`pay_and_subscribe expiry block must be a u32 literal, got "${normalized[3]}".`);
    }
    if (!isFieldLiteral(normalized[4])) {
      throw new Error(`pay_and_subscribe salt must be a field literal, got "${normalized[4]}".`);
    }
    if (!/^aleo1[0-9a-z]+$/i.test(normalized[5])) {
      throw new Error(`pay_and_subscribe creator_address must be an aleo1 address, got "${normalized[5]}".`);
    }
    return;
  }

  if (functionName === "pay_and_subscribe_v2") {
    if (normalized.length !== 4) {
      throw new Error(`pay_and_subscribe_v2 expects 4 inputs, received ${normalized.length}.`);
    }
    if (!isFieldLiteral(normalized[0])) {
      throw new Error(`pay_and_subscribe_v2 creator_id must be a field literal, got "${normalized[0]}".`);
    }
    if (!/^aleo1[0-9a-z]+$/i.test(normalized[1])) {
      throw new Error(`pay_and_subscribe_v2 creator_address must be an aleo1 address, got "${normalized[1]}".`);
    }
    if (!isU64Literal(normalized[2])) {
      throw new Error(`pay_and_subscribe_v2 amount must be a u64 literal, got "${normalized[2]}".`);
    }
    if (!isFieldLiteral(normalized[3])) {
      throw new Error(`pay_and_subscribe_v2 expiry must be a field literal, got "${normalized[3]}".`);
    }
  }

  if (functionName === "pay_and_subscribe_public") {
    if (isLegacySubscriptionInvoiceProgram(programId)) {
      if (normalized.length !== 3) {
        throw new Error(`pay_and_subscribe_public expects 3 inputs, received ${normalized.length}.`);
      }
      if (!isFieldLiteral(normalized[0])) {
        throw new Error(`pay_and_subscribe_public circle_id must be a field literal, got "${normalized[0]}".`);
      }
      if (!isU64Literal(normalized[1])) {
        throw new Error(`pay_and_subscribe_public amount must be a u64 literal, got "${normalized[1]}".`);
      }
      if (!/^(\d+)u32$/i.test(normalized[2])) {
        throw new Error(`pay_and_subscribe_public expiry block must be a u32 literal, got "${normalized[2]}".`);
      }
      return;
    }
    if (normalized.length !== 5) {
      throw new Error(`pay_and_subscribe_public expects 5 inputs, received ${normalized.length}.`);
    }
    if (!isFieldLiteral(normalized[0])) {
      throw new Error(`pay_and_subscribe_public circle_id must be a field literal, got "${normalized[0]}".`);
    }
    if (!isU64Literal(normalized[1])) {
      throw new Error(`pay_and_subscribe_public amount must be a u64 literal, got "${normalized[1]}".`);
    }
    if (!/^(\d+)u32$/i.test(normalized[2])) {
      throw new Error(`pay_and_subscribe_public expiry block must be a u32 literal, got "${normalized[2]}".`);
    }
    if (!isFieldLiteral(normalized[3])) {
      throw new Error(`pay_and_subscribe_public salt must be a field literal, got "${normalized[3]}".`);
    }
    if (!/^aleo1[0-9a-z]+$/i.test(normalized[4])) {
      throw new Error(`pay_and_subscribe_public creator_address must be an aleo1 address, got "${normalized[4]}".`);
    }
    return;
  }

  if (functionName === "prove_subscription_v2") {
    if (normalized.length !== 3) {
      throw new Error(`prove_subscription_v2 expects 3 inputs, received ${normalized.length}.`);
    }
    if (!isFieldLiteral(normalized[1])) {
      throw new Error(`prove_subscription_v2 creator_id must be a field literal, got "${normalized[1]}".`);
    }
    if (!isFieldLiteral(normalized[2])) {
      throw new Error(`prove_subscription_v2 current_height must be a field literal, got "${normalized[2]}".`);
    }
  }

  if (functionName === "transfer_public") {
    if (normalized.length !== 2) {
      throw new Error(`transfer_public expects 2 inputs, received ${normalized.length}.`);
    }
    if (!/^aleo1[0-9a-z]+$/i.test(normalized[0])) {
      throw new Error(`transfer_public recipient must be an aleo1 address, got "${normalized[0]}".`);
    }
    if (!isU64Literal(normalized[1])) {
      throw new Error(`transfer_public amount must be a u64 literal, got "${normalized[1]}".`);
    }
  }

  if (functionName === "transfer_private_to_public") {
    if (normalized.length !== 3) {
      throw new Error(`transfer_private_to_public expects 3 inputs, received ${normalized.length}.`);
    }
    if (!isAleoRecordInput(normalized[0])) {
      throw new Error("transfer_private_to_public private payment record is missing or malformed.");
    }
    if (!/^aleo1[0-9a-z]+$/i.test(normalized[1])) {
      throw new Error(`transfer_private_to_public recipient must be an aleo1 address, got "${normalized[1]}".`);
    }
    if (!isU64Literal(normalized[2])) {
      throw new Error(`transfer_private_to_public amount must be a u64 literal, got "${normalized[2]}".`);
    }
    return;
  }

};

const getWalletAdapterName = (wallet: WalletContextState): string =>
  String(wallet.wallet?.adapter?.name ?? "").trim().toLowerCase();

const isShieldWallet = (wallet: WalletContextState): boolean =>
  getWalletAdapterName(wallet).includes("shield");

const isPuzzleWallet = (wallet: WalletContextState): boolean =>
  getWalletAdapterName(wallet).includes("puzzle");

const isLeoWallet = (wallet: WalletContextState): boolean =>
  getWalletAdapterName(wallet).includes("leo");

const assertNoManualRecordForPublicExecution = (
  programId: string,
  functionName: string,
  inputs: string[],
  recordIndices?: number[],
): void => {
  if (functionName !== "pay_and_subscribe_public") {
    return;
  }

  if (Array.isArray(recordIndices) && recordIndices.length > 0) {
    throw new Error(
      `Do not pass record indices to ${programId}/${functionName}. This public transition must spend the signer's public balance automatically.`,
    );
  }

  const manualRecordInput = inputs.find((input) => isAleoRecordInput(input));
  if (manualRecordInput) {
    throw new Error(
      `Do not pass a credits record to ${programId}/${functionName}. Use only typed public inputs so the wallet selects funds from the signer automatically.`,
    );
  }
};

const withWalletDefaults = <T extends CompatibleTransactionOptions>(wallet: WalletContextState, tx: T): T => {
  // Keep wallet defaults unless explicitly overridden by caller.
  // For some wallet/account states, forcing private/public fee can make execution fail.
  void wallet;
  return tx;
};

const supportsRawExecutionApi = (wallet: WalletContextState): boolean => {
  const name = getWalletAdapterName(wallet);
  return name.includes("leo");
};

const preferRawExecutionApi = (wallet: WalletContextState): boolean => {
  const name = getWalletAdapterName(wallet);
  return name.includes("leo");
};

const toLeoChainId = (_network: WalletContextState["network"]): string =>
  "testnetbeta";

const getRawExecutionWallets = (wallet: WalletContextState): RequestExecutionLike[] => {
  const out: RequestExecutionLike[] = [];
  const seen = new Set<object>();

  const add = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const casted = candidate as RequestExecutionLike;
    if (
      typeof casted.requestExecution !== "function" &&
      typeof casted.requestTransaction !== "function"
    ) {
      return;
    }
    const ref = candidate as object;
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(casted);
  };

  const adapter = wallet.wallet?.adapter as Record<string, unknown> | undefined;
  add(adapter?.["_leoWallet"]);
  add(adapter?.["_foxWallet"]);
  add(adapter?.["_shieldWallet"]);

  if (typeof window !== "undefined") {
    const win = window as unknown as {
      leoWallet?: unknown;
      leo?: unknown;
      foxwallet?: { aleo?: unknown };
      shieldwallet?: { aleo?: unknown };
      shieldWallet?: unknown;
      shield?: unknown;
    };
    add(win.leoWallet);
    add(win.leo);
    add(win.foxwallet?.aleo);
    add(win.shieldwallet?.aleo);
    add(win.shieldWallet);
    add(win.shield);
  }

  return out;
};

const getExecutionReaders = (wallet: WalletContextState): ExecutionReaderLike[] => {
  const out: ExecutionReaderLike[] = [];
  const seen = new Set<object>();

  const add = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const casted = candidate as ExecutionReaderLike;
    if (typeof casted.getExecution !== "function") {
      return;
    }
    const ref = candidate as object;
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(casted);
  };

  add(wallet as unknown as ExecutionReaderLike);
  add(wallet.wallet?.adapter as unknown as ExecutionReaderLike);

  for (const raw of getRawExecutionWallets(wallet)) {
    add(raw as unknown as ExecutionReaderLike);
  }

  return out;
};

const normalizeExecutionTranscript = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["execution", "executionProof", "proof"];
  for (const key of directKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  for (const key of ["result", "data", "payload"]) {
    const nested = record[key];
    if (!nested || typeof nested !== "object") continue;
    for (const nestedKey of directKeys) {
      const candidate = (nested as Record<string, unknown>)[nestedKey];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  return undefined;
};

const isExecutionTranscriptUnsupportedError = (error: unknown): boolean => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  return (
    message.includes("invalid_params") ||
    message.includes("invalid params") ||
    message.includes("wallet did not expose the execution transcript")
  );
};

export const getExecutionFromWallet = async (
  wallet: WalletContextState,
  transactionIds: string[],
): Promise<string> => {
  const readers = getExecutionReaders(wallet);
  if (readers.length === 0) {
    throw new Error("Connected wallet does not expose getExecution for subscription proof retrieval.");
  }

  let lastError: unknown;
  for (const transactionId of transactionIds) {
    if (!transactionId) continue;
    for (const reader of readers) {
      if (typeof reader.getExecution !== "function") continue;
      try {
        const execution = normalizeExecutionTranscript(await reader.getExecution(transactionId));
        if (execution) {
          return execution;
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Wallet did not expose the execution transcript for the subscription proof transaction.");
};

export const waitForTransactionFinality = async (
  txId: string,
  timeoutMs = 90_000,
  intervalMs = 5_000,
): Promise<unknown> => {
  const explorerUrl = `${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/transaction/${txId}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(explorerUrl);
      if (response.ok) {
        const payload = await response.json();
        console.log("[InnerCircle] Transaction finalized:", txId);
        return payload;
      }

      if (response.status === 404) {
        console.log("[InnerCircle] Tx not indexed yet, retrying in 5s...");
      }
    } catch (error) {
      console.log("[InnerCircle] Explorer fetch error, retrying...", error);
    }

    await wait(intervalMs);
  }

  throw new Error(
    `Transaction ${txId} not finalized after ${Math.floor(timeoutMs / 1000)}s. It may still confirm - check explorer manually.`,
  );
};

export const waitForExecutionTranscript = async (
  wallet: WalletContextState,
  txId: string,
  timeoutMs = 90_000,
  intervalMs = 5_000,
): Promise<string | null> => {
  const explorerUrl = `${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/transaction/${txId}`;
  const deadline = Date.now() + timeoutMs;
  let walletTranscriptUnsupported = false;

  while (Date.now() < deadline) {
    if (!walletTranscriptUnsupported) {
      try {
        const transcript = await getExecutionFromWallet(wallet, [txId]);
        if (transcript) {
          console.log("[InnerCircle] Got execution transcript from wallet");
          return transcript;
        }
      } catch (error) {
        if (isExecutionTranscriptUnsupportedError(error)) {
          walletTranscriptUnsupported = true;
          console.warn("[InnerCircle] Wallet transcript API is unsupported for this transaction. Falling back to tx verification.");
        } else if (process.env.NODE_ENV !== "production") {
          console.log("[InnerCircle] Transcript not ready, retrying...", error);
        }
      }
    }

    try {
      const response = await fetch(explorerUrl);
      if (response.ok) {
        const data = await response.json();
        const execution =
          (typeof data?.execution === "string" ? data.execution : null) ??
          (typeof data?.transaction?.execution === "string" ? data.transaction.execution : null) ??
          null;
        if (execution) {
          console.log("[InnerCircle] Got execution transcript from explorer");
          return execution;
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[InnerCircle] Transcript not ready, retrying...", error);
      }
    }

    if (walletTranscriptUnsupported) {
      return null;
    }

    await wait(intervalMs);
  }

  return null;
};

const requestExecutionViaRawWallet = async (
  wallet: WalletContextState,
  tx: CompatibleTransactionOptions,
): Promise<string | undefined> => {
  if (!supportsRawExecutionApi(wallet)) {
    return undefined;
  }

  const address = wallet.address;
  if (!address) {
    return undefined;
  }

  const rawFee =
    toNumericTransactionFee(tx.fee) ?? 1_000;
  const isShield = isShieldWallet(wallet);
  const shieldFeeLiteral = toShieldFeeLiteral(tx.fee) ?? `${rawFee}u64`;
  const programId = getTransactionProgramId(tx);
  const functionName = getTransactionFunctionName(tx);

  const requestData: LegacyRawExecutionRequestData | ShieldRawExecutionRequestData = isShield
    ? {
      programId,
      functionName,
      inputs: [...tx.inputs],
      fee: shieldFeeLiteral,
      ...(tx.privateFee === true ? { privateFee: true } : {}),
    }
    : {
      address,
      chainId: toLeoChainId(wallet.network),
      fee: rawFee,
      feePrivate: tx.privateFee ?? false,
      ...(Array.isArray(tx.recordIndices) && tx.recordIndices.length > 0
        ? { recordIndices: tx.recordIndices }
        : {}),
      transitions: [
        {
          program: programId,
          functionName,
          inputs: tx.inputs,
        },
      ],
    };

  if (process.env.NODE_ENV !== "production" && isShield) {
    console.warn("[InnerCircle][Shield] raw request payload", requestData);
    console.warn("[InnerCircle][Shield] raw request payload json", JSON.stringify(requestData));
  }

  for (const raw of getRawExecutionWallets(wallet)) {
    if (typeof raw.requestTransaction === "function") {
      const transactionResult = await raw.requestTransaction(requestData);
      const txId = getTransactionId(transactionResult);
      if (txId) {
        return txId;
      }
    }

    if (typeof raw.requestExecution === "function") {
      const executionResult = await raw.requestExecution(requestData);
      const txId = getTransactionId(executionResult);
      if (txId) {
        return txId;
      }
    }
  }

  return undefined;
};

const toWalletTransactionOptions = (
  wallet: WalletContextState,
  tx: CompatibleTransactionOptions,
): TransactionOptions => {
  void wallet;
  return toLegacyTransactionOptions(tx);
};

export const requestTransactionCompat = async (
  wallet: WalletContextState,
  tx: CompatibleTransactionOptions,
): Promise<string> => {
  const txWithDefaults = toWalletTransactionOptions(wallet, withWalletDefaults(wallet, tx));
  const executeViaAdapter = async (): Promise<string> => {
    const result = await wallet.executeTransaction(txWithDefaults as TransactionOptions);
    const transactionId = getTransactionId(result);
    if (!transactionId) throw new Error("Wallet did not return a transaction ID.");
    return transactionId;
  };

  const contextRequest = (wallet as WalletContextState & RequestTransactionLike).requestTransaction;
  const adapterRequest = (wallet.wallet?.adapter as RequestTransactionLike | undefined)?.requestTransaction;
  try {
    if (preferRawExecutionApi(wallet)) {
      const rawTxId = await requestExecutionViaRawWallet(wallet, txWithDefaults);
      if (rawTxId) {
        return rawTxId;
      }
    }

    if (isShieldWallet(wallet)) {
      return await executeViaAdapter();
    }

    if (typeof contextRequest === "function") {
      const result = await contextRequest(txWithDefaults);
      const transactionId = getTransactionId(result);
      if (!transactionId) throw new Error("Wallet did not return a transaction ID.");
      return transactionId;
    }

    if (typeof adapterRequest === "function") {
      const result = await adapterRequest(txWithDefaults);
      const transactionId = getTransactionId(result);
      if (!transactionId) throw new Error("Wallet did not return a transaction ID.");
      return transactionId;
    }

    return await executeViaAdapter();
  } catch (error) {
    if (isNoSelectedAccountError(error)) {
      await wallet.disconnect().catch(() => undefined);
      throw new Error(noSelectedAccountMessage());
    }
    if (isExtensionCrashedError(error)) {
      throw new Error(
        "Lost connection to Shield wallet. Please refresh the page, reconnect your wallet, then retry.",
      );
    }
    if (isUserRejectedError(error)) {
      throw error;
    }

    const message = (error as Error)?.message?.toLowerCase() ?? "";

    if (
      supportsRawExecutionApi(wallet) &&
      !preferRawExecutionApi(wallet)
    ) {
      try {
        const rawTxId = await requestExecutionViaRawWallet(wallet, txWithDefaults);
        if (rawTxId) {
          return rawTxId;
        }
      } catch (rawError) {
        if (isNoSelectedAccountError(rawError)) {
          await wallet.disconnect().catch(() => undefined);
          throw new Error(noSelectedAccountMessage());
        }
        if (isExtensionCrashedError(rawError)) {
          throw new Error(
            "Lost connection to Shield wallet. Please refresh the page, reconnect your wallet, then retry.",
          );
        }
        if (isUserRejectedError(rawError)) {
          throw rawError;
        }

        const primary = (error as Error)?.message ?? "Wallet executeTransaction failed.";
        const secondary = (rawError as Error)?.message ?? "Raw requestExecution failed.";
        throw new Error(`${primary} | ${secondary}`);
      }
    }

    if (
      isShieldWallet(wallet) &&
      /invalid_params|invalid transaction payload|could not create transaction/.test(message)
    ) {
      throw new Error(
        'Shield rejected the transaction payload. Most likely causes: stale dApp program permissions in Shield, or the deployed testnet program signature does not match the frontend call.',
      );
    }
    throw error;
  }
};

export type FeePreference = "auto" | "aleo_first" | "microcredits_first";

interface ExecuteCreditsTransferInput {
  wallet: WalletContextState;
  recipientAddress: string;
  amountMicrocredits: string | number | bigint | null | undefined;
  feeAleo?: number;
  feePreference?: FeePreference;
}

const buildFeeCandidates = (
  wallet: WalletContextState,
  feeAleo: number,
  feeMicrocredits?: number,
  feePreference: FeePreference = "auto",
): number[] => {
  if (isShieldWallet(wallet)) {
    return Array.from(
      new Set(
        [feeMicrocredits, Number.isInteger(feeAleo) ? feeAleo : undefined].filter(
          (value): value is number =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            Number.isInteger(value) &&
            value > 0,
        ),
      ),
    );
  }

  const orderedCandidates =
    feePreference === "aleo_first"
      ? [feeAleo, feeMicrocredits]
      : feePreference === "microcredits_first"
        ? [feeMicrocredits, feeAleo]
        : isPuzzleWallet(wallet)
          ? [feeMicrocredits, feeAleo]
          : isShieldWallet(wallet)
            ? [feeAleo, feeMicrocredits]
            : [feeAleo, feeMicrocredits];

  return Array.from(
    new Set(
      orderedCandidates.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    ),
  );
};

const buildShieldPaymentFeeCandidates = (
  baseFeeMicrocredits: number,
  feePreference: FeePreference = "auto",
): number[] => {
  const tiers = Array.from(
    new Set(
      [
        baseFeeMicrocredits,
        Math.max(baseFeeMicrocredits * 2, 500_000),
        Math.max(baseFeeMicrocredits * 10, 2_500_000),
        Math.max(baseFeeMicrocredits * 20, 5_000_000),
      ].filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0,
      ),
    ),
  );

  if (feePreference === "aleo_first") {
    return [...tiers].reverse();
  }

  return tiers;
};

const arityPreference = new Map<string, 1 | 2>();

const isAcceptedWalletStatus = (status: string): boolean =>
  /accepted|confirmed|finalized|success|mined/i.test(status);

const isFailedWalletStatus = (status: string): boolean =>
  /failed|reject|error|aborted|cancel|denied|invalid/i.test(status);

const getStringByKey = (value: unknown, keys: string[]): string | undefined => {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const maybe = obj[key];
    if (typeof maybe === "string" && maybe.trim().length > 0) {
      return maybe.trim();
    }
  }

  return undefined;
};

const collectStringsByKeysDeep = (
  value: unknown,
  keys: string[],
  depth = 0,
): string[] => {
  if (depth > 4 || !value || typeof value !== "object") {
    return [];
  }

  const out: string[] = [];
  const obj = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === "string" && direct.trim().length > 0) {
      out.push(direct.trim());
    }
  }

  for (const nestedValue of Object.values(obj)) {
    if (nestedValue && typeof nestedValue === "object") {
      out.push(...collectStringsByKeysDeep(nestedValue, keys, depth + 1));
    }
  }

  return out;
};

const getRawWalletApis = (wallet: WalletContextState): Array<TransactionHistoryLike & TransactionStatusLike> => {
  const apis: Array<TransactionHistoryLike & TransactionStatusLike> = [];
  const seen = new Set<object>();

  const addCandidate = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const casted = candidate as TransactionHistoryLike & TransactionStatusLike;

    const hasHistory = typeof casted.requestTransactionHistory === "function";
    const hasStatus = typeof casted.transactionStatus === "function";
    if (!hasHistory && !hasStatus) return;

    const objectRef = candidate as object;
    if (seen.has(objectRef)) return;
    seen.add(objectRef);
    apis.push(casted);
  };

  const adapter = wallet.wallet?.adapter as Record<string, unknown> | undefined;
  addCandidate(adapter?.["_leoWallet"]);
  addCandidate(adapter?.["_foxWallet"]);
  addCandidate(adapter?.["_shieldWallet"]);
  addCandidate(adapter?.["_puzzleWallet"]);

  if (typeof window !== "undefined") {
    const win = window as unknown as {
      leoWallet?: unknown;
      leo?: unknown;
      foxwallet?: { aleo?: unknown };
      shieldwallet?: { aleo?: unknown };
      shieldWallet?: unknown;
      shield?: unknown;
      puzzle?: unknown;
    };
    addCandidate(win.leoWallet);
    addCandidate(win.leo);
    addCandidate(win.foxwallet?.aleo);
    addCandidate(win.shieldwallet?.aleo);
    addCandidate(win.shieldWallet);
    addCandidate(win.shield);
    addCandidate(win.puzzle);
  }

  return apis;
};

const normalizeStatus = (value: unknown): string => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (text === "finalized") return "accepted";
  if (text === "completed") return "pending";
  return text;
};

const extractErrorMessage = (value: unknown): string | undefined => {
  const topLevel = getStringByKey(value, ["error", "message", "reason", "details"]);
  if (topLevel) return topLevel;

  const deep = collectStringsByKeysDeep(value, ["error", "message", "reason", "details"]);
  return deep[0];
};

const extractTxIdCandidate = (value: unknown): string | undefined => {
  const keys = [
    "transactionId",
    "transaction_id",
    "txId",
    "txid",
    "id",
    "hash",
    "txHash",
    "transactionHash",
    "aleoTransactionId",
    "eventId",
    "event_id",
  ];
  const top = keys
    .map((key) => getStringByKey(value, [key]))
    .filter((candidate): candidate is string => Boolean(candidate));
  const deep = collectStringsByKeysDeep(value, keys);
  const merged = uniqueStrings([...top, ...deep]);
  const onChain = merged.find((candidate) => isOnChainAleoTxId(candidate));
  return onChain ?? merged[0];
};

const extractStatusCandidate = (value: unknown): string | undefined => {
  const topLevel = getStringByKey(value, [
    "status",
    "state",
    "txStatus",
    "transactionStatus",
  ]);
  if (topLevel) return topLevel;

  const deep = collectStringsByKeysDeep(value, [
    "status",
    "state",
    "txStatus",
    "transactionStatus",
  ]);
  return deep[0];
};

const readRawWalletStatus = async (
  wallet: WalletContextState,
  requestTxId: string,
): Promise<{ status?: string; transactionId?: string; error?: string }> => {
  const rawApis = getRawWalletApis(wallet);
  for (const api of rawApis) {
    if (typeof api.transactionStatus !== "function") continue;
    try {
      const response = await api.transactionStatus(requestTxId);
      const status = normalizeStatus(extractStatusCandidate(response));
      const transactionId = extractTxIdCandidate(response);
      const error = extractErrorMessage(response);
      if (status || transactionId || error) {
        return { status, transactionId, error };
      }
    } catch {
      // Ignore and continue.
    }
  }

  return {};
};

export const waitForWalletExecution = async (
  wallet: WalletContextState,
  transactionId: string,
  options?: { attempts?: number; delayMs?: number; programId?: string },
): Promise<WalletExecutionResult> => {
  const attempts = options?.attempts ?? 45;
  const delayMs = options?.delayMs ?? 1500;
  let chainTxId: string | undefined;
  let lastStatus: string | undefined;
  let noStatusCounter = 0;
  let statusLookupErrorCounter = 0;
  const shouldDeferToExplorer =
    isShieldWallet(wallet) &&
    isTemporaryWalletTxId(transactionId);

  const tryHistoryFallback = async (): Promise<WalletExecutionResult | undefined> => {
    if (chainTxId || !isTemporaryWalletTxId(transactionId)) {
      return undefined;
    }
    const likelyShieldTempId = /^shield[._-]/i.test(transactionId) || isShieldWallet(wallet);
    if (!likelyShieldTempId) {
      return undefined;
    }

    try {
      const resolvedId = await resolveChainTxIdFromHistory(
        wallet,
        transactionId,
        options?.programId,
      );
      if (resolvedId && isOnChainAleoTxId(resolvedId)) {
        return {
          accepted: true,
          chainTxId: resolvedId,
          lastStatus: "accepted",
        };
      }
    } catch {
      // History lookup failures should not mask the original status result.
    }

    return undefined;
  };

  for (let i = 0; i < attempts; i += 1) {
    try {
      const responseRaw = await wallet.transactionStatus(transactionId);
      // The adapter returns a structured object: { status, transactionId, error }
      const response = (responseRaw as unknown) as Record<string, unknown> | undefined;
      let status = normalizeStatus(response?.status ?? extractStatusCandidate(responseRaw));
      let errorMessage = (response?.error as string | undefined) ?? extractErrorMessage(responseRaw);
      const txIdFromStatus =
        (response?.transactionId as string | undefined) ??
        extractTxIdCandidate(responseRaw);
      if (txIdFromStatus) {
        chainTxId = txIdFromStatus;
      }

      // Leo/Fox adapters currently strip transactionId/error from response.
      if (!status || !txIdFromStatus) {
        const rawStatus = await readRawWalletStatus(wallet, transactionId);
        if (!status && rawStatus.status) {
          status = rawStatus.status;
        }
        if (!chainTxId && rawStatus.transactionId) {
          chainTxId = rawStatus.transactionId;
        }
        if (!errorMessage && rawStatus.error) {
          errorMessage = rawStatus.error;
        }
      }

      if (!status) {
        noStatusCounter += 1;
        if (isTemporaryWalletTxId(transactionId) && noStatusCounter >= 12) {
          if (!shouldDeferToExplorer) {
            const resolved = await tryHistoryFallback();
            if (resolved) {
              return resolved;
            }
          } else {
            return {
              accepted: true,
              chainTxId,
              lastStatus: lastStatus ?? "submitted",
            };
          }
          return {
            accepted: false,
            chainTxId,
            lastStatus,
          };
        }
        await wait(delayMs);
        continue;
      }
      noStatusCounter = 0;
      lastStatus = status;

      if (isAcceptedWalletStatus(status)) {
        return {
          accepted: true,
          chainTxId,
          lastStatus: status,
        };
      }

      if (isFailedWalletStatus(status)) {
        if (shouldDeferToExplorer) {
          await wait(delayMs);
          continue;
        }

        const pendingRequestId =
          isTemporaryWalletTxId(transactionId) &&
          (!chainTxId || isTemporaryWalletTxId(chainTxId));

        // Some adapters transiently return "failed" for request IDs before the explorer tx is available.
        if (pendingRequestId) {
          await wait(delayMs);
          continue;
        }

        const rejectionHint =
          !errorMessage && isShieldWallet(wallet)
            ? " Shield reported a rejected status."
            : "";
        throw new Error(`Wallet transaction failed: ${errorMessage ?? `status "${status}"`}.${rejectionHint}`);
      }
    } catch (error) {
      const message = (error as Error)?.message ?? "";
      if (isExtensionCrashedError(error)) {
        throw new Error(
          "Lost connection to Shield wallet (extension service worker stopped). Please refresh the page and reconnect your wallet, then try again.",
        );
      }
      if (isUserRejectedError(error) || /wallet transaction failed|wallet reported transaction status/i.test(message)) {
        throw error;
      }

      // Some adapters throw while still exposing data on raw wallet APIs.
      const rawStatus = await readRawWalletStatus(wallet, transactionId);
      if (rawStatus.transactionId) {
        chainTxId = rawStatus.transactionId;
      }
      if (rawStatus.status) {
        const status = normalizeStatus(rawStatus.status);
        lastStatus = status;
        noStatusCounter = 0;
        statusLookupErrorCounter = 0;

        if (isAcceptedWalletStatus(status)) {
          return {
            accepted: true,
            chainTxId,
            lastStatus: status,
          };
        }

        if (isFailedWalletStatus(status)) {
          if (shouldDeferToExplorer) {
            await wait(delayMs);
            continue;
          }

          const pendingRequestId =
            isTemporaryWalletTxId(transactionId) &&
            (!chainTxId || isTemporaryWalletTxId(chainTxId));
          if (!pendingRequestId) {
            const rejectionHint =
              !rawStatus.error && isShieldWallet(wallet)
                ? " Shield reported a rejected status."
                : "";
            throw new Error(`Wallet transaction failed: ${rawStatus.error ?? `status "${status}"`}.${rejectionHint}`);
          }
        }
      } else {
        statusLookupErrorCounter += 1;
        if (isTemporaryWalletTxId(transactionId) && statusLookupErrorCounter >= 12) {
          if (!shouldDeferToExplorer) {
            const resolved = await tryHistoryFallback();
            if (resolved) {
              return resolved;
            }
          } else {
            return {
              accepted: true,
              chainTxId,
              lastStatus: lastStatus ?? "submitted",
            };
          }
          return {
            accepted: false,
            chainTxId,
            lastStatus,
          };
        }
      }
      // Ignore transient status lookup errors and let backend verification retry handle finality.
    }

    // Every 3rd attempt, also verify directly against the Aleo explorer.
    if (i > 0 && i % 3 === 0) {
      const explorerTxId =
        (chainTxId && isOnChainAleoTxId(chainTxId) ? chainTxId : undefined) ??
        (isOnChainAleoTxId(transactionId) ? transactionId : undefined);

      if (explorerTxId && !/^demo/i.test(explorerTxId)) {
        try {
          const explorerRes = await fetch(
            `${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/transaction/${explorerTxId}`,
          );
          if (explorerRes.ok) {
            return {
              accepted: true,
              chainTxId: explorerTxId,
              lastStatus: lastStatus ?? "accepted",
            };
          }
        } catch {
          // Ignore explorer failures and continue polling.
        }
      }
    }

    await wait(delayMs);
  }

  if (!shouldDeferToExplorer) {
    const resolved = await tryHistoryFallback();
    if (resolved) {
      return resolved;
    }
  } else {
    return {
      accepted: true,
      chainTxId,
      lastStatus: lastStatus ?? "submitted",
    };
  }

  return {
    accepted: false,
    chainTxId,
    lastStatus,
  };
};

const pickResolvedTxId = (
  requestId: string,
  txs: WalletHistoryRecord[],
): string | undefined => {
  for (const tx of txs) {
    if (!tx.ids.includes(requestId)) continue;
    const ids = tx.ids.filter((id) => id !== requestId);

    for (const id of ids) {
      if (isOnChainAleoTxId(id)) {
        return id;
      }
    }

    for (const id of ids) {
      if (!isUuidLike(id)) {
        return id;
      }
    }

    if (
      tx.transactionId &&
      tx.transactionId !== requestId &&
      isOnChainAleoTxId(tx.transactionId)
    ) {
      return tx.transactionId;
    }
    if (tx.id && tx.id !== requestId && isOnChainAleoTxId(tx.id)) {
      return tx.id;
    }
  }

  return undefined;
};

const uniqueStrings = (values: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const DEFAULT_HISTORY_PROGRAM_IDS = uniqueStrings([
  "credits.aleo",
  "creator_reg_v5_xwnxp.aleo",
  PAYMENT_PROOF_PROGRAM_ID,
  SUBSCRIPTION_PROGRAM_ID,
  TIP_PROGRAM_ID,
]);

export const resolveChainTxIdFromHistory = async (
  wallet: WalletContextState,
  requestTxId: string,
  programId?: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<string | undefined> => {
  if (isOnChainAleoTxId(requestTxId)) {
    return requestTxId;
  }

  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 1500;
  const candidatePrograms = uniqueStrings([
    ...(programId ? [programId] : []),
    ...DEFAULT_HISTORY_PROGRAM_IDS,
  ]);

  for (let i = 0; i < attempts; i += 1) {
    for (const candidateProgram of candidatePrograms) {
      const responses = await readHistoryResponses(wallet, candidateProgram);
      for (const response of responses) {
        const records = getHistoryRecordsFromResponse(response);
        if (records.length === 0) continue;

        const resolved = pickResolvedTxId(requestTxId, records);
        if (resolved && isOnChainAleoTxId(resolved)) {
          return resolved;
        }

        if (isTemporaryWalletTxId(requestTxId)) {
          const fallback = pickAnyOnChainTxId(records);
          if (fallback && isOnChainAleoTxId(fallback)) {
            return fallback;
          }
        }
      }
    }

    await wait(delayMs);
  }

  return undefined;
};

const extractHistoryArrays = (value: unknown, depth = 0): unknown[] => {
  if (depth > 3 || !value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const direct = obj["transactions"];
  if (Array.isArray(direct)) {
    return direct;
  }

  const events = obj["events"];
  if (Array.isArray(events)) {
    return events;
  }

  const txs = obj["txs"];
  if (Array.isArray(txs)) {
    return txs;
  }

  const history = obj["history"];
  if (Array.isArray(history)) {
    return history;
  }

  const items = obj["items"];
  if (Array.isArray(items)) {
    return items;
  }

  const data = obj["data"];
  if (data) {
    const nested = extractHistoryArrays(data, depth + 1);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
};

const extractIdsFromRecord = (value: unknown, depth = 0): string[] => {
  if (depth > 3 || !value || typeof value !== "object") {
    return [];
  }

  const obj = value as Record<string, unknown>;
  const keys = [
    "id",
    "transactionId",
    "txId",
    "requestId",
    "eventId",
    "tempTransactionId",
    "temp_tx_id",
    "requestTxId",
    "request_tx_id",
    "transaction_id",
    "request_id",
    "txid",
    "txHash",
    "transactionHash",
    "hash",
  ];
  const direct = keys
    .map((key) => obj[key])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  const nestedKeys = ["transaction", "event", "result", "metadata", "payload"];
  const nested = nestedKeys.flatMap((key) => extractIdsFromRecord(obj[key], depth + 1));
  return uniqueStrings([...direct, ...nested]);
};

const toHistoryRecord = (value: unknown): WalletHistoryRecord => {
  const id = getStringByKey(value, ["id"]);
  const transactionId = getStringByKey(value, ["transactionId", "txId", "transaction_id"]);
  const requestId = getStringByKey(value, [
    "requestId",
    "request_id",
    "eventId",
    "tempTransactionId",
    "temp_tx_id",
    "requestTxId",
    "request_tx_id",
  ]);
  const ids = uniqueStrings([
    ...extractIdsFromRecord(value),
    ...(id ? [id] : []),
    ...(transactionId ? [transactionId] : []),
    ...(requestId ? [requestId] : []),
  ]);

  return {
    id,
    transactionId,
    requestId,
    ids,
  };
};

const getHistoryRecordsFromResponse = (value: unknown): WalletHistoryRecord[] => {
  const txs = extractHistoryArrays(value);
  if (!Array.isArray(txs) || txs.length === 0) {
    return [];
  }

  return txs.map((tx) => toHistoryRecord(tx));
};

const readHistoryResponses = async (wallet: WalletContextState, programId: string): Promise<unknown[]> => {
  if (isShieldWallet(wallet)) {
    return [];
  }

  const responses: unknown[] = [];

  const contextHistoryApi = wallet as WalletContextState & TransactionHistoryLike;
  if (typeof contextHistoryApi.requestTransactionHistory === "function") {
    try {
      responses.push(await contextHistoryApi.requestTransactionHistory(programId));
    } catch {
      // Ignore context API failures.
    }
  }

  for (const api of getRawWalletApis(wallet)) {
    if (typeof api.requestTransactionHistory !== "function") continue;
    try {
      responses.push(await api.requestTransactionHistory(programId));
    } catch {
      // Ignore wallet-specific API failures.
    }
  }

  return responses;
};

export const resolveExplorerTxId = async (
  wallet: WalletContextState,
  programId: string,
  requestTxId: string,
  options?: { attempts?: number; delayMs?: number; statusTxId?: string },
): Promise<string> => {
  const statusTxId = options?.statusTxId;
  if (statusTxId && isOnChainAleoTxId(statusTxId)) {
    return statusTxId;
  }

  if (isOnChainAleoTxId(requestTxId)) {
    return requestTxId;
  }

  const attempts = options?.attempts ?? 45;
  const delayMs = options?.delayMs ?? 2000;
  let noHistoryCounter = 0;

  for (let i = 0; i < attempts; i += 1) {
    const historyResponses = await readHistoryResponses(wallet, programId);
    let foundRecords = false;
    for (const history of historyResponses) {
      const records = getHistoryRecordsFromResponse(history);
      if (records.length === 0) continue;
      foundRecords = true;

      const resolved = pickResolvedTxId(requestTxId, records);
      if (resolved && isOnChainAleoTxId(resolved)) {
        return resolved;
      }

      // Some wallets do not include the temporary request id in history entries.
      // For program-scoped history, the newest on-chain entry is still a useful fallback.
      if (isTemporaryWalletTxId(requestTxId)) {
        const fallback = pickAnyOnChainTxId(records);
        if (fallback && isOnChainAleoTxId(fallback)) {
          return fallback;
        }
      }
    }

    if (!foundRecords) {
      noHistoryCounter += 1;
      if (isTemporaryWalletTxId(requestTxId) && noHistoryCounter >= 12) {
        return options?.statusTxId ?? requestTxId;
      }
    } else {
      noHistoryCounter = 0;
    }

    await wait(delayMs);
  }

  return options?.statusTxId ?? requestTxId;
};

export const waitForOnChainTransactionId = async (
  wallet: WalletContextState,
  requestTxId: string,
  programId: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<string> => {
  const execution = await waitForWalletExecution(wallet, requestTxId, {
    attempts: options?.attempts,
    delayMs: options?.delayMs,
    programId,
  });

  if (!execution.accepted && !isOnChainAleoTxId(execution.chainTxId)) {
    throw new Error("Transaction was not confirmed. It may have been rejected by the wallet.");
  }

  const resolved = await resolveExplorerTxId(wallet, programId, requestTxId, {
    statusTxId: execution.chainTxId,
    attempts: options?.attempts,
    delayMs: options?.delayMs,
  });

  if (!isOnChainAleoTxId(resolved)) {
    throw new Error(
      "Transaction was submitted, but the on-chain tx id is not available yet. Wait for finalization and retry.",
    );
  }

  return resolved;
};

/**
 * Polls the Aleo testnet explorer API directly to find the real on-chain
 * at1... transaction ID. Used as a fallback when the wallet's own history
 * API cannot resolve a temporary ID (e.g. shield_*, puzzle-uuid, etc.).
 *
 * Strategy: query the latest transactions for the given program and return
 * the most recent one. Since the user just submitted, it should be first.
 */
const shouldStopExplorerProgramPolling = async (response: Response): Promise<boolean> => {
  if (response.ok) {
    return false;
  }

  if (response.status < 400 || response.status >= 500) {
    return false;
  }

  try {
    const payload: unknown = await response.clone().json();
    const message = getStringByKey(payload, ["message", "error"])?.toLowerCase() ?? "";
    return /invalid edition number|cannot get /i.test(message);
  } catch {
    try {
      const text = (await response.clone().text()).toLowerCase();
      return /invalid edition number|cannot get /i.test(text);
    } catch {
      return false;
    }
  }
};

export const pollExplorerForTxId = async (
  programId: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<string | undefined> => {
  const attempts = options?.attempts ?? 60;
  const delayMs = options?.delayMs ?? 3000;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const url = `${ALEO_EXPLORER_API}/${ALEO_EXPLORER_NETWORK}/program/${programId}/transactions?limit=5`;
      const response = await fetch(url);
      if (!response.ok) {
        if (await shouldStopExplorerProgramPolling(response)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[InnerCircle] explorer program transaction polling unsupported", {
              programId,
              status: response.status,
              url,
            });
          }
          return undefined;
        }
        await wait(delayMs);
        continue;
      }

      const data: unknown = await response.json();
      if (!data || !Array.isArray(data)) {
        await wait(delayMs);
        continue;
      }

      // Each entry has a transaction.id field that is the real on-chain at1... ID
      for (const entry of data as unknown[]) {
        const rec = entry as Record<string, unknown>;

        // Try top-level id
        const topId = getStringByKey(rec, ["id", "transactionId", "transaction_id", "txId", "txid"]);
        if (topId && isOnChainAleoTxId(topId)) return topId;

        // Try nested transaction object
        const txObj = rec["transaction"];
        if (txObj && typeof txObj === "object") {
          const nestedId = getStringByKey(txObj as Record<string, unknown>, ["id", "transactionId", "transaction_id"]);
          if (nestedId && isOnChainAleoTxId(nestedId)) return nestedId;
        }

        // Deep scan all string fields
        const deep = collectStringsByKeysDeep(rec, ["id", "transactionId", "transaction_id", "txId", "txid"]);
        const onChain = deep.find((v) => isOnChainAleoTxId(v));
        if (onChain) return onChain;
      }
    } catch {
      // Network error — keep retrying
    }

    await wait(delayMs);
  }

  return undefined;
};

interface ExecuteProgramTxInput {
  wallet: WalletContextState;
  programId: string;
  functionName: string;
  inputs: string[];
  feeAleo?: number;
  privateFee?: boolean;
  feePreference?: FeePreference;
  recordIndices?: number[];
  // Lock the signer address for flows that must abort if the wallet account
  // changes between preparation and submission.
  signerAddress?: string;
}

export const executeProgramTransaction = async ({
  wallet,
  programId,
  functionName,
  inputs,
  feeAleo = EXECUTION_FEE_ALEO,
  privateFee = false,
  feePreference = "auto",
  recordIndices,
  signerAddress,
}: ExecuteProgramTxInput): Promise<string> => {
  const activeAddress = wallet.address?.trim();
  if (!activeAddress || !activeAddress.startsWith("aleo1")) {
    throw new Error("Wallet is not connected to a valid Aleo address.");
  }
  if (signerAddress && activeAddress.toLowerCase() !== signerAddress.trim().toLowerCase()) {
    throw new Error("SIGNER_CHANGED");
  }

  const adapterName = getWalletAdapterName(wallet);
  const isShield = adapterName.toLowerCase().includes("shield");
  const executionFeeMicrocredits = aleoToMicrocredits(feeAleo);
  const feeMicrocreditsNumber =
    executionFeeMicrocredits <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(executionFeeMicrocredits)
      : undefined;

  const feeCandidates = buildFeeCandidates(
    wallet,
    feeAleo,
    feeMicrocreditsNumber,
    feePreference,
  );

  validateLiteralInputs(programId, functionName, inputs);
  assertNoManualRecordForPublicExecution(programId, functionName, inputs, recordIndices);

  const submitWithCompatibility = async (): Promise<string> => {
    let lastAttemptError: unknown;
    for (const feeCandidate of feeCandidates) {
      try {
        const txRequest: TransactionOptions = {
          program: programId,
          function: functionName,
          inputs,
          fee: feeCandidate,
          privateFee,
          ...(recordIndices && recordIndices.length > 0 ? { recordIndices } : {}),
        };

        if (process.env.NODE_ENV !== "production" && isShield) {
          console.warn("[InnerCircle][Shield] program attempt", txRequest);
          console.warn("[InnerCircle][Shield] program attempt payload", JSON.stringify(txRequest));
        }

        const txId = await requestTransactionCompat(wallet, txRequest);
        return txId;
      } catch (error) {
        if (isUserRejectedError(error)) {
          throw error;
        }
        lastAttemptError = error;
        if (!isRetryablePayloadFormatError(error)) {
          throw error;
        }
      }
    }

    throw lastAttemptError ?? new Error("Program transaction failed.");
  };

  let executionError: unknown;
  try {
    return await submitWithCompatibility();
  } catch (error) {
    executionError = error;
  }

  if (
    isShield &&
    isRetryablePayloadFormatError(executionError) &&
    !/invalid_params/i.test((executionError as Error)?.message ?? "") &&
    typeof wallet.disconnect === "function" &&
    typeof wallet.connect === "function"
  ) {
    try {
      await wallet.disconnect().catch(() => undefined);
      await wait(200);
      await wallet.connect(Network.TESTNET);
      return await submitWithCompatibility();
    } catch (reconnectError) {
      executionError = reconnectError;
    }
  }

  try {
    throw executionError ?? new Error("Program transaction failed.");
  } catch (error) {
    if (isUserRejectedError(error)) {
      throw error;
    }

    const msg = ((error as Error).message ?? "").toLowerCase();
    if (isShield && msg.includes("not in the allowed programs")) {
      throw new Error(
        `"${programId}" is not in Shield's allowed programs. Disconnect Shield, reconnect, and approve programs again.`,
      );
    }
    if (msg.includes("invalid aleo program") || msg.includes("invalid_params")) {
      throw new Error(`Wallet cannot validate "${programId}" on testnet.`);
    }

    throw new Error(
      `Program execution failed: ${(error as Error).message ?? "Program transaction failed."}. wallet=${adapterName || "unknown"} program=${programId} function=${functionName}`,
    );
  }
};

export const executeCreditsTransfer = async ({
  wallet,
  recipientAddress,
  amountMicrocredits,
  feeAleo = EXECUTION_FEE_ALEO,
  feePreference = "auto",
}: ExecuteCreditsTransferInput): Promise<string> => {
  if (!wallet.address || !wallet.address.startsWith("aleo1")) {
    throw new Error("Wallet is not connected to a valid Aleo address.");
  }
  const normalizedRecipient = recipientAddress?.trim() ?? "";
  if (!normalizedRecipient || !normalizedRecipient.startsWith("aleo1")) {
    throw new Error("Recipient wallet address is missing or invalid.");
  }

  const amountInput = toU64Literal(amountMicrocredits);
  const transferAmount = BigInt(amountInput.replace(/u64$/, ""));
  if (transferAmount <= 0n) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  const literalInputs = [normalizedRecipient, amountInput];
  const executionFeeMicrocredits = aleoToMicrocredits(feeAleo);
  const requiredPublicBalance = transferAmount + executionFeeMicrocredits;

  const submitPrivateToPublicFallback = async (): Promise<string> => {
    const record = await pickPrivateCreditsRecord(wallet, transferAmount);
    return executeProgramTransaction({
      wallet,
      programId: "credits.aleo",
      functionName: "transfer_private_to_public",
      inputs: [record.literal, normalizedRecipient, amountInput],
      feeAleo,
      feePreference,
      recordIndices: typeof record.index === "number" ? [record.index] : undefined,
    });
  };

  // Balance check
  const publicBalance = await fetchKnownPublicBalanceMicrocredits(wallet.address);
  if (publicBalance !== undefined) {
    if (publicBalance < requiredPublicBalance) {
      try {
        return await submitPrivateToPublicFallback();
      } catch (privateFallbackError) {
        throw new Error(
          `Insufficient public balance. Required at least ${microcreditsToAleoString(requiredPublicBalance)} ALEO (${requiredPublicBalance.toString()} microcredits), but wallet has ${microcreditsToAleoString(publicBalance)} ALEO public balance. Private transfer fallback also failed: ${(privateFallbackError as Error).message ?? "Unknown error."}`,
        );
      }
    }
  }

  validateLiteralInputs("credits.aleo", "transfer_public", literalInputs);

  const adapterName = getWalletAdapterName(wallet);
  const isShield = adapterName.toLowerCase().includes("shield");
  const feeMicrocreditsNumber =
    executionFeeMicrocredits <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(executionFeeMicrocredits)
      : 250000;
  const feeCandidates = isShield
    ? buildShieldPaymentFeeCandidates(feeMicrocreditsNumber, feePreference)
    : buildFeeCandidates(
      wallet,
      EXECUTION_FEE_ALEO,
      feeMicrocreditsNumber,
      feePreference,
    );
  const recordIndicesCandidates: Array<number[] | undefined> = [undefined];

  const submitWithCompatibility = async (): Promise<string> => {
    let lastAttemptError: unknown;
    for (const feeCandidate of feeCandidates) {
      for (const recordIndicesCandidate of recordIndicesCandidates) {
        try {
          const txRequest: TransactionOptions = {
            program: "credits.aleo",
            function: "transfer_public",
            inputs: literalInputs,
            fee: feeCandidate,
            privateFee: false,
            ...(recordIndicesCandidate ? { recordIndices: recordIndicesCandidate } : {}),
          };

          if (process.env.NODE_ENV !== "production" && isShield) {
            console.warn("[InnerCircle][Shield] payment attempt", txRequest);
            console.warn("[InnerCircle][Shield] payment attempt payload", JSON.stringify(txRequest));
          }

          return await requestTransactionCompat(wallet, txRequest);
        } catch (error) {
          if (isUserRejectedError(error)) {
            throw error;
          }
          lastAttemptError = error;
          if (!isRetryablePayloadFormatError(error)) {
            throw error;
          }
        }
      }
    }

    throw lastAttemptError ?? new Error("Payment transaction failed.");
  };

  let executionError: unknown;
  try {
    return await submitWithCompatibility();
  } catch (error) {
    executionError = error;
  }

  if (
    isShield &&
    isRetryablePayloadFormatError(executionError) &&
    !/invalid_params/i.test((executionError as Error)?.message ?? "") &&
    typeof wallet.disconnect === "function" &&
    typeof wallet.connect === "function"
  ) {
    try {
      await wallet.disconnect().catch(() => undefined);
      await wait(200);
      await wallet.connect(Network.TESTNET);
      return await submitWithCompatibility();
    } catch (reconnectError) {
      executionError = reconnectError;
    }
  }

  try {
    throw executionError ?? new Error("Payment transaction failed.");
  } catch (error) {
    const msg = ((error as Error).message ?? "").toLowerCase();
    if (isUserRejectedError(error)) {
      throw error;
    }

    if (
      msg.includes("insufficient public balance") ||
      msg.includes("insufficient funds") ||
      msg.includes("not enough balance")
    ) {
      try {
        return await submitPrivateToPublicFallback();
      } catch (privateFallbackError) {
        throw new Error(
          `Payment failed from public balance, and private transfer fallback also failed: ${(privateFallbackError as Error).message ?? "Unknown error."}`,
        );
      }
    }

    if (isShield && msg.includes("not in the allowed programs")) {
      throw new Error(
        `"credits.aleo" is not in Shield's allowed programs. Disconnect Shield, reconnect, and approve programs again.`,
      );
    }
    if (isShield && msg.includes("invalid transaction payload")) {
      throw new Error(
        "Shield rejected the transaction payload after compatibility retries. Disconnect/reconnect Shield so credits.aleo + app programs are re-authorized, then retry.",
      );
    }
    if (msg.includes("invalid aleo program") || msg.includes("invalid_params")) {
      const preferredWallet = isLeoWallet(wallet) ? "Shield Wallet" : "Puzzle Wallet or Leo Wallet";
      throw new Error(`Wallet cannot validate "credits.aleo" on testnet. Retry with ${preferredWallet}.`);
    }

    throw new Error(
      `Payment failed: ${(error as Error).message ?? "Payment transaction failed."}. wallet=${adapterName || "unknown"} program=credits.aleo function=transfer_public`,
    );
  }
};

interface ExecuteAnonymousTipInput {
  wallet: WalletContextState;
  creatorFieldId: string;
  creatorAddress: string;
  amountMicrocredits: string | number | bigint;
  feeAleo?: number;
  feePreference?: FeePreference;
  tipProgramId?: string;
}

export const executeAnonymousTip = async ({
  wallet,
  creatorFieldId,
  creatorAddress,
  amountMicrocredits,
  feeAleo = EXECUTION_FEE_ALEO,
  feePreference = "auto",
  tipProgramId = TIP_PROGRAM_ID,
}: ExecuteAnonymousTipInput): Promise<string> => {
  if (!creatorAddress || !creatorAddress.startsWith("aleo1")) {
    throw new Error("Creator wallet address is missing or invalid.");
  }

  const amountLiteral = toU64Literal(amountMicrocredits);
  const amountValue = BigInt(amountLiteral.replace(/u64$/i, ""));
  if (amountValue <= 0n) {
    throw new Error("Tip amount must be greater than zero.");
  }

  const record = await pickPrivateCreditsRecord(wallet, amountValue);
  const inputs = [
    toFieldLiteral(creatorFieldId),
    creatorAddress,
    amountLiteral,
    record.literal,
  ];

  return executeProgramTransaction({
    wallet,
    programId: tipProgramId,
    functionName: "tip_private_v3",
    inputs,
    feeAleo,
    feePreference,
    recordIndices: typeof record.index === "number" ? [record.index] : undefined,
  });
};

interface ProveAnonymousTipInput {
  wallet: WalletContextState;
  creatorFieldId: string;
  amountMicrocredits: string | number | bigint;
  feeAleo?: number;
  feePreference?: FeePreference;
  tipProgramId?: string;
}

export const proveAnonymousTipReceipt = async ({
  wallet,
  creatorFieldId,
  amountMicrocredits,
  feeAleo = EXECUTION_FEE_ALEO,
  feePreference = "auto",
  tipProgramId = TIP_PROGRAM_ID,
}: ProveAnonymousTipInput): Promise<string> => {
  const amountLiteral = toU64Literal(amountMicrocredits);
  const amountValue = BigInt(amountLiteral.replace(/u64$/i, ""));
  if (amountValue <= 0n) {
    throw new Error("Tip amount must be greater than zero.");
  }

  const receipt = await recoverTipReceiptRecord(wallet, tipProgramId, creatorFieldId, amountValue);

  return executeProgramTransaction({
    wallet,
    programId: tipProgramId,
    functionName: "prove_tip_v2",
    inputs: [
      receipt.literal,
      toFieldLiteral(creatorFieldId),
      amountLiteral,
    ],
    feeAleo,
    feePreference,
    recordIndices: typeof receipt.index === "number" ? [receipt.index] : undefined,
  });
};
