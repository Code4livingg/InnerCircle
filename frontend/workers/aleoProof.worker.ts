/// <reference lib="webworker" />

import type { SubscriptionExecutionProof } from "@/lib/api";

type AleoSdkModule = {
  initializeWasm?: () => Promise<void>;
  initThreadPool?: (threads?: number) => Promise<void>;
  Account: new () => {
    privateKey: () => unknown;
  };
  OfflineKeyProvider: new () => {
    cacheKeys: (keyId: string, keys: [unknown, unknown]) => void;
  };
  OfflineSearchParams: new (cacheKey: string, verifyCreditsKeys?: boolean) => unknown;
  AleoNetworkClient: new (host: string) => {
    getProgram: (programId: string) => Promise<string>;
  };
  ProgramManagerBase: {
    synthesizeKeyPair: (
      privateKey: unknown,
      program: string,
      functionName: string,
      inputs: string[],
      imports?: Record<string, string>,
    ) => Promise<{
      provingKey: () => unknown;
      verifyingKey: () => unknown;
    }>;
  };
  ProgramManager: new (host?: string, keyProvider?: unknown, recordProvider?: unknown) => {
    setAccount: (account: unknown) => void;
    run: (
      program: string,
      functionName: string,
      inputs: string[],
      proveExecution: boolean,
      imports?: Record<string, string>,
      keySearchParams?: unknown,
      provingKey?: unknown,
      verifyingKey?: unknown,
      privateKey?: unknown,
    ) => Promise<{
      getExecution: () => { toString: () => string } | undefined;
      getVerifyingKey: () => { toString: () => string };
    }>;
    verifyExecution: (executionResponse: unknown) => boolean;
  };
};

interface GenerateSubscriptionProofPayload {
  explorerApi: string;
  programId: string;
  invoiceRecord: string;
  circleId: string;
  tier: number;
  expiresAt: number;
}

interface ProofWorkerRequest {
  id: string;
  type: "generate_subscription_proof";
  payload: GenerateSubscriptionProofPayload;
}

interface ProofWorkerSuccessResponse {
  id: string;
  type: "result";
  result: SubscriptionExecutionProof;
}

interface ProofWorkerErrorResponse {
  id: string;
  type: "error";
  error: string;
  details?: string;
}

type ProofWorkerResponse = ProofWorkerSuccessResponse | ProofWorkerErrorResponse;

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const formatWorkerError = (error: unknown): { error: string; details?: string } => {
  if (error instanceof Error) {
    const message = error.message?.trim() || "Aleo proof worker failed.";
    const details = error.stack?.trim();
    return details && details !== message ? { error: message, details } : { error: message };
  }

  if (typeof error === "string" && error.trim()) {
    return { error: error.trim() };
  }

  try {
    return { error: JSON.stringify(error) };
  } catch {
    return { error: "Aleo proof worker failed." };
  }
};

let aleoSdkPromise: Promise<AleoSdkModule> | null = null;
const verifyProgramPromises = new Map<string, Promise<{ programSource: string; imports: Record<string, string> }>>();
const IMPORT_STATEMENT_PATTERN = /^\s*import\s+([a-z0-9_]+\.aleo)\s*;/gim;

const toFieldLiteral = (value: string): string => `${value.trim().replace(/field$/i, "")}field`;

const normalizeProgramSource = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Explorer returned an empty Aleo program.");
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
    } catch {
      // Fall back to the raw string if it is not JSON-encoded.
    }
  }

  return trimmed;
};

const extractImportedProgramIds = (programSource: string): string[] => {
  const imports = new Set<string>();
  for (const match of programSource.matchAll(IMPORT_STATEMENT_PATTERN)) {
    const programId = match[1]?.trim();
    if (programId) {
      imports.add(programId);
    }
  }
  return [...imports];
};

const fetchProgramWithImports = async (
  networkClient: InstanceType<AleoSdkModule["AleoNetworkClient"]>,
  programId: string,
  cache: Map<string, string>,
): Promise<void> => {
  if (cache.has(programId)) {
    return;
  }

  const programSource = normalizeProgramSource(await networkClient.getProgram(programId));
  cache.set(programId, programSource);

  const importIds = extractImportedProgramIds(programSource);
  for (const importId of importIds) {
    await fetchProgramWithImports(networkClient, importId, cache);
  }
};

const loadAleoSdk = async (): Promise<AleoSdkModule> => {
  if (!aleoSdkPromise) {
    aleoSdkPromise = (async () => {
      const sdk = (await import("@provablehq/sdk/testnet.js")) as unknown as AleoSdkModule;
      if (typeof sdk.initializeWasm === "function") {
        await sdk.initializeWasm();
      }
      if (typeof sdk.initThreadPool === "function") {
        const threads = Math.max(1, Math.min(self.navigator.hardwareConcurrency ?? 2, 4));
        await sdk.initThreadPool(threads);
      }
      return sdk;
    })();
  }

  return aleoSdkPromise;
};

const loadVerifyProgram = async (
  explorerApi: string,
  programId: string,
): Promise<{ programSource: string; imports: Record<string, string> }> => {
  const cacheKey = `${explorerApi}::${programId}`;
  const existing = verifyProgramPromises.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const sdk = await loadAleoSdk();
    const networkClient = new sdk.AleoNetworkClient(explorerApi);
    const programCache = new Map<string, string>();
    await fetchProgramWithImports(networkClient, programId, programCache);
    const programSource = programCache.get(programId);
    if (!programSource) {
      throw new Error(`Unable to load ${programId} from the Aleo explorer.`);
    }
    programCache.delete(programId);
    const imports = Object.fromEntries(programCache.entries());
    return { programSource, imports };
  })();

  verifyProgramPromises.set(cacheKey, promise);
  return promise;
};

const generateSubscriptionProof = async (
  payload: GenerateSubscriptionProofPayload,
): Promise<SubscriptionExecutionProof> => {
  const sdk = await loadAleoSdk();
  const { programSource, imports } = await loadVerifyProgram(payload.explorerApi, payload.programId);
  const inputs = [
    payload.invoiceRecord,
    toFieldLiteral(payload.circleId),
    `${payload.tier}u8`,
  ];
  const keyLocator = `${payload.programId}/verify_subscription`;

  const account = new sdk.Account();
  const keyProvider = new sdk.OfflineKeyProvider();
  const keyPair = await sdk.ProgramManagerBase.synthesizeKeyPair(
    account.privateKey(),
    programSource,
    "verify_subscription",
    inputs,
    imports,
  );
  keyProvider.cacheKeys(keyLocator, [keyPair.provingKey(), keyPair.verifyingKey()]);

  const programManager = new sdk.ProgramManager(payload.explorerApi, keyProvider);
  programManager.setAccount(account);

  const executionResponse = await programManager.run(
    programSource,
    "verify_subscription",
    inputs,
    true,
    imports,
    new sdk.OfflineSearchParams(keyLocator),
    undefined,
    undefined,
    account.privateKey(),
  );

  if (!programManager.verifyExecution(executionResponse)) {
    throw new Error("Aleo execution proof failed local verification.");
  }

  const execution = executionResponse.getExecution();
  if (!execution) {
    throw new Error("Aleo SDK did not return an execution transcript for verify_subscription.");
  }

  return {
    programId: payload.programId,
    transitionName: "verify_subscription",
    publicInputs: {
      circleId: payload.circleId.trim().replace(/field$/i, ""),
      expiresAt: payload.expiresAt,
      tier: payload.tier,
    },
    executionProof: execution.toString(),
    verifyingKey: executionResponse.getVerifyingKey().toString(),
    programSource,
  };
};

ctx.onmessage = async (event: MessageEvent<ProofWorkerRequest>) => {
  const request = event.data;

  try {
    const result = await generateSubscriptionProof(request.payload);
    const response: ProofWorkerResponse = {
      id: request.id,
      type: "result",
      result,
    };
    ctx.postMessage(response);
  } catch (error) {
    const formatted = formatWorkerError(error);
    const response: ProofWorkerResponse = {
      id: request.id,
      type: "error",
      error: formatted.error,
      details: formatted.details,
    };
    ctx.postMessage(response);
  }
};

export {};
