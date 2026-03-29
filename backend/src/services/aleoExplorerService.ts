import { env } from "../config/env.js";

export type ExplorerTxType = "deploy" | "execute" | "fee" | "mint" | "unknown";

export interface ExplorerTransitionIO {
  type: string;
  id?: string;
  value?: string;
  tag?: string;
}

export interface ExplorerTransition {
  id: string;
  program: string;
  function: string;
  inputs: ExplorerTransitionIO[];
  outputs: ExplorerTransitionIO[];
}

export interface ExplorerExecuteTx {
  type: "execute";
  id: string;
  execution: {
    transitions: ExplorerTransition[];
    global_state_root?: string;
    proof?: string;
  };
  fee?: {
    transition?: ExplorerTransition;
    global_state_root?: string;
    proof?: string;
  };
  transitions?: ExplorerTransition[];
}

export interface ExplorerDeployTx {
  type: "deploy";
  id: string;
  owner?: {
    address?: string;
  };
  deployment?: unknown;
  fee?: unknown;
}

export type ExplorerTx = ExplorerExecuteTx | ExplorerDeployTx | { type: string; id: string; [k: string]: unknown };

export class ExplorerRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExplorerRequestError";
    this.status = status;
  }
}

const extractNormalizedTransitions = (tx: Record<string, unknown>): ExplorerTransition[] => {
  const executionTransitions = (tx.execution as { transitions?: unknown } | undefined)?.transitions;
  if (Array.isArray(executionTransitions)) {
    return executionTransitions as ExplorerTransition[];
  }

  const nestedExecutionTransitions =
    ((tx.transaction as { execution?: { transitions?: unknown } } | undefined)?.execution?.transitions);
  if (Array.isArray(nestedExecutionTransitions)) {
    return nestedExecutionTransitions as ExplorerTransition[];
  }

  const topLevelTransitions = tx.transitions;
  if (Array.isArray(topLevelTransitions)) {
    return topLevelTransitions as ExplorerTransition[];
  }

  const feeTransition = (tx.fee as { transition?: unknown } | undefined)?.transition;
  if (feeTransition && typeof feeTransition === "object") {
    return [feeTransition as ExplorerTransition];
  }

  return [];
};

const normalizeExplorerTx = (tx: ExplorerTx): ExplorerTx => {
  const record = tx as ExplorerTx & Record<string, unknown>;
  const transitions = extractNormalizedTransitions(record);

  if (tx.type === "execute") {
    const execution = typeof record.execution === "object" && record.execution !== null
      ? { ...(record.execution as Record<string, unknown>), transitions }
      : { transitions };

    return {
      ...tx,
      execution: execution as ExplorerExecuteTx["execution"],
      transitions,
    };
  }

  return {
    ...tx,
    transitions,
  };
};

export const isExecuteTx = (tx: ExplorerTx): tx is ExplorerExecuteTx => {
  const record = tx as ExplorerTx & Record<string, unknown>;
  if (tx.type !== "execute") {
    return false;
  }

  if (typeof record.execution === "object" && record.execution !== null) {
    const transitions = (record.execution as { transitions?: unknown }).transitions;
    if (Array.isArray(transitions)) {
      return true;
    }
  }

  const nestedTransitions =
    ((record.transaction as { execution?: { transitions?: unknown } } | undefined)?.execution?.transitions);
  if (Array.isArray(nestedTransitions)) {
    return true;
  }

  return Array.isArray(record.transitions);
};

const txUrl = (txId: string): string => {
  // Leo CLI uses `${ENDPOINT}/${NETWORK}/transaction/${id}`.
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const network = env.aleoNetwork;
  return `${base}/${network}/transaction/${txId}`;
};

const creditsPublicBalanceUrl = (walletAddress: string): string => {
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const network = env.aleoNetwork;
  return `${base}/${network}/program/credits.aleo/mapping/account/${walletAddress}`;
};

const latestBlockHeightUrl = (): string => {
  const base = env.aleoEndpoint.replace(/\/+$/, "");
  const network = env.aleoNetwork;
  return `${base}/${network}/block/height/latest`;
};

const parseLatestBlockHeight = (value: unknown, depth = 0): bigint | undefined => {
  if (depth > 4 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? BigInt(trimmed) : undefined;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
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

export const fetchExplorerTx = async (txId: string): Promise<ExplorerTx> => {
  const res = await fetch(txUrl(txId), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ExplorerRequestError(res.status, `Explorer fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const rawTx = (await res.json()) as ExplorerTx;
  return normalizeExplorerTx(rawTx);
};

export const fetchCreditsPublicBalance = async (walletAddress: string): Promise<bigint> => {
  const res = await fetch(creditsPublicBalanceUrl(walletAddress), {
    headers: { Accept: "application/json, text/plain" },
  });

  // Explorer returns 404 for addresses with no public mapping entry.
  if (res.status === 404) {
    return 0n;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ExplorerRequestError(res.status, `Explorer balance fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const payload = await res.text();
  const match = payload.match(/"?(?<micro>[0-9]+)u64"?/);
  if (!match?.groups?.micro) {
    throw new ExplorerRequestError(502, `Unexpected explorer balance payload: ${payload.slice(0, 200)}`);
  }

  return BigInt(match.groups.micro);
};

export const fetchLatestBlockHeight = async (): Promise<number> => {
  const res = await fetch(latestBlockHeightUrl(), {
    headers: { Accept: "application/json, text/plain" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ExplorerRequestError(res.status, `Explorer block height fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await res.json()
    : await res.text();
  const height = parseLatestBlockHeight(payload);
  if (height === undefined || height > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExplorerRequestError(502, "Explorer returned an invalid latest block height payload.");
  }

  return Number(height);
};

export const extractFeePayerAddress = (tx: ExplorerTx): string | undefined => {
  if (!isExecuteTx(tx)) return undefined;
  const feeValue = tx.fee?.transition?.outputs?.[0]?.value;
  if (!feeValue) return undefined;

  const match = feeValue.match(/aleo1[0-9a-z]{10,}/i);
  return match?.[0];
};
