import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { walletHashForAddress } from "./walletRoleService.js";

export interface WalletSessionClaims {
  typ: "wallet";
  wh: string;
  // Old wallet-session JWTs still carry the raw address. New ones do not.
  addr?: string;
  exp: number;
}

export interface WalletSessionTokenResult {
  token: string;
  expiresAt: number;
  walletHash: string;
}

export const createWalletSessionToken = (walletAddress: string): WalletSessionTokenResult => {
  const expiresAt = Math.floor(Date.now() / 1000) + env.sessionTtlSeconds;
  const walletHash = walletHashForAddress(walletAddress);
  const token = jwt.sign(
    {
      typ: "wallet",
      wh: walletHash,
      exp: expiresAt,
    } satisfies WalletSessionClaims,
    env.sessionSecret,
  );

  return {
    token,
    expiresAt,
    walletHash,
  };
};

export const validateWalletSessionToken = (token: string): WalletSessionClaims => {
  const claims = jwt.verify(token, env.sessionSecret) as WalletSessionClaims;
  if (claims.typ !== "wallet" || !claims.wh) {
    throw new Error("Invalid wallet session token");
  }

  return claims;
};
