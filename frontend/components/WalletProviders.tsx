"use client";

import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { LeoWalletAdapter } from "@provablehq/aleo-wallet-adaptor-leo";
import { PuzzleWalletAdapter } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { ReactNode } from "react";
import { useAutoAnonRegistration } from "@/features/anonymous/useAutoAnonRegistration";
import { WALLET_PROGRAM_IDS } from "@/lib/programIds";

const wallets = [
    new ShieldWalletAdapter(),
    new PuzzleWalletAdapter({
        appName: "InnerCircle",
        appDescription: "Privacy-first creator platform on Aleo",
        programIdPermissions: {
            [Network.TESTNET]: WALLET_PROGRAM_IDS,
        },
    }),
    new LeoWalletAdapter(),
];

function AnonymousSessionBootstrap() {
    useAutoAnonRegistration();
    return null;
}

export function WalletProviders({ children }: { children: ReactNode }) {
    return (
        <AleoWalletProvider
            wallets={wallets}
            network={Network.TESTNET}
            decryptPermission={DecryptPermission.OnChainHistory}
            programs={WALLET_PROGRAM_IDS}
            autoConnect={false}
            onError={(error) => console.warn("Wallet error:", error)}
        >
            <AnonymousSessionBootstrap />
            {children}
        </AleoWalletProvider>
    );
}
