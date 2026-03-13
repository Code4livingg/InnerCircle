"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarItem {
    href: string;
    label: string;
    icon: string;
}

const USER_ITEMS: SidebarItem[] = [
    { href: "/discover", label: "Discover", icon: "◈" },
    { href: "/library", label: "Library", icon: "▣" },
    { href: "/settings", label: "Settings", icon: "◎" },
];

const CREATOR_ITEMS: SidebarItem[] = [
    { href: "/creator-studio/dashboard", label: "Dashboard", icon: "◈" },
    { href: "/creator-studio/go-live", label: "Go Live", icon: "▶" },
    { href: "/creator-studio/upload", label: "Upload", icon: "⊕" },
    { href: "/creator-studio/content", label: "My Content", icon: "▣" },
    { href: "/creator-studio/subscribers", label: "Subscribers", icon: "◉" },
    { href: "/creator-studio/earnings", label: "Earnings", icon: "◇" },
    { href: "/creator-studio/profile", label: "Profile", icon: "◎" },
];

interface SidebarProps {
    role: "user" | "creator";
}

export function Sidebar({ role }: SidebarProps) {
    const pathname = usePathname();
    const items = role === "creator" ? CREATOR_ITEMS : USER_ITEMS;

    return (
        <aside className="sidebar">
            <div className="sidebar__section-label">
                {role === "creator" ? "Creator Studio" : "My Account"}
            </div>
            <nav className="sidebar__nav">
                {items.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`sidebar__item${pathname === item.href || pathname.startsWith(item.href + "/") ? " sidebar__item--active" : ""}`}
                    >
                        <span className="sidebar__icon">{item.icon}</span>
                        <span>{item.label}</span>
                    </Link>
                ))}
            </nav>
        </aside>
    );
}
