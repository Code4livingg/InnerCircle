import { toApiUrl } from "./apiBase";

interface ApiErrorPayload {
  error?: string;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const throwApiError = async (res: Response): Promise<never> => {
  let payload: ApiErrorPayload = {};

  try {
    payload = (await res.json()) as ApiErrorPayload;
  } catch {
    // Ignore parse errors and fall back to status text below
  }

  const fallbackMessage =
    payload.error ??
    (res.status >= 500 && res.status <= 504
      ? "Could not reach the backend API. Is the server running?"
      : res.statusText || "Request failed");

  throw new ApiError(fallbackMessage, res.status, payload.code);
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(toApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return throwApiError(res);
  }

  return (await res.json()) as T;
};

const postJsonWithHeaders = async <T>(path: string, body: unknown, headers: HeadersInit): Promise<T> => {
  const res = await fetch(toApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return throwApiError(res);
  }

  return (await res.json()) as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(toApiUrl(path), { cache: "no-store" });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as T;
};

const getJsonWithHeaders = async <T>(path: string, headers: HeadersInit): Promise<T> => {
  const res = await fetch(toApiUrl(path), {
    cache: "no-store",
    headers,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as T;
};

export interface Creator {
  id: string;
  walletAddress: string;
  creatorFieldId: string;
  handle: string;
  category?: string | null;
  displayName: string | null;
  bio: string | null;
  avatarObjectKey: string | null;
  subscriptionPriceMicrocredits: string | null;
  isVerified: boolean;
  createdAt: string;
  followerCount?: number;
}

export type ContentAccessType = "PUBLIC" | "SUBSCRIPTION" | "PPV";

export interface Content {
  id: string;
  contentFieldId: string;
  title: string;
  description: string | null;
  kind: string;
  accessType: ContentAccessType;
  ppvPriceMicrocredits: string | null;
  isPublished: boolean;
  thumbObjectKey: string | null;
  createdAt: string;
}

export interface CreatorWithContent extends Creator {
  contents: Content[];
}

export interface ContentDetails extends Content {
  creatorId: string;
  mimeType: string;
  sizeBytes: string;
  chunkSizeBytes: number;
  chunkCount: number;
  creator: {
    handle: string;
    displayName: string | null;
    creatorFieldId: string;
    walletAddress: string;
    subscriptionPriceMicrocredits: string;
    isVerified: boolean;
  };
}

export interface DiscoverContent extends Content {
  creator: {
    handle: string;
    displayName: string | null;
    creatorFieldId: string;
    isVerified: boolean;
  };
}

export interface FanProfile {
  walletAddress: string;
  monthlyBudgetMicrocredits: string;
  favoriteCategories: string[];
}

export interface CreatorAnalyticsResponse {
  creator: {
    id: string;
    handle: string;
    displayName: string | null;
    subscriptionPriceMicrocredits: string;
  };
  stats: {
    followerCount: number;
    activeSubscriberCount: number;
    totalSubscriberCount: number;
    totalRevenueMicrocredits: string;
    monthlyRevenueMicrocredits: string;
    subscriptionRevenueMicrocredits: string;
    ppvRevenueMicrocredits: string;
    publicPostCount: number;
    subscriptionPostCount: number;
    ppvPostCount: number;
    totalContentCount: number;
    publishedContentCount: number;
  };
}

export interface FanProfileResponse {
  profile: FanProfile | null;
  followedCreators: Array<Pick<Creator, "handle" | "displayName" | "subscriptionPriceMicrocredits" | "isVerified">>;
  followedCreatorHandles: string[];
}

export interface DiscoverFeedResponse {
  creators: Creator[];
  contents: DiscoverContent[];
  recommendedCreators: Creator[];
  fanBudgetMicrocredits: string | null;
}

export interface PaymentVerificationResponse {
  ok: boolean;
  kind: "subscription" | "ppv";
  txId: string;
  creatorHandle?: string;
  creatorFieldId?: string;
  contentId?: string;
  contentFieldId?: string;
  priceMicrocredits: string;
  verifiedAt: string;
}

export interface SubscriptionStatusResponse {
  ok: boolean;
  creatorHandle: string;
  active: boolean;
  txId: string | null;
  verifiedAt: string | null;
  activeUntil: string | null;
  priceMicrocredits: string;
}

export interface CreateSessionResponse {
  sessionToken: string;
  sessionId: string;
  expiresAt: number;
}

export interface StartSessionResponse {
  sessionId: string;
  fingerprint: string;
  shortWallet: string;
  contentId: string;
  startedAt: string;
  expiresAt: string;
}

export interface MediaAccessResponse {
  url: string;
  expiresAt: string;
  expiresIn: number;
  mimeType: string;
}

export type WalletRole = "user" | "creator";

export interface WalletRoleResponse {
  role: WalletRole | null;
  locked: boolean;
}

export interface PublicBalanceResponse {
  walletAddress: string;
  publicBalanceMicrocredits: string;
  publicBalanceAleo: string;
}

export interface VerifyWalletSignatureResponse {
  valid: boolean;
  network: string;
  aleoNetwork: string;
}

export interface WalletSessionResponse {
  token: string;
  expiresAt: number;
  walletHash: string;
  network: string;
  aleoNetwork: string;
}

export interface LiveStream {
  id: string;
  title: string;
  accessType: Extract<ContentAccessType, "SUBSCRIPTION" | "PPV">;
  ppvPriceMicrocredits: string | null;
  status: "live" | "offline" | string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  creatorId: string;
  creator: {
    handle: string;
    displayName: string | null;
    isVerified: boolean;
    walletAddress: string | null;
    subscriptionPriceMicrocredits: string | null;
  };
}

export interface CreateLiveStreamResponse {
  liveStreamId: string;
  ingestEndpoint: string;
  streamKeyValue: string;
  playbackUrl: string;
}

export interface LiveStreamPlaybackTokenResponse {
  url: string;
  expiresAt: number;
}

export interface VerifyLiveStreamPurchaseResponse {
  ok: boolean;
  txId: string;
  liveStreamId: string;
  purchaseFieldId: string;
  priceMicrocredits: string;
  verifiedAt: string;
}

export interface SessionProofPayload {
  txId: string;
  programId?: string;
  functionName?: string;
}

export type VerifyPurchaseRequest =
  | {
    kind: "subscription";
    txId: string;
    creatorHandle: string;
    walletAddressHint?: string;
  }
  | {
    kind: "ppv";
    txId: string;
    contentId: string;
    walletAddressHint?: string;
  };

export type CreateSessionRequest =
  | {
    mode: "subscription";
    creatorHandle: string;
    proof: SessionProofPayload;
    proofTxId?: string;
    walletAddressHint?: string;
  }
  | {
    mode: "ppv";
    contentId: string;
    proof: SessionProofPayload;
    proofTxId?: string;
    walletAddressHint?: string;
  }
  | {
    // Direct: issue session from the buy_content purchase tx — no prove_ call needed
    mode: "ppv-direct";
    contentId: string;
    purchaseTxId: string;
    walletAddressHint?: string;
  }
  | {
    // Direct: issue session from the subscribe purchase tx — no prove_ call needed
    mode: "subscription-direct";
    creatorHandle: string;
    purchaseTxId: string;
    walletAddressHint?: string;
  };

export interface StartSessionRequest {
  contentId: string;
  walletAddress: string;
  sessionToken: string;
}

export const fetchCreators = (): Promise<{ creators: Creator[] }> => getJson("/api/creators");

export const fetchDiscoverFeed = (walletAddress?: string | null): Promise<DiscoverFeedResponse> =>
  getJson(
    `/api/discover/feed${walletAddress ? `?walletAddress=${encodeURIComponent(walletAddress)}` : ""}`,
  );

export const fetchCreatorByHandle = (handle: string): Promise<{ creator: CreatorWithContent }> =>
  getJson(`/api/creators/${handle}`);

export const fetchCreatorByWallet = (walletAddress: string): Promise<{ creator: CreatorWithContent }> =>
  getJson(`/api/creators/by-wallet/${encodeURIComponent(walletAddress)}`);

export const fetchContentById = (contentId: string): Promise<{ content: ContentDetails }> =>
  getJson(`/api/content/${contentId}`);

export const fetchCreatorAnalytics = (walletAddress: string): Promise<CreatorAnalyticsResponse> =>
  getJson(`/api/creators/analytics/${encodeURIComponent(walletAddress)}`);

export const fetchFanProfile = (walletAddress: string): Promise<FanProfileResponse> =>
  getJson(`/api/fans/profile/${encodeURIComponent(walletAddress)}`);

export const saveFanProfile = (body: {
  walletAddress: string;
  monthlyBudgetMicrocredits: string | number | bigint;
  favoriteCategories?: string[];
}): Promise<{ profile: FanProfile }> => postJson("/api/fans/profile", body);

export const setCreatorFollow = (body: {
  walletAddress: string;
  creatorHandle: string;
  follow: boolean;
}): Promise<{ ok: boolean; creatorHandle: string; following: boolean }> =>
  postJson("/api/fans/follow", body);

export const verifyPurchase = (body: VerifyPurchaseRequest): Promise<PaymentVerificationResponse> =>
  postJson("/api/subscriptions/verify", body);

export const fetchSubscriptionStatus = (
  creatorHandle: string,
  walletAddress: string,
): Promise<SubscriptionStatusResponse> =>
  getJson(
    `/api/subscriptions/status?creatorHandle=${encodeURIComponent(creatorHandle)}&walletAddress=${encodeURIComponent(walletAddress)}`,
  );

export const createSession = (body: CreateSessionRequest): Promise<CreateSessionResponse> =>
  postJson("/api/sessions/create", body);

export const startSession = (body: StartSessionRequest): Promise<StartSessionResponse> =>
  postJson("/api/start-session", body);

export const fetchMediaAccessUrl = (
  contentId: string,
  sessionToken: string,
): Promise<MediaAccessResponse> =>
  getJsonWithHeaders(`/api/media/${encodeURIComponent(contentId)}`, {
    Authorization: `Bearer ${sessionToken}`,
  });

export const fetchWalletRoleLock = (walletAddress: string): Promise<WalletRoleResponse> =>
  getJson(`/api/roles/${encodeURIComponent(walletAddress)}`);

export const claimWalletRoleLock = (
  walletAddress: string,
  role: WalletRole,
): Promise<WalletRoleResponse> => postJson("/api/roles/claim", { walletAddress, role });

export const fetchPublicBalance = (walletAddress: string): Promise<PublicBalanceResponse> =>
  getJson(`/api/aleo/public-balance/${encodeURIComponent(walletAddress)}`);

export const verifyWalletSignature = (
  walletAddress: string,
  message: string,
  signature: string,
): Promise<VerifyWalletSignatureResponse> =>
  postJson("/api/wallet/verify-signature", { walletAddress, message, signature });

export const createWalletSession = (
  walletAddress: string,
  message: string,
  signature: string,
): Promise<WalletSessionResponse> =>
  postJson("/api/wallet/session", { walletAddress, message, signature, purpose: "wallet-session" });

export const fetchLiveStreams = (walletToken: string): Promise<{ liveStreams: LiveStream[] }> =>
  getJsonWithHeaders("/api/livestreams", {
    Authorization: `Bearer ${walletToken}`,
  });

export const fetchLiveStreamById = (liveStreamId: string, walletToken: string): Promise<{ liveStream: LiveStream }> =>
  getJsonWithHeaders(`/api/livestreams/${encodeURIComponent(liveStreamId)}`, {
    Authorization: `Bearer ${walletToken}`,
  });

export const createCreatorLiveStream = (
  body: {
    title: string;
    accessType: "SUBSCRIPTION" | "PPV";
    ppvPriceMicrocredits?: string | number | bigint;
  },
  walletToken: string,
): Promise<CreateLiveStreamResponse> =>
  postJsonWithHeaders("/api/livestreams", body, {
    Authorization: `Bearer ${walletToken}`,
  });

export const fetchLiveStreamPlaybackToken = (
  liveStreamId: string,
  walletToken: string,
): Promise<LiveStreamPlaybackTokenResponse> =>
  getJsonWithHeaders(`/api/livestreams/${encodeURIComponent(liveStreamId)}/token`, {
    Authorization: `Bearer ${walletToken}`,
  });

export const endCreatorLiveStream = (
  liveStreamId: string,
  walletToken: string,
): Promise<{ ok: boolean; liveStreamId: string; status: string }> =>
  postJsonWithHeaders(`/api/livestreams/${encodeURIComponent(liveStreamId)}/end`, {}, {
    Authorization: `Bearer ${walletToken}`,
  });

export const verifyLiveStreamPurchase = (
  liveStreamId: string,
  body: {
    txId: string;
    walletAddressHint?: string;
  },
  walletToken: string,
): Promise<VerifyLiveStreamPurchaseResponse> =>
  postJsonWithHeaders(`/api/livestreams/${encodeURIComponent(liveStreamId)}/purchase/verify`, body, {
    Authorization: `Bearer ${walletToken}`,
  });
