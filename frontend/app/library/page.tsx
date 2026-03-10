"use client";

import { useState } from "react";
import Link from "next/link";

export default function LibraryPage() {
    const [tab, setTab] = useState<"subscriptions" | "purchases">("subscriptions");

    return (
        <main style={{ padding: "var(--s6) var(--s4)", maxWidth: "var(--max-w)", margin: "0 auto" }}>
            <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
                <p className="section__label">My Library</p>
                <h1 style={{ fontSize: "2rem" }}>Your Content</h1>
            </div>

            {/* Tabs */}
            <div className="filter-bar" style={{ marginBottom: "var(--s6)" }}>
                <button
                    className={`filter-pill${tab === "subscriptions" ? " filter-pill--active" : ""}`}
                    onClick={() => setTab("subscriptions")}
                >
                    Subscriptions
                </button>
                <button
                    className={`filter-pill${tab === "purchases" ? " filter-pill--active" : ""}`}
                    onClick={() => setTab("purchases")}
                >
                    Purchases
                </button>
            </div>

            {/* Empty state — subscriptions are stored on-chain, not in our DB */}
            <div className="empty-state">
                <span className="empty-state__icon">{tab === "subscriptions" ? "◉" : "▣"}</span>
                <span className="empty-state__title">
                    {tab === "subscriptions" ? "No active subscriptions" : "No purchases yet"}
                </span>
                <span className="empty-state__desc">
                    {tab === "subscriptions"
                        ? "Your subscriptions are stored as private records on the Aleo blockchain. Connect your wallet and visit a creator to subscribe."
                        : "Pay-per-view purchases will appear here after you unlock content."}
                </span>
                <Link href="/discover" className="btn btn--primary btn--sm">
                    Browse Creators
                </Link>
            </div>
        </main>
    );
}
