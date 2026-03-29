import type { WalletContextState } from "@/lib/walletContext";
import { sha256Hex } from "@/lib/crypto/hash";
import type { SubscriptionExecutionProof } from "@/lib/api";
import { verifyStoredPaymentProof } from "@/lib/api";
import {
  executeProgramTransaction,
  fetchKnownPublicBalanceMicrocredits,
  fetchLatestBlockHeight,
  waitForOnChainTransactionId,
  waitForExecutionTranscript,
  waitForTransactionFinality,
} from "@/lib/aleoTransactions";
import type { FeePreference } from "@/lib/aleoTransactions";

const PAYMENT_PROOF_PREFIX = "innercircle_payment_proof_v1:";
const SUBSCRIPTION_INVOICE_PREFIX = "innercircle_subscription_invoice_v1:";
const PENDING_SUBSCRIPTION_PREFIX = "innercircle_pending_subscription_v1:";
const PENDING_SUBSCRIPTION_PROOF_PREFIX = "innercircle_pending_subscription_proof_v1:";
const PENDING_PROOF_KEY = (contentId: string): string => `ic_pending_proof_${contentId}`;
const DONE_PROOF_KEY = (contentId: string): string => `ic_done_proof_${contentId}`;
const PAYMENT_PROOF_PROGRAM_ID =
  process.env.NEXT_PUBLIC_PAYMENT_PROOF_PROGRAM_ID?.trim() || "sub_invoice_v8_xwnxp.aleo";
const USDCX_PROGRAM_ID =
  process.env.NEXT_PUBLIC_USDCX_PROGRAM_ID?.trim() || "test_usdcx_stablecoin.aleo";
const IS_LEGACY_PAYMENT_PROOF_PROGRAM = /^sub_invoice_v2_xwnxp\.aleo$/i.test(PAYMENT_PROOF_PROGRAM_ID);
const ALEO_EXPLORER_API =
  process.env.NEXT_PUBLIC_ALEO_API?.trim() ||
  process.env.NEXT_PUBLIC_ALEO_EXPLORER_API?.trim() ||
  "https://api.explorer.provable.com/v1";
const ALEO_MAPPING_API =
  process.env.NEXT_PUBLIC_ALEO_MAPPING_API?.trim() || "https://api.provable.com/v2/testnet/program";
const DEFAULT_SUBSCRIPTION_BLOCKS = 15_000;
const MICROCREDITS_PER_ALEO = 1_000_000n;
const DEFAULT_SUBSCRIPTION_FEE_ALEO = 0.9;
const RETRYABLE_SUBSCRIPTION_FAILURE_PATTERN =
  /proving failed|program execution failed|transaction was not confirmed|status "rejected"|rejected/i;
const INSUFFICIENT_BALANCE_PATTERN = /insufficient|not enough balance|balance too low/i;
const DUPLICATE_PRIVATE_INPUT_PATTERN =
  /input id .* already exists in the ledger|already exists in the ledger/i;
const USDCX_FREEZELIST_PROGRAM_ID = "test_usdcx_freezelist.aleo";

export type SubscriptionPaymentRoute = "private_record" | "public_balance" | "private_to_public_fallback";
export type SubscriptionPaymentAsset = "ALEO_CREDITS" | "USDCX";
export type SubscriptionPaymentVisibility = "PUBLIC" | "PRIVATE";

export interface SubscriptionPaymentStatus {
  stage:
    | "selecting_route"
    | "submitting_private"
    | "funding_public_balance"
    | "submitting_public"
    | "awaiting_finality"
    | "recovering_invoice"
    | "resuming_invoice"
    | "proving_invoice"
    | "accepted"
    | "waiting_finality"
    | "fetching_proof";
  route?: SubscriptionPaymentRoute;
  asset?: SubscriptionPaymentAsset;
  transactionId?: string;
  verifyTransactionId?: string;
  phase?: "payment" | "verification";
}

export interface SubscriptionSpendability {
  requiredMicrocredits: string;
  totalPrivateMicrocredits: string;
  largestPrivateRecordMicrocredits: string;
  publicBalanceMicrocredits: string | null;
  totalPrivateRecordCount: number;
  readablePrivateRecordCount: number;
  canUsePrivateRecord: boolean;
  canUsePublicBalance: boolean;
  canUsePrivateToPublicFallback: boolean;
  recommendedRoute: SubscriptionPaymentRoute | "insufficient_balance" | "wallet_unreadable";
  summary: string;
}

export interface SubscriptionInvoiceReceipt {
  owner: string;
  circleId: string;
  expiresAt: number;
  tier: number;
  salt: string;
  invoiceRecord: string;
  nullifier: string;
  transactionId?: string;
  purchasedAt?: number;
  paymentRoute?: SubscriptionPaymentRoute;
}

interface StoredSubscriptionInvoiceReceipt {
  owner: string;
  circle_id: string;
  expires_at: number;
  tier: number;
  salt?: string;
  raw: string;
}

interface StoredSubscriptionInvoiceMeta {
  nullifier?: string;
  transactionId?: string;
  purchasedAt?: number;
  paymentRoute?: SubscriptionPaymentRoute;
}

interface PendingSubscriptionAttempt {
  circleId: string;
  expiresAt: number;
  transactionId: string;
  route: SubscriptionPaymentRoute;
  purchasedAt: number;
}

interface PendingSubscriptionProofAttempt {
  circleId: string;
  nullifier: string;
  transactionId: string;
  submittedAt: number;
}

interface PendingProofState {
  requestId: string;
  contentId: string;
  startedAt: number;
}

interface DoneProofState {
  transcript: string | null;
  txId: string;
}

interface SubscriptionTxFallbackReceipt {
  txId: string;
  circleId: string;
}

interface SubscriptionProofWorkerPayload {
  explorerApi: string;
  programId: string;
  invoiceRecord: string;
  circleId: string;
  tier: number;
  expiresAt: number;
}

interface SubscriptionProofWorkerRequest {
  id: string;
  type: "generate_subscription_proof";
  payload: SubscriptionProofWorkerPayload;
}

interface SubscriptionProofWorkerResult {
  id: string;
  type: "result";
  result: SubscriptionExecutionProof;
}

interface SubscriptionProofWorkerError {
  id: string;
  type: "error";
  error: string;
  details?: string;
}

type SubscriptionProofWorkerResponse =
  | SubscriptionProofWorkerResult
  | SubscriptionProofWorkerError;

export class SubscriptionTranscriptUnavailableError extends Error {
  readonly transactionId: string;

  constructor(
    transactionId: string,
    message = "Wallet did not expose the execution transcript for the subscription proof transaction.",
  ) {
    super(message);
    this.name = "SubscriptionTranscriptUnavailableError";
    this.transactionId = transactionId;
  }
}

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeFieldId = (value: string): string => value.trim().replace(/field$/i, "");
const toFieldLiteral = (value: string): string => `${normalizeFieldId(value)}field`;
const toU64Literal = (value: string | number | bigint): string => `${BigInt(value)}u64`;
const toU32Literal = (value: number): string => `${value}u32`;
const aleoToMicrocredits = (amount: number): bigint =>
  BigInt(Math.round(amount * Number(MICROCREDITS_PER_ALEO)));
const microcreditsToAleoString = (amount: bigint): string => {
  const whole = amount / MICROCREDITS_PER_ALEO;
  const fractional = (amount % MICROCREDITS_PER_ALEO).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional.length ? `${whole.toString()}.${fractional}` : whole.toString();
};

export const formatMicrocreditsAsCredits = (amount: bigint): string => microcreditsToAleoString(amount);

const subscriptionPaymentLocks = new Map<string, Promise<{
  invoice: SubscriptionInvoiceReceipt;
  proof: SubscriptionExecutionProof | null;
  transactionId: string;
  route: SubscriptionPaymentRoute;
  fallbackReceipt?: SubscriptionTxFallbackReceipt;
}>>();

let aleoProofWorker: Worker | null = null;
let aleoProofWorkerRequestCounter = 0;
const aleoProofWorkerPending = new Map<
  string,
  {
    resolve: (proof: SubscriptionExecutionProof) => void;
    reject: (error: Error) => void;
  }
>();

const rejectAllAleoProofWorkerRequests = (message: string): void => {
  for (const { reject } of aleoProofWorkerPending.values()) {
    reject(new Error(message));
  }
  aleoProofWorkerPending.clear();
};

const getAleoProofWorker = (): Worker => {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Browser workers are unavailable, so the Aleo prover cannot start.");
  }

  if (!aleoProofWorker) {
    aleoProofWorker = new Worker(
      new URL("../../workers/aleoProof.worker.ts", import.meta.url),
      { type: "module", name: "aleo-proof-worker" },
    );
    aleoProofWorker.onmessage = (event: MessageEvent<SubscriptionProofWorkerResponse>) => {
      const response = event.data;
      const pending = aleoProofWorkerPending.get(response.id);
      if (!pending) {
        return;
      }

      aleoProofWorkerPending.delete(response.id);
      if (response.type === "result") {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.details ? `${response.error}\n${response.details}` : response.error));
      }
    };
    aleoProofWorker.onerror = () => {
      rejectAllAleoProofWorkerRequests(
        "Aleo proof worker crashed before the prover finished initialization.",
      );
      aleoProofWorker?.terminate();
      aleoProofWorker = null;
    };
  }

  return aleoProofWorker;
};

const generateSubscriptionProofInWorker = (
  payload: SubscriptionProofWorkerPayload,
): Promise<SubscriptionExecutionProof> => {
  const worker = getAleoProofWorker();
  const id = `sub-proof-${Date.now()}-${aleoProofWorkerRequestCounter++}`;

  return new Promise<SubscriptionExecutionProof>((resolve, reject) => {
    aleoProofWorkerPending.set(id, {
      resolve,
      reject: (error) => {
        reject(error);
      },
    });

    const request: SubscriptionProofWorkerRequest = {
      id,
      type: "generate_subscription_proof",
      payload,
    };

    worker.postMessage(request);
  });
};

const isUserRejectedError = (error: unknown): boolean => {
  const message = (error as Error)?.message ?? "";
  return /user/i.test(message) && /reject|denied|cancel|declined/.test(message);
};

const isRetryableSubscriptionFailure = (error: unknown): boolean =>
  RETRYABLE_SUBSCRIPTION_FAILURE_PATTERN.test((error as Error)?.message ?? "");

const normalizeSubscriptionExecutionError = (
  error: unknown,
  amountMicrocredits: bigint,
  feeAleo = DEFAULT_SUBSCRIPTION_FEE_ALEO,
): Error => {
  if (error instanceof Error) {
    const message = error.message ?? "";
    if (/transaction proving failed/i.test(message)) {
      return error;
    }
    if (isRetryableSubscriptionFailure(error)) {
      return new Error(
        `Transaction proving failed. This usually means your wallet could not spend a single private credits record large enough for ${microcreditsToAleoString(amountMicrocredits)} credits. Fee is now paid from public balance, so one private record is sufficient for the subscription amount, plus at least ${microcreditsToAleoString(aleoToMicrocredits(feeAleo))} public credits for the fee.`,
      );
    }
    if (INSUFFICIENT_BALANCE_PATTERN.test(message)) {
      return new Error("Insufficient balance. Please check your private credits and public fee balance.");
    }
    return error;
  }

  return new Error("Subscription transaction failed.");
};

const hasEnoughPublicBalanceForFee = (
  publicBalance: bigint | undefined,
  feeAleo = DEFAULT_SUBSCRIPTION_FEE_ALEO,
): boolean => publicBalance === undefined || publicBalance >= aleoToMicrocredits(feeAleo);

const hasEnoughPublicBalanceForPublicPayment = (
  publicBalance: bigint | undefined,
  amountMicrocredits: bigint,
  feeAleo = DEFAULT_SUBSCRIPTION_FEE_ALEO,
): boolean => publicBalance !== undefined && publicBalance >= amountMicrocredits + aleoToMicrocredits(feeAleo);

const SUBSCRIPTION_PAYMENT_ROUTES = new Set<SubscriptionPaymentRoute>([
  "private_record",
  "public_balance",
  "private_to_public_fallback",
]);

const isSubscriptionPaymentRoute = (value: unknown): value is SubscriptionPaymentRoute =>
  typeof value === "string" && SUBSCRIPTION_PAYMENT_ROUTES.has(value as SubscriptionPaymentRoute);

export const describeSubscriptionPaymentRoute = (route: SubscriptionPaymentRoute): string => {
  switch (route) {
    case "private_record":
      return "Private record payment";
    case "public_balance":
      return "Public balance payment";
    case "private_to_public_fallback":
      return "Shield compatibility fallback";
    default:
      return "Invoice payment";
  }
};

const isShieldWallet = (wallet: WalletContextState): boolean =>
  String(wallet.wallet?.adapter?.name ?? "").trim().toLowerCase().includes("shield");

const isDuplicatePrivateInputError = (error: unknown): boolean =>
  DUPLICATE_PRIVATE_INPUT_PATTERN.test((error as Error)?.message ?? "");

const getFreezeListIndex = async (index: number): Promise<string | null> => {
  try {
    const response = await fetch(
      `${ALEO_MAPPING_API}/${USDCX_FREEZELIST_PROGRAM_ID}/mapping/freeze_list_index/${index}u32`,
    );
    if (!response.ok) return null;
    const value = await response.json();
    return value ? String(value).replace(/['"]/g, "") : null;
  } catch {
    return null;
  }
};

const generateFreezeListProof = async (targetIndex = 1, occupiedLeafValue?: string): Promise<string> => {
  const { Poseidon4, Field, Address } = await import("@provablehq/wasm");
  const hasher = new Poseidon4();
  const emptyHashes: string[] = [];
  let currentEmpty = "0field";

  for (let level = 0; level < 16; level += 1) {
    emptyHashes.push(currentEmpty);
    const field = Field.fromString(currentEmpty);
    currentEmpty = hasher.hash([field, field]).toString();
  }

  let leafValue = occupiedLeafValue;
  if (!leafValue) {
    const firstIndex = await getFreezeListIndex(0);
    if (firstIndex) {
      try {
        leafValue = Address.from_string(firstIndex).toGroup().toXCoordinate().toString();
      } catch {
        leafValue = undefined;
      }
    }
  }

  let currentHash = "0field";
  let currentIndex = targetIndex;
  const proofSiblings: string[] = [];

  for (let level = 0; level < 16; level += 1) {
    const isLeft = currentIndex % 2 === 0;
    const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
    let siblingHash = emptyHashes[level];

    if (level === 0 && siblingIndex === 0 && leafValue) {
      siblingHash = leafValue;
    }

    proofSiblings.push(siblingHash);
    const currentField = Field.fromString(currentHash);
    const siblingField = Field.fromString(siblingHash);
    currentHash = hasher.hash(isLeft ? [currentField, siblingField] : [siblingField, currentField]).toString();
    currentIndex = Math.floor(currentIndex / 2);
  }

  return `[${proofSiblings.join(", ")}]`;
};

const toSafeBlockNumber = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Aleo block height exceeds JavaScript safe integer precision.");
  }
  return Number(value);
};

const createRandomSaltField = (): string => {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Browser crypto is unavailable for subscription salt generation.");
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  const fieldSafeValue = value & ((1n << 248n) - 1n);
  return `${fieldSafeValue.toString()}field`;
};

const looksLikeRecordLiteral = (value: string): boolean =>
  /\{\s*owner:\s*aleo1/i.test(value) ||
  (/owner:\s*aleo1/i.test(value) && /(u64|u32|u8)/i.test(value));

const looksLikePrivateCreditsRecordLiteral = (value: string): boolean =>
  /owner:\s*aleo1/i.test(value) && /microcredits:\s*[0-9]+u64/i.test(value);

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

const findRecordLiteralByPredicate = (
  record: unknown,
  predicate: (candidate: string) => boolean,
): string | undefined => {
  if (typeof record === "string") {
    const trimmed = record.trim();
    return trimmed && predicate(trimmed) ? trimmed : undefined;
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
    "ciphertext",
  ];

  for (const key of preferredKeys) {
    if (!(key in obj)) continue;
    const found = findNestedString(obj[key], predicate, 1);
    if (found) return found;
  }

  return findNestedString(record, predicate, 1);
};

const extractRecordLiteral = (record: unknown): string | undefined =>
  findRecordLiteralByPredicate(record, looksLikeRecordLiteral);

const extractPrivateCreditsRecordLiteral = (record: unknown): string | undefined =>
  findRecordLiteralByPredicate(record, looksLikePrivateCreditsRecordLiteral);

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

    if (keyHint && MICROCREDIT_KEY_HINTS.has(keyHint.toLowerCase())) {
      const withU64 = /^([0-9]+)u64$/i.exec(trimmed);
      if (withU64) return BigInt(withU64[1]);
      if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
    }

    const literalMatch = /([0-9]+)u64/i.exec(trimmed);
    if (literalMatch) return BigInt(literalMatch[1]);
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

    for (const [key, nested] of entries) {
      const parsed = parseMicrocreditsValue(nested, depth + 1, key);
      if (parsed !== undefined) return parsed;
    }

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

const parsePrivateRecordNonce = (literal: string): string | undefined => {
  const match = literal.match(/_nonce:\s*([^,\n}]+)/i);
  return match?.[1]?.trim();
};

const parseU128Value = (
  value: unknown,
  depth = 0,
  keyHint?: string,
): bigint | undefined => {
  if (depth > 8 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    if (keyHint && /amount|value|balance/i.test(keyHint)) {
      const direct = /^([0-9]+)u128$/i.exec(trimmed);
      if (direct) return BigInt(direct[1]);
      if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
    }

    const match = /([0-9]+)u128/i.exec(trimmed);
    return match ? BigInt(match[1]) : undefined;
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
      const parsed = parseU128Value(item, depth + 1, keyHint);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const parsed = parseU128Value(nested, depth + 1, key);
      if (parsed !== undefined) return parsed;
    }
  }

  return undefined;
};

const parseU128FromRecordLiteral = (literal: string): bigint | undefined => {
  const match = literal.match(/amount:\s*([0-9_]+)u128/i);
  return match ? BigInt(match[1].replace(/_/g, "")) : undefined;
};

const looksLikePrivateTokenRecordLiteral = (value: string): boolean =>
  /owner:\s*aleo1/i.test(value) && /amount:\s*[0-9_]+u128/i.test(value);

const extractPrivateTokenRecordLiteral = (record: unknown): string | undefined =>
  findRecordLiteralByPredicate(record, looksLikePrivateTokenRecordLiteral);

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

const fetchFreshProgramRecords = async (
  wallet: WalletContextState,
  programId: string,
  decrypt = true,
): Promise<unknown[]> => {
  if (typeof wallet.requestProgramRecords === "function") {
    const records = await wallet.requestProgramRecords(programId, decrypt);
    return Array.isArray(records) ? records : [];
  }

  if (typeof wallet.requestRecordPlaintexts === "function" && decrypt) {
    const records = await wallet.requestRecordPlaintexts(programId);
    return Array.isArray(records) ? records : [];
  }

  throw new Error("Wallet does not support fetching private records for this payment flow.");
};

const parseSubscriptionInvoiceRecord = (
  invoiceRecord: string,
): Pick<SubscriptionInvoiceReceipt, "owner" | "circleId" | "expiresAt" | "tier" | "salt" | "invoiceRecord"> => {
  const ownerMatch = invoiceRecord.match(/owner:\s*(aleo1[0-9a-z]+)(?:\.private)?/i);
  const circleMatch = invoiceRecord.match(/circle_id:\s*([0-9a-z]+)field(?:\.private)?/i);
  const expiresAtMatch = invoiceRecord.match(/expires_at:\s*(\d+)u32(?:\.private)?/i);
  const tierMatch = invoiceRecord.match(/tier:\s*(\d+)u8(?:\.private)?/i);
  const saltMatch = invoiceRecord.match(/salt:\s*([0-9]+field)(?:\.private)?/i);

  if (!ownerMatch || !circleMatch || !expiresAtMatch || !tierMatch || !saltMatch) {
    throw new Error("Unable to parse the SubscriptionInvoice record returned by the wallet.");
  }

  return {
    owner: ownerMatch[1],
    circleId: circleMatch[1],
    expiresAt: Number.parseInt(expiresAtMatch[1], 10),
    tier: Number.parseInt(tierMatch[1], 10),
    salt: saltMatch[1],
    invoiceRecord,
  };
};

/**
 * Derives the invoice nullifier using the same BHP256 replay-key hash the Aleo
 * contract uses in `invoice_nullifier`.
 */
export const computeSubscriptionNullifier = async (invoiceRecord: string): Promise<string> => {
  const parsed = parseSubscriptionInvoiceRecord(invoiceRecord);
  const { BHP256, Plaintext } = await import("@provablehq/wasm");
  const replayKeyPlaintext = Plaintext.fromString(
    `{
      invoice_owner: ${parsed.owner.trim().toLowerCase()},
      circle_id: ${toFieldLiteral(parsed.circleId)},
      expires_at: ${parsed.expiresAt}u32,
      salt: ${toFieldLiteral(parsed.salt)}
    }`,
  );
  const hasher = new BHP256();
  return hasher.hash(replayKeyPlaintext.toBitsLe()).toString();
};

const tryParseStoredReceiptMeta = (raw: string | null): StoredSubscriptionInvoiceMeta | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSubscriptionInvoiceMeta>;
    return {
      nullifier: typeof parsed.nullifier === "string" ? parsed.nullifier : undefined,
      transactionId: typeof parsed.transactionId === "string" ? parsed.transactionId : undefined,
      purchasedAt: typeof parsed.purchasedAt === "number" ? parsed.purchasedAt : undefined,
      paymentRoute: isSubscriptionPaymentRoute(parsed.paymentRoute) ? parsed.paymentRoute : undefined,
    };
  } catch {
    return null;
  }
};

const parseStoredReceipt = (
  raw: string | null,
  metaRaw: string | null,
): SubscriptionInvoiceReceipt | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSubscriptionInvoiceReceipt> & Record<string, unknown>;
    const owner = typeof parsed.owner === "string" ? parsed.owner : undefined;
    const circleId =
      typeof parsed.circle_id === "string"
        ? parsed.circle_id
        : typeof parsed.circleId === "string"
          ? parsed.circleId
          : undefined;
    const expiresAt =
      typeof parsed.expires_at === "number"
        ? parsed.expires_at
        : typeof parsed.expiresAt === "number"
          ? parsed.expiresAt
          : undefined;
    const tier = typeof parsed.tier === "number" ? parsed.tier : undefined;
    const parsedRecordSalt =
      typeof parsed.raw === "string"
        ? parseSubscriptionInvoiceRecord(parsed.raw).salt
        : undefined;
    const salt =
      typeof parsed.salt === "string"
        ? parsed.salt
        : parsedRecordSalt;
    const invoiceRecord =
      typeof parsed.raw === "string"
        ? parsed.raw
        : typeof parsed.invoiceRecord === "string"
          ? parsed.invoiceRecord
          : undefined;
    const meta = tryParseStoredReceiptMeta(metaRaw);
    const nullifier =
      meta?.nullifier ??
      (typeof parsed.nullifier === "string" ? parsed.nullifier : undefined);

    if (
      typeof owner !== "string" ||
      typeof circleId !== "string" ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      typeof tier !== "number" ||
      !Number.isFinite(tier) ||
      typeof salt !== "string" ||
      typeof invoiceRecord !== "string" ||
      typeof nullifier !== "string"
    ) {
      return null;
    }

    return {
      owner,
      circleId: normalizeFieldId(circleId),
      expiresAt,
      tier,
      salt,
      invoiceRecord,
      nullifier,
      transactionId:
        meta?.transactionId ??
        (typeof parsed.transactionId === "string" ? parsed.transactionId : undefined),
      purchasedAt:
        meta?.purchasedAt ??
        (typeof parsed.purchasedAt === "number" ? parsed.purchasedAt : undefined),
      paymentRoute:
        meta?.paymentRoute ??
        (isSubscriptionPaymentRoute(parsed.paymentRoute) ? parsed.paymentRoute : undefined),
    };
  } catch {
    return null;
  }
};

const synthesizeReceipt = async (
  invoiceRecord: string,
  transactionId?: string,
): Promise<SubscriptionInvoiceReceipt> => {
  const parsed = parseSubscriptionInvoiceRecord(invoiceRecord);
  return {
    ...parsed,
    nullifier: await computeSubscriptionNullifier(invoiceRecord),
    transactionId,
    purchasedAt: Date.now(),
  };
};

interface PrivateCreditsRecordCandidate {
  literal: string;
  balance?: bigint;
  index: number;
}

interface PrivateCreditsScanResult {
  candidates: PrivateCreditsRecordCandidate[];
  totalRecordCount: number;
  readableRecordCount: number;
  totalPrivateBalance: bigint;
  largestPrivateRecord: bigint;
}

interface PrivateTokenRecordCandidate {
  literal: string;
  amount?: bigint;
  index: number;
}

interface PrivateTokenScanResult {
  candidates: PrivateTokenRecordCandidate[];
  totalRecordCount: number;
  readableRecordCount: number;
  totalPrivateBalance: bigint;
  largestPrivateRecord: bigint;
}

const createSplitPrivateCreditsMessage = (
  scan: PrivateCreditsScanResult,
  minMicrocredits: bigint,
): string =>
  `Your credits are split across multiple records. Please consolidate them first by sending your full balance to yourself in one transaction. Required ${microcreditsToAleoString(minMicrocredits)} credits, largest record ${microcreditsToAleoString(scan.largestPrivateRecord)} credits, total private balance ${microcreditsToAleoString(scan.totalPrivateBalance)} credits.`;

const findSpendablePrivateCreditsRecord = (
  scan: PrivateCreditsScanResult,
  minMicrocredits: bigint,
  excludeLiteral?: string,
): { literal: string; index?: number; balance?: bigint } | null => {
  for (const candidate of scan.candidates) {
    if (excludeLiteral && candidate.literal.trim() === excludeLiteral.trim()) {
      continue;
    }
    if (typeof candidate.balance === "bigint" && candidate.balance >= minMicrocredits) {
      return { literal: candidate.literal, index: candidate.index, balance: candidate.balance };
    }
  }

  return null;
};

const createPrivateCreditsSelectionError = (
  scan: PrivateCreditsScanResult,
  minMicrocredits: bigint,
): Error => {
  if (scan.totalRecordCount === 0) {
    return new Error("No private credits records found for the subscription payment.");
  }

  if (scan.readableRecordCount === 0) {
    return new Error("Private credits records were found, but the wallet did not expose a readable balance for them.");
  }

  if (scan.candidates.length === 0) {
    return new Error("Private credits records were found, but the wallet did not expose a decrypted record literal for them.");
  }

  if (scan.totalPrivateBalance >= minMicrocredits && scan.largestPrivateRecord < minMicrocredits) {
    return new Error(createSplitPrivateCreditsMessage(scan, minMicrocredits));
  }

  return new Error(
    `No single private credits record is large enough for this subscription payment. Required ${microcreditsToAleoString(minMicrocredits)} credits, largest record ${microcreditsToAleoString(scan.largestPrivateRecord)} credits, total private balance ${microcreditsToAleoString(scan.totalPrivateBalance)} credits.`,
  );
};

const validatePrivateCreditsRecordBalance = (
  record: { literal: string; balance?: bigint },
  minMicrocredits: bigint,
): void => {
  const balance = parsePrivateCreditsBalance(record, record.literal) ?? record.balance;

  if (balance === undefined) {
    throw new Error("Wallet returned a private credits record without a readable microcredits balance.");
  }

  if (balance === 0n) {
    throw new Error("Wallet selected an empty private credits record. Switch to public mode or consolidate your credits first.");
  }

  if (balance < minMicrocredits) {
    throw new Error(
      `Selected private credits record only contains ${microcreditsToAleoString(balance)} credits. You need a single record with at least ${microcreditsToAleoString(minMicrocredits)} credits for private subscription mode.`,
    );
  }
};

const scanPrivateCreditsRecords = async (wallet: WalletContextState): Promise<PrivateCreditsScanResult> => {
  const records = await fetchFreshProgramRecords(wallet, "credits.aleo", true);
  if (!Array.isArray(records) || records.length === 0) {
    return {
      candidates: [],
      totalRecordCount: 0,
      readableRecordCount: 0,
      totalPrivateBalance: 0n,
      largestPrivateRecord: 0n,
    };
  }

  const candidates: PrivateCreditsRecordCandidate[] = [];
  let readableRecordCount = 0;
  let totalPrivateBalance = 0n;
  let largestPrivateRecord = 0n;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (isRecordSpent(record)) continue;
    const literal = extractPrivateCreditsRecordLiteral(record);
    const balance = parsePrivateCreditsBalance(record, literal);

    if (typeof balance === "bigint") {
      readableRecordCount += 1;
      totalPrivateBalance += balance;
      if (balance > largestPrivateRecord) {
        largestPrivateRecord = balance;
      }
    }

    if (literal) {
      candidates.push({ literal, balance, index: i });
    }
  }

  candidates.sort((left, right) => {
    const leftBalance = typeof left.balance === "bigint" ? left.balance : -1n;
    const rightBalance = typeof right.balance === "bigint" ? right.balance : -1n;
    if (leftBalance === rightBalance) {
      return left.index - right.index;
    }
    return rightBalance > leftBalance ? 1 : -1;
  });

  return {
    candidates,
    totalRecordCount: records.filter((record) => !isRecordSpent(record)).length,
    readableRecordCount,
    totalPrivateBalance,
    largestPrivateRecord,
  };
};

const findSpendablePrivateTokenRecord = (
  scan: PrivateTokenScanResult,
  minAmount: bigint,
  excludeLiteral?: string,
): { literal: string; index?: number } | null => {
  for (const candidate of scan.candidates) {
    if (excludeLiteral && candidate.literal.trim() === excludeLiteral.trim()) {
      continue;
    }
    if (typeof candidate.amount === "bigint" && candidate.amount >= minAmount) {
      return { literal: candidate.literal, index: candidate.index };
    }
  }

  return null;
};

const createPrivateTokenSelectionError = (
  scan: PrivateTokenScanResult,
  minAmount: bigint,
): Error => {
  if (scan.totalRecordCount === 0) {
    return new Error("No unspent private USDCx records were found for the subscription payment.");
  }

  if (scan.readableRecordCount === 0) {
    return new Error("USDCx records were found, but the wallet did not expose readable balances for them.");
  }

  if (scan.candidates.length === 0) {
    return new Error("USDCx records were found, but the wallet did not expose decrypted record literals for them.");
  }

  return new Error(
    `No single private USDCx record is large enough for this subscription payment. Required ${minAmount.toString()} subunits, largest record ${scan.largestPrivateRecord.toString()} subunits, total private balance ${scan.totalPrivateBalance.toString()} subunits.`,
  );
};

const scanPrivateTokenRecords = async (
  wallet: WalletContextState,
  programId: string,
): Promise<PrivateTokenScanResult> => {
  const records = await fetchFreshProgramRecords(wallet, programId, true);
  if (!Array.isArray(records) || records.length === 0) {
    return {
      candidates: [],
      totalRecordCount: 0,
      readableRecordCount: 0,
      totalPrivateBalance: 0n,
      largestPrivateRecord: 0n,
    };
  }

  const candidates: PrivateTokenRecordCandidate[] = [];
  let readableRecordCount = 0;
  let totalPrivateBalance = 0n;
  let largestPrivateRecord = 0n;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (isRecordSpent(record)) continue;
    const literal = extractPrivateTokenRecordLiteral(record);
    const amount =
      parseU128Value(record) ??
      (typeof literal === "string" ? parseU128FromRecordLiteral(literal) : undefined);

    if (typeof amount === "bigint") {
      readableRecordCount += 1;
      totalPrivateBalance += amount;
      if (amount > largestPrivateRecord) {
        largestPrivateRecord = amount;
      }
    }

    if (literal) {
      candidates.push({ literal, amount, index: i });
    }
  }

  return {
    candidates,
    totalRecordCount: records.filter((record) => !isRecordSpent(record)).length,
    readableRecordCount,
    totalPrivateBalance,
    largestPrivateRecord,
  };
};

const pickPrivateTokenRecord = async (
  wallet: WalletContextState,
  programId: string,
  minAmount: bigint,
  excludeLiteral?: string,
): Promise<{ literal: string; index?: number }> => {
  const scan = await scanPrivateTokenRecords(wallet, programId);
  const selected = findSpendablePrivateTokenRecord(scan, minAmount, excludeLiteral);
  if (selected) {
    return selected;
  }

  throw createPrivateTokenSelectionError(scan, minAmount);
};

/**
 * Inspects private credits records and public balance so the UI can explain which subscription path is available.
 */
export const analyzeSubscriptionSpendability = async (
  wallet: WalletContextState,
  amountMicrocredits: string | number | bigint,
): Promise<SubscriptionSpendability> => {
  const required = BigInt(amountMicrocredits);
  const publicBalance = wallet.address ? await fetchKnownPublicBalanceMicrocredits(wallet.address) : undefined;

  let scan: PrivateCreditsScanResult;
  try {
    scan = await scanPrivateCreditsRecords(wallet);
  } catch {
    scan = {
      candidates: [],
      totalRecordCount: 0,
      readableRecordCount: 0,
      totalPrivateBalance: 0n,
      largestPrivateRecord: 0n,
    };
  }

  const hasPrivateRecordForAmount = scan.candidates.some(
    (candidate) => typeof candidate.balance === "bigint" && candidate.balance >= required,
  );
  const hasEnoughPublicFeeBalance = hasEnoughPublicBalanceForFee(publicBalance, DEFAULT_SUBSCRIPTION_FEE_ALEO);
  const canUsePrivateRecord = hasPrivateRecordForAmount && hasEnoughPublicFeeBalance;
  const canUsePublicBalance = hasEnoughPublicBalanceForPublicPayment(
    publicBalance,
    required,
    DEFAULT_SUBSCRIPTION_FEE_ALEO,
  );
  const canUsePrivateToPublicFallback = false;

  let recommendedRoute: SubscriptionSpendability["recommendedRoute"];
  let summary: string;

  if (canUsePublicBalance) {
    recommendedRoute = "public_balance";
    summary = hasPrivateRecordForAmount
      ? "Public balance payment is the default route for reliable proving. A private record is also available as an advanced path."
      : "Public balance payment is ready and is the default route for reliable proving.";
  } else if (canUsePrivateRecord) {
    recommendedRoute = "private_record";
    summary = "Public balance cannot cover the full payment right now, but one private record is large enough for the subscription amount. This private path is kept as an advanced fallback.";
  } else if (hasPrivateRecordForAmount && !hasEnoughPublicFeeBalance) {
    recommendedRoute = "insufficient_balance";
    summary = `A private record can cover the subscription, but public balance is below the ${microcreditsToAleoString(aleoToMicrocredits(DEFAULT_SUBSCRIPTION_FEE_ALEO))} credit network fee. Top up public credits and retry.`;
  } else if (scan.totalRecordCount > 0 && scan.readableRecordCount === 0) {
    recommendedRoute = "wallet_unreadable";
    summary = "Private credits records were found, but the wallet did not expose readable balances for them.";
  } else if (scan.readableRecordCount > 0 && scan.candidates.length === 0) {
    recommendedRoute = "wallet_unreadable";
    summary = "Private credits records were found, but the wallet did not expose decrypted record literals for them.";
  } else if (scan.totalPrivateBalance >= required && scan.largestPrivateRecord < required) {
    recommendedRoute = "insufficient_balance";
    summary = createSplitPrivateCreditsMessage(scan, required);
  } else {
    recommendedRoute = "insufficient_balance";
    summary = "Neither a single private record nor public balance currently covers this subscription flow.";
  }

  return {
    requiredMicrocredits: required.toString(),
    totalPrivateMicrocredits: scan.totalPrivateBalance.toString(),
    largestPrivateRecordMicrocredits: scan.largestPrivateRecord.toString(),
    publicBalanceMicrocredits: publicBalance?.toString() ?? null,
    totalPrivateRecordCount: scan.totalRecordCount,
    readablePrivateRecordCount: scan.readableRecordCount,
    canUsePrivateRecord,
    canUsePublicBalance,
    canUsePrivateToPublicFallback,
    recommendedRoute,
    summary,
  };
};

const pickPrivateCreditsRecord = async (
  wallet: WalletContextState,
  minMicrocredits: bigint,
  excludeLiteral?: string,
): Promise<{ literal: string; index?: number; balance?: bigint }> => {
  const scan = await scanPrivateCreditsRecords(wallet);
  const selected = findSpendablePrivateCreditsRecord(scan, minMicrocredits, excludeLiteral);
  if (selected) {
    return selected;
  }

  throw createPrivateCreditsSelectionError(scan, minMicrocredits);
};

const findLatestSubscriptionInvoice = async (
  wallet: WalletContextState,
  circleId: string,
  expectedExpiresAt?: number,
): Promise<SubscriptionInvoiceReceipt | null> => {
  const records = await fetchFreshProgramRecords(wallet, PAYMENT_PROOF_PROGRAM_ID, true).catch(() => []);
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  let latest: SubscriptionInvoiceReceipt | null = null;
  for (const record of records) {
    const literal = extractRecordLiteral(record);
    if (!literal) continue;

    try {
      const receipt = await synthesizeReceipt(literal);
      if (normalizeFieldId(receipt.circleId) !== normalizeFieldId(circleId)) continue;
      if (typeof expectedExpiresAt === "number" && receipt.expiresAt !== expectedExpiresAt) continue;
      if (!latest || receipt.expiresAt > latest.expiresAt) {
        latest = receipt;
      }
    } catch {
      // Ignore unrelated records returned by the wallet.
    }
  }

  return latest;
};

const getSubscriptionInvoiceStorageKey = (circleId: string): string =>
  `${SUBSCRIPTION_INVOICE_PREFIX}${normalizeFieldId(circleId)}`;

const getSubscriptionInvoiceMetaStorageKey = (circleId: string): string =>
  `${getSubscriptionInvoiceStorageKey(circleId)}:meta`;

const getPendingSubscriptionStorageKey = (circleId: string): string =>
  `${PENDING_SUBSCRIPTION_PREFIX}${normalizeFieldId(circleId)}`;

const getPendingSubscriptionProofStorageKey = (circleId: string): string =>
  `${PENDING_SUBSCRIPTION_PROOF_PREFIX}${normalizeFieldId(circleId)}`;

const readPendingSubscriptionAttempt = (circleId: string): PendingSubscriptionAttempt | null => {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(getPendingSubscriptionStorageKey(circleId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingSubscriptionAttempt>;
    if (
      typeof parsed.circleId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.transactionId !== "string" ||
      typeof parsed.route !== "string" ||
      typeof parsed.purchasedAt !== "number" ||
      !isSubscriptionPaymentRoute(parsed.route)
    ) {
      return null;
    }

    return {
      circleId: normalizeFieldId(parsed.circleId),
      expiresAt: parsed.expiresAt,
      transactionId: parsed.transactionId,
      route: parsed.route,
      purchasedAt: parsed.purchasedAt,
    };
  } catch {
    return null;
  }
};

const storePendingSubscriptionAttempt = (circleId: string, attempt: PendingSubscriptionAttempt): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(getPendingSubscriptionStorageKey(circleId), JSON.stringify({
    ...attempt,
    circleId: normalizeFieldId(circleId),
  }));
};

const clearPendingSubscriptionAttempt = (circleId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(getPendingSubscriptionStorageKey(circleId));
};

const readPendingSubscriptionProofAttempt = (circleId: string): PendingSubscriptionProofAttempt | null => {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(getPendingSubscriptionProofStorageKey(circleId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingSubscriptionProofAttempt>;
    if (
      typeof parsed.circleId !== "string" ||
      typeof parsed.nullifier !== "string" ||
      typeof parsed.transactionId !== "string" ||
      typeof parsed.submittedAt !== "number"
    ) {
      return null;
    }

    return {
      circleId: normalizeFieldId(parsed.circleId),
      nullifier: parsed.nullifier,
      transactionId: parsed.transactionId,
      submittedAt: parsed.submittedAt,
    };
  } catch {
    return null;
  }
};

const storePendingSubscriptionProofAttempt = (
  circleId: string,
  attempt: PendingSubscriptionProofAttempt,
): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(getPendingSubscriptionProofStorageKey(circleId), JSON.stringify({
    ...attempt,
    circleId: normalizeFieldId(circleId),
  }));
};

const clearPendingSubscriptionProofAttempt = (circleId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(getPendingSubscriptionProofStorageKey(circleId));
};

export const savePendingProof = (contentId: string, requestId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PENDING_PROOF_KEY(contentId), JSON.stringify({
    requestId,
    contentId,
    startedAt: Date.now(),
  }));
};

export const getPendingProof = (contentId: string): PendingProofState | null => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(PENDING_PROOF_KEY(contentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingProofState>;
    if (
      typeof parsed.requestId !== "string" ||
      typeof parsed.contentId !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }

    return {
      requestId: parsed.requestId,
      contentId: parsed.contentId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
};

export const clearPendingProof = (contentId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_PROOF_KEY(contentId));
};

export const saveDoneProof = (contentId: string, transcript: string | null, txId: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(DONE_PROOF_KEY(contentId), JSON.stringify({
    transcript,
    txId,
    doneAt: Date.now(),
  }));
  clearPendingProof(contentId);
};

export const getDoneProof = (contentId: string): DoneProofState | null => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(DONE_PROOF_KEY(contentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DoneProofState>;
    if (
      parsed.transcript !== null &&
      typeof parsed.transcript !== "string"
    ) {
      return null;
    }
    if (typeof parsed.txId !== "string") {
      return null;
    }

    return {
      transcript: parsed.transcript ?? null,
      txId: parsed.txId,
    };
  } catch {
    return null;
  }
};

const handleTranscriptFallback = async (
  txId: string,
  circleId: string,
): Promise<SubscriptionTxFallbackReceipt> => {
  await waitForTransactionFinality(txId);
  return {
    txId,
    circleId: normalizeFieldId(circleId),
  };
};

const recoverPendingSubscriptionInvoice = async (
  wallet: WalletContextState,
  circleId: string,
  expectedExpiresAt: number,
  options?: {
    attempts?: number;
    delayMs?: number;
    onAttempt?: () => void;
  },
): Promise<SubscriptionInvoiceReceipt | null> => {
  const attempts = options?.attempts ?? 60;
  const delayMs = options?.delayMs ?? 2_000;

  let invoice = await findLatestSubscriptionInvoice(wallet, circleId, expectedExpiresAt);
  for (let attempt = 0; !invoice && attempt < attempts; attempt += 1) {
    options?.onAttempt?.();
    await wait(delayMs);
    invoice = await findLatestSubscriptionInvoice(wallet, circleId, expectedExpiresAt);
  }

  return invoice;
};

/**
 * Stores a private subscription invoice receipt in localStorage.
 */
export const storeSubscriptionInvoiceReceipt = (circleId: string, receipt: SubscriptionInvoiceReceipt): void => {
  const storage = getStorage();
  if (!storage) return;

  const invoiceToStore: StoredSubscriptionInvoiceReceipt = {
    owner: receipt.owner,
    circle_id: normalizeFieldId(receipt.circleId),
    expires_at: receipt.expiresAt,
    tier: receipt.tier,
    salt: receipt.salt,
    raw: receipt.invoiceRecord,
  };

  const metaToStore: StoredSubscriptionInvoiceMeta = {
    nullifier: receipt.nullifier,
    transactionId: receipt.transactionId,
    purchasedAt: receipt.purchasedAt,
    paymentRoute: receipt.paymentRoute,
  };

  storage.setItem(getSubscriptionInvoiceStorageKey(circleId), JSON.stringify(invoiceToStore));
  storage.setItem(getSubscriptionInvoiceMetaStorageKey(circleId), JSON.stringify(metaToStore));
};

/**
 * Reads the locally cached subscription invoice receipt for a creator circle.
 */
export const readSubscriptionInvoiceReceipt = (circleId: string): SubscriptionInvoiceReceipt | null => {
  const storage = getStorage();
  if (!storage) return null;
  return parseStoredReceipt(
    storage.getItem(getSubscriptionInvoiceStorageKey(circleId)),
    storage.getItem(getSubscriptionInvoiceMetaStorageKey(circleId)),
  );
};

export const listStoredSubscriptionInvoiceReceipts = (): SubscriptionInvoiceReceipt[] => {
  const storage = getStorage();
  if (!storage) return [];

  const receipts: SubscriptionInvoiceReceipt[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(SUBSCRIPTION_INVOICE_PREFIX) || key.endsWith(":meta")) {
      continue;
    }

    const parsed = parseStoredReceipt(storage.getItem(key), storage.getItem(`${key}:meta`));
    if (parsed) {
      receipts.push(parsed);
    }
  }

  return receipts;
};

/**
 * Recovers the latest subscription invoice receipt for a creator circle directly from the connected wallet.
 */
export const recoverLatestSubscriptionInvoiceReceipt = async (
  wallet: WalletContextState,
  circleId: string,
): Promise<SubscriptionInvoiceReceipt | null> => {
  return findLatestSubscriptionInvoice(wallet, normalizeFieldId(circleId));
};

/**
 * Generates a fresh Aleo execution proof for verify_subscription through the connected wallet
 * without sending the private invoice record to the backend.
 */
export const generateSubscriptionProof = async (
  wallet: WalletContextState,
  invoice: SubscriptionInvoiceReceipt,
  circleId: string,
  options?: {
    contentId?: string;
    signerAddress?: string;
    onStatus?: (status: "accepted" | "waiting_finality" | "fetching_proof", transactionId?: string) => void;
  },
): Promise<{ proof: SubscriptionExecutionProof; transactionId: string }> => {
  const normalizedCircleId = normalizeFieldId(circleId);
  if (normalizeFieldId(invoice.circleId) !== normalizedCircleId) {
    throw new Error("The stored invoice receipt does not belong to the requested creator circle.");
  }
  const signerAddress = options?.signerAddress?.trim().toLowerCase() ?? wallet.address?.trim().toLowerCase();
  if (!signerAddress || !signerAddress.startsWith("aleo1")) {
    throw new Error("Connect the Aleo wallet that owns the private subscription invoice.");
  }
  if (!wallet.address || wallet.address.trim().toLowerCase() !== signerAddress) {
    throw new Error("SIGNER_CHANGED");
  }
  if (invoice.owner.trim().toLowerCase() !== signerAddress) {
    throw new Error(
      "The stored private invoice belongs to a different wallet account. Reconnect the wallet that paid for this subscription, or subscribe again with the current signer.",
    );
  }

  const contentId = options?.contentId?.trim() || null;
  const buildSubscriptionProofResult = (
    transactionId: string,
    executionProof: string,
  ): { proof: SubscriptionExecutionProof; transactionId: string } => ({
    transactionId,
    proof: {
      programId: PAYMENT_PROOF_PROGRAM_ID,
      transitionName: "verify_subscription",
      publicInputs: {
        circleId: normalizedCircleId,
        expiresAt: invoice.expiresAt,
        tier: invoice.tier,
      },
      executionProof,
    },
  });

  if (contentId) {
    const completedProof = getDoneProof(contentId);
    if (completedProof) {
      if (!completedProof.transcript) {
        throw new SubscriptionTranscriptUnavailableError(
          completedProof.txId,
          "Recovered transaction found without a cached transcript. Falling back to on-chain verification.",
        );
      }
      return buildSubscriptionProofResult(completedProof.txId, completedProof.transcript);
    }
  }

  const finalizeSubscriptionProofAttempt = async (
    requestTxId: string,
    submittedAt: number,
  ): Promise<{ proof: SubscriptionExecutionProof; transactionId: string }> => {
    options?.onStatus?.("accepted", requestTxId);

    let chainTxId = requestTxId;

    try {
      const resolvedChainTxId = await waitForOnChainTransactionId(wallet, requestTxId, PAYMENT_PROOF_PROGRAM_ID, {
        attempts: 60,
        delayMs: 2_000,
        returnNullIfPending: true,
      });

      if (!resolvedChainTxId) {
        storePendingSubscriptionProofAttempt(normalizedCircleId, {
          circleId: normalizedCircleId,
          nullifier: invoice.nullifier,
          transactionId: requestTxId,
          submittedAt,
        });

        options?.onStatus?.("fetching_proof", requestTxId);
        const requestExecutionProof = await waitForExecutionTranscript(wallet, requestTxId, {
          fallbackRequestId: requestTxId,
          maxAttempts: 20,
          intervalMs: 3_000,
        });
        if (requestExecutionProof) {
          clearPendingSubscriptionProofAttempt(normalizedCircleId);
          if (contentId) {
            saveDoneProof(contentId, requestExecutionProof, requestTxId);
          }
          return buildSubscriptionProofResult(requestTxId, requestExecutionProof);
        }

        throw new Error(
          `Verification transaction was already submitted (${requestTxId}). Wait for Aleo finalization, then press unlock again to resume without re-submitting.`,
        );
      }

      chainTxId = resolvedChainTxId;
    } catch (error) {
      throw error;
    }

    storePendingSubscriptionProofAttempt(normalizedCircleId, {
      circleId: normalizedCircleId,
      nullifier: invoice.nullifier,
      transactionId: chainTxId,
      submittedAt,
    });

    options?.onStatus?.("waiting_finality", chainTxId);

    try {
      console.log("[InnerCircle] Waiting for tx finality...", chainTxId);
      await waitForTransactionFinality(chainTxId);
    } catch (error) {
      const message = (error as Error)?.message ?? "";
      if (/not finalized after/i.test(message)) {
        throw new Error(
          `Verification transaction ${chainTxId} is still finalizing. Press unlock again to resume without re-submitting.`,
        );
      }
      throw error;
    }

    options?.onStatus?.("fetching_proof", chainTxId);
    const executionProof = await waitForExecutionTranscript(wallet, chainTxId, {
      fallbackRequestId: requestTxId,
    });
    clearPendingSubscriptionProofAttempt(normalizedCircleId);

    if (!executionProof) {
      throw new SubscriptionTranscriptUnavailableError(chainTxId);
    }

    if (contentId) {
      saveDoneProof(contentId, executionProof, chainTxId);
    }

    return buildSubscriptionProofResult(chainTxId, executionProof);
  };

  const pendingContentProof = contentId ? getPendingProof(contentId) : null;
  if (pendingContentProof) {
    if (Date.now() - pendingContentProof.startedAt <= 15 * 60_000) {
      return finalizeSubscriptionProofAttempt(
        pendingContentProof.requestId,
        pendingContentProof.startedAt,
      );
    }

    clearPendingProof(pendingContentProof.contentId);
  }

  const pendingProofAttempt = readPendingSubscriptionProofAttempt(normalizedCircleId);
  if (
    pendingProofAttempt &&
    pendingProofAttempt.nullifier === invoice.nullifier &&
    Date.now() - pendingProofAttempt.submittedAt <= 15 * 60_000
  ) {
    return finalizeSubscriptionProofAttempt(
      pendingProofAttempt.transactionId,
      pendingProofAttempt.submittedAt,
    );
  }
  if (pendingProofAttempt) {
    clearPendingSubscriptionProofAttempt(normalizedCircleId);
  }

  try {
    const requestTxId = await executeProgramTransaction({
      wallet,
      programId: PAYMENT_PROOF_PROGRAM_ID,
      functionName: "verify_subscription",
      inputs: [
        invoice.invoiceRecord,
        toFieldLiteral(normalizedCircleId),
        `${invoice.tier}u8`,
      ],
      privateFee: false,
      signerAddress,
    });
    const submittedAt = Date.now();
    storePendingSubscriptionProofAttempt(normalizedCircleId, {
      circleId: normalizedCircleId,
      nullifier: invoice.nullifier,
      transactionId: requestTxId,
      submittedAt,
    });
    if (contentId) {
      savePendingProof(contentId, requestTxId);
    }

    if (!wallet.address || wallet.address.trim().toLowerCase() !== signerAddress) {
      throw new Error("SIGNER_CHANGED");
    }

    return finalizeSubscriptionProofAttempt(requestTxId, submittedAt);
  } catch (error) {
    const message = (error as Error)?.message ?? "";
    if (contentId && /user rejected|reject|denied|cancel|declined/i.test(message)) {
      clearPendingProof(contentId);
    }
    if (/must belong to the signer/i.test(message)) {
      throw new Error(
        "Payment was accepted on-chain, but the wallet has not exposed the purchased private invoice to the active signer yet. Wait for wallet sync, then retry subscribe to resume proof generation without paying again.",
      );
    }
    throw error;
  }
};

/**
 * Executes pay_and_subscribe through the connected Aleo wallet, recovers the minted SubscriptionInvoice,
 * and proves it with the connected signer.
 */
const payAndSubscribeUnlocked = async (input: {
  wallet: WalletContextState;
  circleId: string;
  creatorAddress: string;
  amountMicrocredits: string | number | bigint;
  paymentAsset?: SubscriptionPaymentAsset;
  paymentVisibility?: SubscriptionPaymentVisibility;
  subscriptionBlocks?: number;
  feeAleo?: number;
  preferPrivatePath?: boolean;
  feePreference?: FeePreference;
  onStatus?: (status: SubscriptionPaymentStatus) => void;
}): Promise<{
  invoice: SubscriptionInvoiceReceipt;
  proof: SubscriptionExecutionProof | null;
  transactionId: string;
  verifyTransactionId?: string;
  route: SubscriptionPaymentRoute;
  fallbackReceipt?: SubscriptionTxFallbackReceipt;
}> => {
  const signerAddress = input.wallet.address?.trim().toLowerCase();
  if (!signerAddress || !signerAddress.startsWith("aleo1")) {
    throw new Error("Connect an Aleo wallet before subscribing.");
  }
  if (!input.creatorAddress || !/^aleo1[0-9a-z]+$/i.test(input.creatorAddress.trim())) {
    throw new Error("Creator address is missing or invalid for subscription invoice minting.");
  }

  const paymentAsset = input.paymentAsset ?? "ALEO_CREDITS";
  const normalizedCircleId = normalizeFieldId(input.circleId);
  const creatorAddress = input.creatorAddress.trim();
  const amountSubunits = BigInt(input.amountMicrocredits);
  if (amountSubunits <= 0n) {
    throw new Error("Subscription amount must be greater than zero.");
  }
  const amountMicrocredits = amountSubunits;

  const currentBlock = toSafeBlockNumber(await fetchLatestBlockHeight());
  const expiresAt = currentBlock + (input.subscriptionBlocks ?? DEFAULT_SUBSCRIPTION_BLOCKS);
  const amountLiteral = paymentAsset === "USDCX"
    ? `${amountSubunits}u128`
    : toU64Literal(amountSubunits);
  const expiryLiteral = toU32Literal(expiresAt);
  const saltLiteral = createRandomSaltField();
  const subscriptionFeeAleo = input.feeAleo ?? DEFAULT_SUBSCRIPTION_FEE_ALEO;

  const reportStatus = (status: SubscriptionPaymentStatus): void => {
    input.onStatus?.({
      ...status,
      asset: paymentAsset,
    });
  };

  const finalizeRecoveredInvoice = async (
    invoice: SubscriptionInvoiceReceipt,
    transactionId: string,
    route: SubscriptionPaymentRoute,
  ): Promise<{
    invoice: SubscriptionInvoiceReceipt;
    proof: SubscriptionExecutionProof | null;
    transactionId: string;
    verifyTransactionId?: string;
    route: SubscriptionPaymentRoute;
    fallbackReceipt?: SubscriptionTxFallbackReceipt;
  }> => {
    const receipt: SubscriptionInvoiceReceipt = {
      ...invoice,
      transactionId,
      purchasedAt: invoice.purchasedAt ?? Date.now(),
      paymentRoute: route,
    };

    storeSubscriptionInvoiceReceipt(normalizedCircleId, receipt);
    clearPendingSubscriptionAttempt(normalizedCircleId);

    reportStatus({ stage: "proving_invoice", route, transactionId });
    try {
      const verification = await generateSubscriptionProof(input.wallet, receipt, normalizedCircleId, {
        signerAddress,
        onStatus: (stage, verifyTransactionId) => {
          reportStatus({
            stage,
            route,
            transactionId,
            verifyTransactionId,
            phase: "verification",
          });
        },
      });
      return {
        invoice: receipt,
        proof: verification.proof,
        transactionId,
        verifyTransactionId: verification.transactionId,
        route,
      };
    } catch (error) {
      if (error instanceof SubscriptionTranscriptUnavailableError) {
        const fallbackReceipt = await handleTranscriptFallback(error.transactionId, normalizedCircleId);
        return {
          invoice: receipt,
          proof: null,
          transactionId,
          route,
          fallbackReceipt,
        };
      }
      throw error;
    }
  };

  const pendingAttempt = readPendingSubscriptionAttempt(normalizedCircleId);
  if (
    pendingAttempt &&
    pendingAttempt.expiresAt > currentBlock &&
    Date.now() - pendingAttempt.purchasedAt <= 15 * 60_000
  ) {
    reportStatus({
      stage: "resuming_invoice",
      route: pendingAttempt.route,
      transactionId: pendingAttempt.transactionId,
    });

    const resumedInvoice = await recoverPendingSubscriptionInvoice(
      input.wallet,
      normalizedCircleId,
      pendingAttempt.expiresAt,
      {
        attempts: 45,
        delayMs: 2_000,
        onAttempt: () => {
          reportStatus({
            stage: "resuming_invoice",
            route: pendingAttempt.route,
            transactionId: pendingAttempt.transactionId,
          });
        },
      },
    );

    if (resumedInvoice) {
      return finalizeRecoveredInvoice(
        resumedInvoice,
        pendingAttempt.transactionId,
        pendingAttempt.route,
      );
    }
  } else if (pendingAttempt) {
    clearPendingSubscriptionAttempt(normalizedCircleId);
  }

  const executePrivateInvoicePayment = async (
    paymentRecord: { literal: string; index?: number; balance?: bigint },
  ): Promise<string> => {
    reportStatus({ stage: "submitting_private", route: "private_record" });
    const submitPrivatePayment = async (
      record: { literal: string; index?: number; balance?: bigint },
    ): Promise<string> => {
      const creditsRecord = record.literal.trim();
      if (!creditsRecord) {
        throw new Error("Subscription payment requires a raw private credits record string.");
      }
      if (paymentAsset !== "USDCX") {
        validatePrivateCreditsRecordBalance(record, amountMicrocredits);
        const selectedBalance = parsePrivateCreditsBalance(record, creditsRecord) ?? record.balance ?? null;
        console.log("[InnerCircle] Selected record:", {
          index: typeof record.index === "number" ? record.index : null,
          microcredits: typeof selectedBalance === "bigint" ? `${selectedBalance.toString()}u64` : null,
          nonce: parsePrivateRecordNonce(creditsRecord) ?? null,
        });
      }

      const privateInputs = IS_LEGACY_PAYMENT_PROOF_PROGRAM
        ? [
            creditsRecord,
            toFieldLiteral(normalizedCircleId),
            amountLiteral,
            expiryLiteral,
          ]
        : [
            creditsRecord,
            toFieldLiteral(normalizedCircleId),
            amountLiteral,
            expiryLiteral,
            saltLiteral,
            creatorAddress,
          ];

      if (paymentAsset === "USDCX" && !IS_LEGACY_PAYMENT_PROOF_PROGRAM) {
        const freezeListProof = await generateFreezeListProof();
        privateInputs.push(`[${freezeListProof}, ${freezeListProof}]`);
      }

      return executeProgramTransaction({
        wallet: input.wallet,
        programId: PAYMENT_PROOF_PROGRAM_ID,
        functionName: paymentAsset === "USDCX" ? "pay_and_subscribe_usdcx" : "pay_and_subscribe",
        inputs: privateInputs,
        feeAleo: subscriptionFeeAleo,
        privateFee: false,
        feePreference: input.feePreference,
        signerAddress,
        recordIndices: typeof record.index === "number" ? [record.index] : undefined,
      });
    };

    let requestTxId: string;
    try {
      requestTxId = await submitPrivatePayment(paymentRecord);
    } catch (error) {
      if (
        !isShieldWallet(input.wallet) ||
        (!isDuplicatePrivateInputError(error) && !isRetryableSubscriptionFailure(error))
      ) {
        throw error;
      }

      await wait(1_000);
      const refreshedRecord = paymentAsset === "USDCX"
        ? await pickPrivateTokenRecord(input.wallet, USDCX_PROGRAM_ID, amountSubunits, paymentRecord.literal)
        : await pickPrivateCreditsRecord(input.wallet, amountMicrocredits, paymentRecord.literal);
      requestTxId = await submitPrivatePayment(refreshedRecord);
    }

    reportStatus({ stage: "awaiting_finality", route: "private_record", transactionId: requestTxId });
    const finalizedTxId = await waitForOnChainTransactionId(input.wallet, requestTxId, PAYMENT_PROOF_PROGRAM_ID, {
      attempts: 60,
      delayMs: 2_000,
    });
    if (!finalizedTxId) {
      throw new Error("Subscription payment was submitted, but the on-chain tx id is not available yet.");
    }
    return finalizedTxId;
  };

  const executeDirectPublicInvoicePayment = async (): Promise<string> => {
    reportStatus({ stage: "submitting_public", route: "public_balance" });
    const publicRequestTxId = await executeProgramTransaction({
      wallet: input.wallet,
      programId: PAYMENT_PROOF_PROGRAM_ID,
      functionName: paymentAsset === "USDCX" ? "pay_and_subscribe_usdcx_public" : "pay_and_subscribe_public",
      inputs: IS_LEGACY_PAYMENT_PROOF_PROGRAM
        ? [
          toFieldLiteral(normalizedCircleId),
          amountLiteral,
          expiryLiteral,
        ]
        : [
          toFieldLiteral(normalizedCircleId),
          amountLiteral,
          expiryLiteral,
          saltLiteral,
          creatorAddress,
        ],
      feeAleo: subscriptionFeeAleo,
      privateFee: false,
      feePreference: input.feePreference,
      signerAddress,
    });

    reportStatus({ stage: "awaiting_finality", route: "public_balance", transactionId: publicRequestTxId });
    const finalizedTxId = await waitForOnChainTransactionId(input.wallet, publicRequestTxId, PAYMENT_PROOF_PROGRAM_ID, {
      attempts: 60,
      delayMs: 2_000,
    });
    if (!finalizedTxId) {
      throw new Error("Subscription payment was submitted, but the on-chain tx id is not available yet.");
    }
    return finalizedTxId;
  };

  reportStatus({ stage: "selecting_route" });

  const publicBalance = await fetchKnownPublicBalanceMicrocredits(signerAddress);
  const hasPrivateFeeBalance = hasEnoughPublicBalanceForFee(publicBalance, subscriptionFeeAleo);
  const canUsePublicBalance = paymentAsset === "ALEO_CREDITS"
    ? hasEnoughPublicBalanceForPublicPayment(
        publicBalance,
        amountMicrocredits,
        subscriptionFeeAleo,
      )
    : false;
  const canAttemptUsdcxPublicRoute = paymentAsset === "USDCX" && hasPrivateFeeBalance;
  let selectedPrivateRecord: { literal: string; index?: number } | null = null;
  let privateRecordError: unknown;

  try {
    selectedPrivateRecord = paymentAsset === "USDCX"
      ? await pickPrivateTokenRecord(input.wallet, USDCX_PROGRAM_ID, amountSubunits)
      : await pickPrivateCreditsRecord(input.wallet, amountMicrocredits);
  } catch (error) {
    privateRecordError = error;
  }

  if (selectedPrivateRecord && !hasPrivateFeeBalance) {
    privateRecordError = new Error(
      `A private ${paymentAsset === "USDCX" ? "USDCx" : "credits"} record is available for the subscription amount, but public balance is below the ${microcreditsToAleoString(aleoToMicrocredits(subscriptionFeeAleo))} credit network fee.`,
    );
    selectedPrivateRecord = null;
  }

  let transactionId: string;
  let route: SubscriptionPaymentRoute;
  let attemptedRoute: SubscriptionPaymentRoute | null = null;
  try {
    const requiresPrivateRoute = input.paymentVisibility === "PRIVATE" || input.preferPrivatePath === true;
    const requiresPublicRoute = input.paymentVisibility === "PUBLIC";

    if (requiresPrivateRoute && selectedPrivateRecord) {
      attemptedRoute = "private_record";
      transactionId = await executePrivateInvoicePayment(selectedPrivateRecord);
      route = "private_record";
    } else if (requiresPrivateRoute) {
      throw normalizeSubscriptionExecutionError(
        privateRecordError ?? new Error("No spendable private credits record is available for the requested private subscription payment."),
        amountMicrocredits,
        subscriptionFeeAleo,
      );
    } else if (requiresPublicRoute && (canUsePublicBalance || canAttemptUsdcxPublicRoute)) {
      attemptedRoute = "public_balance";
      transactionId = await executeDirectPublicInvoicePayment();
      route = "public_balance";
    } else if (requiresPublicRoute) {
      throw normalizeSubscriptionExecutionError(
        new Error(
          paymentAsset === "USDCX"
            ? "Wallet cannot confirm a spendable public USDCx balance for this checkout, or the public fee balance is too low."
            : "Public balance is too low for the requested subscription amount and fee.",
        ),
        amountMicrocredits,
        subscriptionFeeAleo,
      );
    } else if (canUsePublicBalance) {
      attemptedRoute = "public_balance";
      transactionId = await executeDirectPublicInvoicePayment();
      route = "public_balance";
    } else if (selectedPrivateRecord) {
      attemptedRoute = "private_record";
      transactionId = await executePrivateInvoicePayment(selectedPrivateRecord);
      route = "private_record";
    } else {
      throw normalizeSubscriptionExecutionError(
        privateRecordError ?? new Error("No spendable balance available for the subscription invoice."),
        amountMicrocredits,
        subscriptionFeeAleo,
      );
    }
  } catch (error) {
    const shouldFallbackToPublic =
      attemptedRoute === "private_record" &&
      !isUserRejectedError(error) &&
      isRetryableSubscriptionFailure(error) &&
      canUsePublicBalance;

    if (shouldFallbackToPublic) {
      transactionId = await executeDirectPublicInvoicePayment();
      route = "public_balance";
    } else {
      throw normalizeSubscriptionExecutionError(error, amountMicrocredits, subscriptionFeeAleo);
    }
  }

  reportStatus({ stage: "recovering_invoice", route, transactionId });
  storePendingSubscriptionAttempt(normalizedCircleId, {
    circleId: normalizedCircleId,
    expiresAt,
    transactionId,
    route,
    purchasedAt: Date.now(),
  });

  const invoice = await recoverPendingSubscriptionInvoice(
    input.wallet,
    normalizedCircleId,
    expiresAt,
    {
      attempts: 60,
      delayMs: 2_000,
      onAttempt: () => {
        reportStatus({ stage: "recovering_invoice", route, transactionId });
      },
    },
  );

  if (!invoice) {
    throw new Error(
      "The payment transaction succeeded, but the wallet has not exposed the private subscription invoice record yet. Wait for wallet record sync, then retry subscribe to resume proof generation without paying again.",
    );
  }

  return finalizeRecoveredInvoice(invoice, transactionId, route);
};

export const payAndSubscribe = async (input: {
  wallet: WalletContextState;
  circleId: string;
  creatorAddress: string;
  amountMicrocredits: string | number | bigint;
  paymentAsset?: SubscriptionPaymentAsset;
  paymentVisibility?: SubscriptionPaymentVisibility;
  subscriptionBlocks?: number;
  feeAleo?: number;
  preferPrivatePath?: boolean;
  feePreference?: FeePreference;
  signerAddress?: string;
  onStatus?: (status: SubscriptionPaymentStatus) => void;
}): Promise<{
  invoice: SubscriptionInvoiceReceipt;
  proof: SubscriptionExecutionProof | null;
  transactionId: string;
  verifyTransactionId?: string;
  route: SubscriptionPaymentRoute;
  fallbackReceipt?: SubscriptionTxFallbackReceipt;
}> => {
  const walletAddress = input.wallet.address?.trim().toLowerCase();
  const circleId = normalizeFieldId(input.circleId);
  const lockKey = `${walletAddress ?? "unknown"}:${circleId}`;
  const existing = subscriptionPaymentLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  const run = payAndSubscribeUnlocked(input).finally(() => {
    if (subscriptionPaymentLocks.get(lockKey) === run) {
      subscriptionPaymentLocks.delete(lockKey);
    }
  });

  subscriptionPaymentLocks.set(lockKey, run);
  return run;
};

/**
 * Stores a PPV payment proof locally.
 */
export const storePaymentProof = (contentId: string, proof: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(`${PAYMENT_PROOF_PREFIX}${contentId}`, proof);
};

/**
 * Reads a locally cached PPV payment proof.
 */
export const readPaymentProof = (contentId: string): string | null => {
  const storage = getStorage();
  if (!storage) return null;
  return storage.getItem(`${PAYMENT_PROOF_PREFIX}${contentId}`);
};

/**
 * Generates the legacy PPV payment proof until PPV is migrated to invoice-backed proofs.
 */
export const generatePaymentProof = async (txHash: string): Promise<string> => {
  return sha256Hex(txHash);
};

/**
 * Verifies a stored PPV payment proof against the backend store.
 */
export const verifyProof = async (proof: string, contentId: string): Promise<boolean> => {
  if (!proof || !contentId) return false;
  const result = await verifyStoredPaymentProof({ proof, contentId });
  return result.valid;
};
