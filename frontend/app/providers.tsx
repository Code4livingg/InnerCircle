"use client";

import { WalletProviders } from "../components/WalletProviders";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
