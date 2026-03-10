export type AccessScope =
  | { type: "subscription"; creatorId: string }
  | { type: "ppv"; contentId: string };

export interface SessionClaims {
  sid: string;
  wh: string;
  scope: AccessScope;
  iat: number;
  exp: number;
}