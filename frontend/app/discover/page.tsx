"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ApiError, fetchCreators, fetchLiveStreams, type Creator, type LiveStream } from "../../lib/api";
import { useWallet } from "@/lib/walletContext";
import { getWalletSessionToken } from "@/lib/walletSession";

const CATEGORIES = ["All", "Art", "Music", "Writing", "Technology", "Film", "Education"];

function getInitials(creator: Pick<Creator, "displayName" | "handle">): string {
    const name = creator.displayName ?? creator.handle;
    return name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
}

function SkeletonGrid() {
    return (
        <div className="disc-grid">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="disc-card disc-card--skeleton">
                    <div className="disc-card__avatar disc-skeleton" />
                    <div className="disc-skeleton disc-skeleton--line disc-skeleton--md" />
                    <div className="disc-skeleton disc-skeleton--line disc-skeleton--sm" />
                    <div className="disc-skeleton disc-skeleton--line disc-skeleton--full" />
                </div>
            ))}
        </div>
    );
}

export default function DiscoverPage() {
    const wallet = useWallet();
    const [creators, setCreators] = useState<Creator[]>([]);
    const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
    const [loading, setLoading] = useState(true);
    const [liveLoading, setLiveLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [liveError, setLiveError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [activeCategory, setActiveCategory] = useState("All");

    useEffect(() => {
        fetchCreators()
            .then((data) => setCreators(data.creators))
            .catch((err) => {
                if (err instanceof ApiError) {
                    setError(err.message);
                    return;
                }
                setError("Could not reach the backend. Make sure the server is running.");
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const hydrateLiveStreams = async () => {
            if (!wallet.connected || !wallet.address) {
                setLiveStreams([]);
                setLiveError(null);
                setLiveLoading(false);
                return;
            }

            setLiveLoading(true);
            setLiveError(null);

            try {
                const walletToken = await getWalletSessionToken(wallet);
                const data = await fetchLiveStreams(walletToken);
                setLiveStreams(data.liveStreams);
            } catch (err) {
                setLiveStreams([]);
                setLiveError((err as Error).message || "Could not load live streams.");
            } finally {
                setLiveLoading(false);
            }
        };

        void hydrateLiveStreams();
    }, [wallet]);

    const filtered = creators.filter((c) => {
        const q = search.toLowerCase();
        const matchSearch = !q ||
            (c.displayName ?? c.handle).toLowerCase().includes(q) ||
            (c.bio ?? "").toLowerCase().includes(q);
        return matchSearch;
    });

    return (
        <main className="disc-page">
            {/* Glow */}
            <div className="disc-glow" aria-hidden="true" />

            <div className="disc-container">

                {/* Hero Discovery Header */}
                <section className="disc-hero ic-fade-up">
                    <div className="disc-hero__glow" />
                    <div className="disc-badge">
                        <span className="disc-badge__icon">◈</span>
                        <span>Zero-Knowledge Membership</span>
                    </div>
                    <h1 className="disc-hero__title">Discover Private Creators</h1>
                    <p className="disc-hero__desc">
                        Join creators privately. Your membership exists only as a zero-knowledge record on the Aleo network.
                    </p>
                </section>

                {/* Search + Filters */}
                <section className="disc-filters ic-fade-up ic-delay-100">
                    <div className="disc-search">
                        <span className="disc-search__icon">⌕</span>
                        <input
                            className="disc-search__input"
                            placeholder="Search creators by name, niche, or vibe..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            id="creator-search"
                        />
                        {search && (
                            <button
                                className="disc-search__clear"
                                onClick={() => setSearch("")}
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    <div className="disc-pills">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat}
                                className={`disc-pill${activeCategory === cat ? " disc-pill--active" : ""}`}
                                onClick={() => setActiveCategory(cat)}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="stack stack-3 ic-fade-up ic-delay-100" style={{ marginBottom: "var(--s4)" }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--s2)", flexWrap: "wrap" }}>
                        <div className="stack stack-1">
                            <p className="section__label" style={{ marginBottom: 0 }}>Live Now</p>
                            <p className="t-sm t-muted">
                                Private live streams gated by Aleo wallet access and IVS playback tokens.
                            </p>
                        </div>
                    </div>

                    {!wallet.connected ? (
                        <div className="card card--panel">
                            <p className="t-sm t-muted">Connect your wallet to view live private streams.</p>
                        </div>
                    ) : null}

                    {wallet.connected && liveLoading ? (
                        <div className="disc-grid">
                            {Array.from({ length: 2 }).map((_, index) => (
                                <div key={index} className="disc-card disc-card--skeleton" />
                            ))}
                        </div>
                    ) : null}

                    {wallet.connected && liveError ? (
                        <div className="disc-error">
                            <p>{liveError}</p>
                        </div>
                    ) : null}

                    {wallet.connected && !liveLoading && !liveError && liveStreams.length === 0 ? (
                        <div className="card card--panel">
                            <p className="t-sm t-muted">No creators are live right now.</p>
                        </div>
                    ) : null}

                    {wallet.connected && liveStreams.length > 0 ? (
                        <div className="disc-grid">
                            {liveStreams.map((stream) => (
                                <Link key={stream.id} href={`/live/${stream.id}`} className="disc-card-link">
                                    <div className="disc-card">
                                        <span className="disc-card__tag" style={{ color: "var(--c-violet)" }}>LIVE</span>
                                        <div className="disc-card__avatar">
                                            {getInitials({
                                                displayName: stream.creator.displayName,
                                                handle: stream.creator.handle,
                                            })}
                                        </div>
                                        <h3 className="disc-card__name">{stream.title}</h3>
                                        <p className="disc-card__handle">@{stream.creator.handle}</p>
                                        <p className="disc-card__bio">
                                            {stream.accessType === "PPV"
                                                ? `${(Number(stream.ppvPriceMicrocredits ?? "0") / 1_000_000).toFixed(2)} credits pay-per-view`
                                                : "Subscription-gated live stream"}
                                        </p>
                                        <div className="disc-card__divider" />
                                        <div className="disc-card__footer">
                                            <span className="disc-card__price">{stream.accessType}</span>
                                            <span className="disc-card__view">Watch</span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : null}
                </section>

                {/* States */}
                {loading && <SkeletonGrid />}

                {error && (
                    <div className="disc-error">
                        <p>{error}</p>
                    </div>
                )}

                {!loading && !error && filtered.length === 0 && (
                    <div className="disc-empty ic-fade-up">
                        <div className="disc-empty__icon">◈</div>
                        <p className="disc-empty__title">
                            {search ? "No creators found" : "No creators yet"}
                        </p>
                        <p className="disc-empty__desc">
                            {search
                                ? `No results for "${search}". Try a different search.`
                                : "Be the first to register as a creator and start publishing private content."}
                        </p>
                        {!search && (
                            <Link href="/creator-studio/onboarding" className="ic-btn-red">
                                Become a Creator
                            </Link>
                        )}
                    </div>
                )}

                {/* Creator Grid */}
                {!loading && !error && filtered.length > 0 && (
                    <section className="disc-grid ic-fade-up ic-delay-200">
                        {filtered.map((creator) => {
                            const initials = getInitials(creator);
                            const price = creator.subscriptionPriceMicrocredits
                                ? `${(Number(creator.subscriptionPriceMicrocredits) / 1_000_000).toFixed(2)} CREDITS`
                                : "FREE";

                            return (
                                <Link key={creator.id} href={`/creator/${creator.handle}`} className="disc-card-link">
                                    <div className="disc-card">
                                        {creator.category && (
                                            <span className="disc-card__tag">{creator.category}</span>
                                        )}

                                        <div className="disc-card__avatar">
                                            {initials}
                                        </div>

                                        <h3 className="disc-card__name">
                                            {creator.displayName ?? creator.handle}
                                            {creator.isVerified && <span className="disc-card__verified">✓</span>}
                                        </h3>
                                        <p className="disc-card__handle">@{creator.handle}</p>

                                        {creator.bio && (
                                            <p className="disc-card__bio">
                                                {creator.bio.length > 90 ? creator.bio.slice(0, 90) + "…" : creator.bio}
                                            </p>
                                        )}

                                        <div className="disc-card__divider" />

                                        <div className="disc-card__footer">
                                            <span className="disc-card__price">{price}</span>
                                            <span className="disc-card__view">View</span>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </section>
                )}

                {/* Privacy Footer */}
                <footer className="disc-footer ic-fade-up ic-delay-300">
                    <div className="disc-footer__icon">◈</div>
                    <p className="disc-footer__text">
                        InnerCircle memberships exist as private records on Aleo.<br />
                        No public subscriptions. No visible transactions.
                    </p>
                </footer>
            </div>
        </main>
    );
}
