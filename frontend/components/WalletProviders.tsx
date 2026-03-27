"use client";

import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { LeoWalletAdapter } from "@provablehq/aleo-wallet-adaptor-leo";
import { PuzzleWalletAdapter } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { ReactNode } from "react";

const uniquePrograms = (values: Array<string | undefined>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const value of values) {
        const normalized = value?.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }

    return out;
};

// Program IDs declared up-front so wallets can authorize dApp access.
const PROGRAM_IDS = uniquePrograms([
    "creator_reg_v5_xwnxp.aleo",
    "credits.aleo",
    process.env.NEXT_PUBLIC_USDCX_PROGRAM_ID,
    process.env.NEXT_PUBLIC_PAYMENT_PROOF_PROGRAM_ID,
    process.env.NEXT_PUBLIC_SUBSCRIPTION_PROGRAM_ID,
    process.env.NEXT_PUBLIC_TIP_PROGRAM_ID,
    "sub_invoice_v8_xwnxp.aleo",
    "sub_pay_v6_xwnxp.aleo",
    "tip_pay_v4_xwnxp.aleo",
    "test_usdcx_stablecoin.aleo",
]);

const wallets = [
    new ShieldWalletAdapter(),
    new PuzzleWalletAdapter({
        appName: "InnerCircle",
        appDescription: "Privacy-first creator platform on Aleo",
        programIdPermissions: {
            [Network.TESTNET]: PROGRAM_IDS,
        },
    }),
    new LeoWalletAdapter(),
];

export function WalletProviders({ children }: { children: ReactNode }) {
    return (
        <AleoWalletProvider
            wallets={wallets}
            network={Network.TESTNET}
            decryptPermission={DecryptPermission.OnChainHistory}
            programs={PROGRAM_IDS}
            autoConnect={false}
            onError={(error) => console.warn("Wallet error:", error)}
        >
            {children}
        </AleoWalletProvider>
    );
}
