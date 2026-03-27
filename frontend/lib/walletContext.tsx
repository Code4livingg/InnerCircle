"use client";

import { useMemo } from "react";
import {
  useWallet as useProvableWallet,
  type WalletContextState as ProvableWalletContextState,
} from "@provablehq/aleo-wallet-adaptor-react";

export type WalletContextState = ProvableWalletContextState & {
  publicKey: string | null;
  requestRecordPlaintexts?: (program: string) => Promise<unknown[]>;
  requestProgramRecords?: (program: string, decrypt?: boolean) => Promise<unknown[]>;
};

export const useWallet = (): WalletContextState => {
  const wallet = useProvableWallet();

  const requestProgramRecords = useMemo(
    () =>
      async (program: string, decrypt = true): Promise<unknown[]> =>
        wallet.requestRecords(program, decrypt),
    [wallet],
  );

  const requestRecordPlaintexts = useMemo(
    () =>
      async (program: string): Promise<unknown[]> =>
        requestProgramRecords(program, true),
    [requestProgramRecords],
  );

  return useMemo(
    () => ({
      ...wallet,
      publicKey: wallet.address ?? null,
      requestRecordPlaintexts,
      requestProgramRecords,
    }),
    [wallet, requestRecordPlaintexts, requestProgramRecords],
  );
};
