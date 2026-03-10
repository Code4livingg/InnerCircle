"use client";

import { useMemo } from "react";
import {
  useWallet as useProvableWallet,
  type WalletContextState as ProvableWalletContextState,
} from "@provablehq/aleo-wallet-adaptor-react";

export type WalletContextState = ProvableWalletContextState & {
  publicKey: string | null;
  requestRecordPlaintexts?: (program: string) => Promise<unknown[]>;
};

export const useWallet = (): WalletContextState => {
  const wallet = useProvableWallet();

  const requestRecordPlaintexts = useMemo(
    () =>
      async (program: string): Promise<unknown[]> =>
        wallet.requestRecords(program, true),
    [wallet],
  );

  return useMemo(
    () => ({
      ...wallet,
      publicKey: wallet.address ?? null,
      requestRecordPlaintexts,
    }),
    [wallet, requestRecordPlaintexts],
  );
};
