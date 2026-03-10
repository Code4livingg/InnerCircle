"use client";

import { ApiError, claimWalletRoleLock, fetchWalletRoleLock } from "./api";

export type AppRole = "user" | "creator";

const LEGACY_ROLE_KEY = "onlyaleo_role";
const ROLE_MAP_KEY = "onlyaleo_wallet_roles_v1";

export class WalletRoleConflictError extends Error {
  readonly existingRole: AppRole;
  readonly requestedRole: AppRole;

  constructor(existingRole: AppRole, requestedRole: AppRole) {
    super(`This wallet is already locked as ${existingRole}. Use a different wallet for ${requestedRole}.`);
    this.name = "WalletRoleConflictError";
    this.existingRole = existingRole;
    this.requestedRole = requestedRole;
  }
}

const isRole = (value: unknown): value is AppRole => value === "user" || value === "creator";

const normalizeWallet = (walletAddress: string): string => walletAddress.trim().toLowerCase();

const readRoleMap = (): Record<string, AppRole> => {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(ROLE_MAP_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cleaned: Record<string, AppRole> = {};
    for (const [wallet, role] of Object.entries(parsed)) {
      if (wallet && isRole(role)) {
        cleaned[wallet] = role;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
};

const writeRoleMap = (map: Record<string, AppRole>): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ROLE_MAP_KEY, JSON.stringify(map));
};

export const getWalletRole = (walletAddress?: string | null): AppRole | null => {
  if (typeof window === "undefined") return null;

  if (walletAddress) {
    const mapped = readRoleMap()[normalizeWallet(walletAddress)];
    return mapped ?? null;
  }

  const legacy = window.localStorage.getItem(LEGACY_ROLE_KEY);
  return isRole(legacy) ? legacy : null;
};

export const claimWalletRole = (walletAddress: string, role: AppRole): AppRole => {
  if (typeof window === "undefined") return role;

  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) {
    throw new Error("Wallet address is required.");
  }

  const roleMap = readRoleMap();
  const existingRole = roleMap[normalizedWallet];
  if (existingRole && existingRole !== role) {
    throw new WalletRoleConflictError(existingRole, role);
  }

  roleMap[normalizedWallet] = role;
  writeRoleMap(roleMap);
  window.localStorage.setItem(LEGACY_ROLE_KEY, role);
  return role;
};

export const syncWalletRoleFromBackend = async (walletAddress: string): Promise<AppRole | null> => {
  const remote = await fetchWalletRoleLock(walletAddress);
  if (!remote.role) {
    return getWalletRole(walletAddress);
  }

  claimWalletRole(walletAddress, remote.role);
  return remote.role;
};

export const claimWalletRoleWithBackend = async (walletAddress: string, role: AppRole): Promise<AppRole> => {
  claimWalletRole(walletAddress, role);

  try {
    await claimWalletRoleLock(walletAddress, role);
    return role;
  } catch (error) {
    if (error instanceof ApiError && error.code === "DB_UNAVAILABLE") {
      return role;
    }

    if (error instanceof ApiError && error.code === "ROLE_CONFLICT") {
      const remote = await syncWalletRoleFromBackend(walletAddress).catch(() => null);
      if (remote && remote !== role) {
        throw new WalletRoleConflictError(remote, role);
      }
    }
    throw error;
  }
};
