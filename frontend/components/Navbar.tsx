"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import { WalletConnectButton } from "./WalletConnectButton";
import { getWalletRole, syncWalletRoleFromBackend, type AppRole } from "../lib/walletRole";

const NAV_LINKS = [
    { href: "/discover", label: "Discover" },
    { href: "/library", label: "Library" },
    { href: "/activity", label: "Activity" },
    { href: "/membership", label: "Membership" },
];

export function Navbar() {
    const pathname = usePathname();
    const { address, connected } = useWallet();
    const {
        enabled: anonEnabled,
        toggle: anonToggle,
        registrationStatus,
        registrationMessage,
    } = useAnonymousMode();

    const [role, setRole] = useState<AppRole | null>(null);
    const [scrolled, setScrolled] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    const profileRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLDivElement>(null);
    const navPillsRef = useRef<HTMLDivElement>(null);

    const isLanding = pathname === "/" || pathname === "/wallet" || pathname === "/role";
    const anonSessionActive = anonEnabled && registrationStatus === "active";
    const anonStatusLabel = anonEnabled ? (anonSessionActive ? "Active" : "Inactive") : null;

    // Mount animation
    useEffect(() => { setMounted(true); }, []);

    // Wallet role sync
    useEffect(() => {
        if (!connected || !address) { setRole(getWalletRole(null)); return; }
        setRole(getWalletRole(address));
        void syncWalletRoleFromBackend(address).then(setRole).catch(() => undefined);
    }, [address, connected, pathname]);

    // Scroll blur
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 60);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    // Close profile dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent | TouchEvent) => {
            if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
                setProfileOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("touchstart", handler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("touchstart", handler);
        };
    }, []);

    // Sliding tab indicator
    useEffect(() => {
        const container = navPillsRef.current;
        const indicator = indicatorRef.current;
        if (!container || !indicator) return;

        const active = container.querySelector<HTMLElement>(".nb-tab--active");
        if (!active) {
            indicator.style.opacity = "0";
            return;
        }
        const { offsetLeft, offsetWidth } = active;
        indicator.style.opacity = "1";
        indicator.style.transform = `translateX(${offsetLeft}px)`;
        indicator.style.width = `${offsetWidth}px`;
    }, [pathname]);

    const truncate = (addr: string) =>
        `${addr.slice(0, 6)}…${addr.slice(-4)}`;

    return (
        <nav
            className={`nb${scrolled ? " nb--scrolled" : ""}${mounted ? " nb--visible" : ""}${isLanding ? " nb--landing" : ""}`}
            aria-label="Main navigation"
        >
            {/* Ambient line */}
            <div className="nb__ambient" aria-hidden="true" />

            <div className="nb__inner">

                {/* ── LEFT: Logo ── */}
                <Link href="/home" className="nb__logo" aria-label="InnerCircle home">
                    <div className="nb__logo-orb" aria-hidden="true">
                        <span className="nb__logo-letters">IC</span>
                        <div className="nb__logo-pulse" />
                    </div>
                    <span className="nb__logo-text">InnerCircle</span>
                </Link>

                {/* ── CENTER: Nav tabs ── */}
                {!isLanding && (
                    <div className="nb__tabs-wrap">
                        <div className="nb__tabs" ref={navPillsRef}>
                            {/* Sliding active indicator */}
                            <div className="nb__tab-indicator" ref={indicatorRef} aria-hidden="true" />

                            {NAV_LINKS.map((link) => {
                                const isActive = pathname.startsWith(link.href);
                                return (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={`nb-tab${isActive ? " nb-tab--active" : ""}`}
                                    >
                                        {link.label}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── RIGHT: Controls ── */}
                <div className="nb__right">

                    {/* Anonymous Mode Toggle */}
                    <div className="nb__anon" title="Browse privately using Zero-Knowledge identity">
                        <span className="nb__anon-label">Anon</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={anonEnabled}
                            className={`nb__anon-toggle${anonEnabled ? " nb__anon-toggle--on" : ""}`}
                            onClick={() => anonToggle(!anonEnabled)}
                            aria-label="Toggle Anonymous Mode"
                        >
                            <span className="nb__anon-thumb" />
                        </button>
                        {anonStatusLabel ? (
                            <span
                                className={`nb__anon-status${anonSessionActive ? " nb__anon-status--active" : ""}`}
                                title={registrationMessage}
                            >
                                <span className="nb__anon-status-dot" aria-hidden="true" />
                                {anonStatusLabel}
                            </span>
                        ) : null}
                    </div>

                    {/* Wallet Button (existing component for logic) */}
                    <div className="nb__wallet">
                        <WalletConnectButton />
                    </div>

                    {/* Profile Avatar */}
                    {role && (
                        <div className="nb__profile-wrap" ref={profileRef}>
                            <button
                                type="button"
                                className={`nb__avatar${profileOpen ? " nb__avatar--open" : ""}`}
                                onClick={() => setProfileOpen((o) => !o)}
                                aria-label="Profile menu"
                            >
                                <span className="nb__avatar-ring" />
                                <span className="nb__avatar-letter">
                                    {role === "creator" ? "C" : address ? address.charAt(5).toUpperCase() : "U"}
                                </span>
                            </button>

                            {profileOpen && (
                                <div className="nb__dropdown" onClick={() => setProfileOpen(false)}>
                                    {connected && address && (
                                        <div className="nb__dropdown-addr">
                                            {truncate(address)}
                                        </div>
                                    )}
                                    <Link href={role === "creator" ? "/creator-studio/profile" : "/settings"} className="nb__dropdown-item">
                                        <span>👤</span> Profile
                                    </Link>
                                    <Link href="/settings" className="nb__dropdown-item">
                                        <span>⚙️</span> Settings
                                    </Link>
                                    <Link href="/membership" className="nb__dropdown-item">
                                        <span>💎</span> My Membership
                                    </Link>
                                    <div className="nb__dropdown-divider" />
                                    <Link href="/wallet" className="nb__dropdown-item nb__dropdown-item--danger">
                                        <span>🔓</span> Logout
                                    </Link>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Mobile Hamburger */}
                    <button
                        type="button"
                        className={`nb__hamburger${mobileOpen ? " nb__hamburger--open" : ""}`}
                        onClick={() => setMobileOpen((o) => !o)}
                        aria-label="Toggle mobile menu"
                    >
                        <span /><span /><span />
                    </button>
                </div>
            </div>

            {/* Mobile Drawer */}
            {mobileOpen && (
                <div className="nb__drawer" onClick={() => setMobileOpen(false)}>
                    {!isLanding && NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`nb__drawer-link${pathname.startsWith(link.href) ? " nb__drawer-link--active" : ""}`}
                        >
                            {link.label}
                        </Link>
                    ))}
                    {!connected && (
                        <Link href="/wallet" className="nb__drawer-link">Connect Wallet</Link>
                    )}
                </div>
            )}
        </nav>
    );
}
