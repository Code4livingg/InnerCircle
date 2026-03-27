"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { AnonymousToggle } from "@/features/anonymous/AnonymousToggle";
import { WalletConnectButton } from "./WalletConnectButton";
import { getWalletRole, syncWalletRoleFromBackend, type AppRole } from "../lib/walletRole";

export function Navbar() {
    const pathname = usePathname();
    const { address, connected } = useWallet();

    const [role, setRole] = useState<AppRole | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    // Sync wallet role
    useEffect(() => {
        if (!connected || !address) {
            setRole(getWalletRole(null));
            return;
        }
        setRole(getWalletRole(address));
        void syncWalletRoleFromBackend(address)
            .then((remoteRole) => { setRole(remoteRole); })
            .catch(() => undefined);
    }, [address, connected, pathname]);

    // Show frosted glass after scrolling past the hero
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 80);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const userLinks = [
        { href: "/discover", label: "Discover" },
        { href: "/library", label: "Library" },
    ];

    const creatorLinks = [
        { href: "/creator-studio/dashboard", label: "Studio" },
        { href: "/discover", label: "Discover" },
    ];

    const links = role === "creator" ? creatorLinks : userLinks;
    const isLanding = pathname === "/" || pathname === "/wallet" || pathname === "/role";

    return (
        <nav className={`navbar${isLanding ? " navbar--landing" : ""}${isLanding && scrolled ? " is-scrolled" : ""}`}>
            <div className="navbar__inner">
                <Link href="/" className="navbar__logo">
                    {isLanding ? (
                        <div className="navbar__logo-dot" />
                    ) : (
                        <span className="navbar__logo-icon">IC</span>
                    )}
                    <span>InnerCircle</span>
                </Link>

                {!isLanding && (
                    <div className="navbar__links">
                        {links.map((l) => (
                            <Link
                                key={l.href}
                                href={l.href}
                                className={`navbar__link${pathname.startsWith(l.href) ? " navbar__link--active" : ""}`}
                            >
                                {l.label}
                            </Link>
                        ))}
                    </div>
                )}

                <div className="navbar__right">
                    <AnonymousToggle />
                    <WalletConnectButton />
                    {role && (
                        <Link
                            href={role === "creator" ? "/creator-studio/profile" : "/settings"}
                            className="navbar__avatar"
                            title="Profile"
                        >
                            {role === "creator" ? "C" : "F"}
                        </Link>
                    )}
                    <button
                        className="navbar__hamburger"
                        onClick={() => setMenuOpen(!menuOpen)}
                        aria-label="Toggle menu"
                    >
                        <span />
                        <span />
                        <span />
                    </button>
                </div>
            </div>

            {menuOpen && (
                <div className="navbar__drawer" onClick={() => setMenuOpen(false)}>
                    {!isLanding && links.map((l) => (
                        <Link key={l.href} href={l.href} className="navbar__drawer-link">
                            {l.label}
                        </Link>
                    ))}
                    {!role && <Link href="/wallet" className="navbar__drawer-link">Connect Wallet</Link>}
                </div>
            )}
        </nav>
    );
}
