export type AccessScope =
  | {
    type: "subscription";
    creatorId: string;
    verifiedBy?: "payment" | "proof" | "zk-proof";
    tier?: number;
    expiresAt?: number;
    // When present, playback can rely on the scoped entitlement instead of
    // re-querying purchases by a stable wallet identifier.
    entitlementBound?: boolean;
  }
  | { type: "ppv"; contentId: string; verifiedBy?: "payment" | "proof" };

export interface SessionClaims {
  sid: string;
  wh: string;
  // New sessions use an unlinkable per-session subject, while older sessions
  // still use the historical wallet hash in `wh`.
  ssh?: string;
  aid?: string;
  scope: AccessScope;
  iat: number;
  exp: number;
}
