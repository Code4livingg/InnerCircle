"use client";

import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { LeoWalletAdapter } from "@provablehq/aleo-wallet-adaptor-leo";
import { PuzzleWalletAdapter } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { ReactNode } from "react";

// Program IDs declared up-front so wallets can authorize dApp access.
const PROGRAM_IDS = [
    "creator_reg_v2_xwnxp.aleo",
    "credits.aleo",
];

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
            decryptPermission={DecryptPermission.UponRequest}
            programs={PROGRAM_IDS}
            autoConnect={false}
            onError={(error) => console.warn("Wallet error:", error)}
        >
            {children}
        </AleoWalletProvider>
    );
}
