"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "../../components/Sidebar";
import { useWallet } from "@/lib/walletContext";
import { WalletConnectButton } from "../../components/WalletConnectButton";
import { getWalletRole, syncWalletRoleFromBackend, type AppRole } from "../../lib/walletRole";

export default function CreatorStudioLayout({ children }: { children: React.ReactNode }) {
    const { connected, address } = useWallet();
    const [role, setRole] = useState<AppRole | null>(null);

    useEffect(() => {
        if (!connected || !address) {
            localStorage.removeItem("innercircle_creator_handle");
            setRole(null);
            return;
        }

        setRole(getWalletRole(address));
        void syncWalletRoleFromBackend(address)
            .then((remoteRole) => {
                setRole(remoteRole);
            })
            .catch(() => undefined);
    }, [connected, address]);

    if (!connected || !address) {
        return (
            <div className="layout-with-sidebar">
                <Sidebar role="creator" />
                <div className="sidebar__content">
                    <div className="card card--panel" style={{ maxWidth: 640, marginTop: "var(--s4)" }}>
                        <p className="section__label">Creator Studio</p>
                        <h2 style={{ margin: "0.5rem 0 1rem", fontSize: "1.5rem" }}>Connect Wallet To Continue</h2>
                        <p className="t-sm t-muted" style={{ marginBottom: "var(--s3)" }}>
                            Creator profile and content data are private and only shown to the connected wallet owner.
                        </p>
                        <WalletConnectButton />
                    </div>
                </div>
            </div>
        );
    }

    if (role === "user") {
        return (
            <div className="layout-with-sidebar">
                <Sidebar role="creator" />
                <div className="sidebar__content">
                    <div className="card card--panel" style={{ maxWidth: 640, marginTop: "var(--s4)" }}>
                        <p className="section__label">Creator Studio</p>
                        <h2 style={{ margin: "0.5rem 0 1rem", fontSize: "1.5rem" }}>Wallet Role Locked</h2>
                        <p className="t-sm t-muted">
                            This wallet is locked as fan and cannot access creator tools. Connect a creator wallet instead.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="layout-with-sidebar">
            <Sidebar role="creator" />
            <div className="sidebar__content">{children}</div>
        </div>
    );
}
