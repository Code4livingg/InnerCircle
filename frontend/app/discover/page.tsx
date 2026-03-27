"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ApiError,
    fetchDiscoverFeed,
    fetchLiveStreams,
    type Creator,
    type DiscoverContent,
    type LiveStream,
} from "../../lib/api";
import { useWallet } from "@/lib/walletContext";
import { getWalletSessionToken } from "@/lib/walletSession";

const DISCOVERY_VIEWS = [
    { id: "All", label: "Feed" },
    { id: "PPV", label: "PPV Feed" },
    { id: "Live", label: "Live" },
    { id: "Creators", label: "Creators" },
] as const;

type DiscoveryView = (typeof DISCOVERY_VIEWS)[number]["id"];

function getInitials(
    subject: Pick<Creator, "displayName" | "handle"> | Pick<DiscoverContent["creator"], "displayName" | "handle">,
): string {
    const name = subject.displayName ?? subject.handle;
    return name
        .split(/\s+/)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .slice(0, 2)
        .join("");
}

function formatCredits(microcredits: string | null | undefined): string {
    if (!microcredits) {
        return "Free";
    }

    return `${(Number(microcredits) / 1_000_000).toFixed(2)} credits`;
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Recently";
    }

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
}

function FeedSkeleton() {
    return (
        <div className="disc-feed">
            {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="disc-post disc-post--skeleton">
                    <div className="disc-post__cover">
                        <div className="disc-post__badges">
                            <div className="disc-skeleton disc-skeleton--pill" />
                            <div className="disc-skeleton disc-skeleton--pill" />
                        </div>
                        <div className="disc-post__hero">
                            <div className="disc-post__headline">
                                <div className="disc-skeleton disc-skeleton--line disc-skeleton--sm" />
                                <div className="disc-skeleton disc-skeleton--line disc-skeleton--xxl" />
                                <div className="disc-skeleton disc-skeleton--line disc-skeleton--full" />
                            </div>
                            <div className="disc-skeleton disc-skeleton--badge" />
                        </div>
                    </div>
                    <div className="disc-post__body">
                        <div className="disc-post__header">
                            <div className="disc-post__avatar disc-skeleton" />
                            <div className="disc-post__creator">
                                <div className="disc-skeleton disc-skeleton--line disc-skeleton--md" />
                                <div className="disc-skeleton disc-skeleton--line disc-skeleton--sm" />
                            </div>
                        </div>
                        <div className="disc-skeleton disc-skeleton--line disc-skeleton--full" />
                        <div className="disc-skeleton disc-skeleton--line disc-skeleton--full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatSubscriptionPrice(microcredits: string | null | undefined): string {
    const amount = Number(microcredits ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        return "Free access";
    }

    return `${(amount / 1_000_000).toFixed(2)} credits / month`;
}

function formatFollowerLabel(followerCount: number | undefined): string {
    const count = followerCount ?? 0;
    return count === 1 ? "1 follower" : `${count} followers`;
}

function getCreatorPreviewCopy(creator: Creator): string {
    const bio = creator.bio?.trim();
    if (bio && bio.length > 0) {
        return bio.length > 140 ? `${bio.slice(0, 140)}...` : bio;
    }

    return "Private subscription feed, direct unlocks, and wallet-gated access in one page.";
}

export default function DiscoverPage() {
    const wallet = useWallet();
    const [creators, setCreators] = useState<Creator[]>([]);
    const [ppvContents, setPpvContents] = useState<DiscoverContent[]>([]);
    const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
    const [loading, setLoading] = useState(true);
    const [liveLoading, setLiveLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [liveError, setLiveError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [activeView, setActiveView] = useState<DiscoveryView>("All");

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        fetchDiscoverFeed(wallet.connected ? wallet.address : undefined)
            .then((data) => {
                if (cancelled) {
                    return;
                }

                setCreators(data.creators);
                setPpvContents(data.ppvContents);
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }

                if (err instanceof ApiError) {
                    setError(err.message);
                    return;
                }
                setError("Could not reach the backend. Make sure the server is running.");
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [wallet.connected, wallet.address]);

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

    const normalizedSearch = search.trim().toLowerCase();
    const filteredCreators = creators.filter((creator) => {
        if (!normalizedSearch) {
            return true;
        }

        return (
            (creator.displayName ?? creator.handle).toLowerCase().includes(normalizedSearch) ||
            creator.handle.toLowerCase().includes(normalizedSearch) ||
            (creator.bio ?? "").toLowerCase().includes(normalizedSearch)
        );
    });
    const filteredPpvContents = ppvContents.filter((content) => {
        if (!normalizedSearch) {
            return true;
        }

        return (
            content.title.toLowerCase().includes(normalizedSearch) ||
            (content.description ?? "").toLowerCase().includes(normalizedSearch) ||
            content.creator.handle.toLowerCase().includes(normalizedSearch) ||
            (content.creator.displayName ?? "").toLowerCase().includes(normalizedSearch)
        );
    });
    const showPpvSection = activeView === "All" || activeView === "PPV";
    const showCreatorsSection = activeView === "All" || activeView === "Creators";
    const shouldRenderPpvSection =
        showPpvSection && (activeView === "PPV" || loading || !!error || filteredPpvContents.length > 0 || !!normalizedSearch);
    const shouldRenderLiveSection =
        activeView === "Live" ||
        (activeView === "All" && wallet.connected && (liveLoading || !!liveError || liveStreams.length > 0));
    const shouldShowCreatorEmptyState =
        showCreatorsSection &&
        !loading &&
        !error &&
        filteredCreators.length === 0 &&
        (activeView === "Creators" || filteredPpvContents.length === 0);

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
                        Browse subscription creators, live rooms, and direct pay-per-view drops from one feed.
                    </p>
                </section>

                {/* Search + Filters */}
                <section className="disc-filters ic-fade-up ic-delay-100">
                    <div className="disc-search">
                        <span className="disc-search__icon">⌕</span>
                        <input
                            className="disc-search__input"
                            placeholder="Search creators, locked drops, or live rooms..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            id="discover-search"
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
                        {DISCOVERY_VIEWS.map((view) => (
                            <button
                                key={view.id}
                                className={`disc-pill${activeView === view.id ? " disc-pill--active" : ""}`}
                                onClick={() => setActiveView(view.id)}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>
                </section>

                {error ? (
                    <div className="disc-error">
                        <p>{error}</p>
                    </div>
                ) : null}

                {shouldRenderPpvSection ? (
                    <section className="disc-section disc-feed-shell ic-fade-up ic-delay-100">
                        <div className="disc-section__head">
                            <div className="disc-section__copy">
                                <p className="disc-section__eyebrow">Pay Per View Feed</p>
                                <h2 className="disc-section__title">Unlock posts directly. No subscription required.</h2>
                                <p className="disc-section__desc">
                                    Every drop here can be bought on its own. The feed stays locked until you choose a post,
                                    so viewers can browse first and pay only for the specific content they want.
                                </p>
                            </div>
                        </div>

                        {loading ? <FeedSkeleton /> : null}

                        {!loading && !error && filteredPpvContents.length === 0 ? (
                            <div className="card card--panel disc-panel-empty">
                                <p className="t-sm t-muted">
                                    {normalizedSearch
                                        ? `No pay-per-view drops match "${search}".`
                                        : "No pay-per-view posts have been published yet."}
                                </p>
                            </div>
                        ) : null}

                        {!loading && !error && filteredPpvContents.length > 0 ? (
                            <div className="disc-feed">
                                {filteredPpvContents.map((content) => {
                                    const creatorName = content.creator.displayName ?? content.creator.handle;
                                    const description = (content.description ?? "").trim();
                                    const previewCopy = description
                                        ? description.length > 140
                                            ? `${description.slice(0, 140)}...`
                                            : description
                                        : "Locked preview hidden until purchase.";

                                    return (
                                        <Link key={content.id} href={`/content/${content.id}`} className="disc-post-link">
                                            <article className="disc-post">
                                                <div className="disc-post__cover">
                                                    <div className="disc-post__badges">
                                                        <span className="disc-post__pill disc-post__pill--locked">Locked</span>
                                                        <span className="disc-post__pill">PPV</span>
                                                        <span className="disc-post__pill">{content.kind}</span>
                                                    </div>

                                                    <div className="disc-post__hero">
                                                        <div className="disc-post__headline">
                                                            <p className="disc-post__kicker">Direct unlock</p>
                                                            <h3 className="disc-post__cover-title">{content.title}</h3>
                                                            <p className="disc-post__cover-copy">{previewCopy}</p>
                                                        </div>
                                                        <div className="disc-post__price">{formatCredits(content.ppvPriceMicrocredits)}</div>
                                                    </div>
                                                </div>

                                                <div className="disc-post__body">
                                                    <div className="disc-post__header">
                                                        <div className="disc-post__avatar">{getInitials(content.creator)}</div>
                                                        <div className="disc-post__creator">
                                                            <div className="disc-post__creator-row">
                                                                <h4 className="disc-post__creator-name">{creatorName}</h4>
                                                                {content.creator.isVerified ? (
                                                                    <span className="disc-post__verified">Verified</span>
                                                                ) : null}
                                                            </div>
                                                            <p className="disc-post__creator-handle">
                                                                @{content.creator.handle} / {formatTimestamp(content.createdAt)}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {description ? (
                                                        <p className="disc-post__description">
                                                            {description.length > 200 ? `${description.slice(0, 200)}...` : description}
                                                        </p>
                                                    ) : null}

                                                    <div className="disc-post__footer">
                                                        <div className="disc-post__tags">
                                                            <span className="disc-post__tag">No subscription required</span>
                                                            <span className="disc-post__tag">Locked preview</span>
                                                            <span className="disc-post__tag">
                                                                {content.kind === "VIDEO" ? "Video post" : "Image post"}
                                                            </span>
                                                        </div>
                                                        <span className="disc-post__unlock">Open locked post</span>
                                                    </div>
                                                </div>
                                            </article>
                                        </Link>
                                    );
                                })}
                            </div>
                        ) : null}
                    </section>
                ) : null}

                {shouldRenderLiveSection ? (
                    <section className="disc-section stack stack-3 ic-fade-up ic-delay-100">
                        <div className="disc-section__head">
                            <div className="disc-section__copy">
                                <p className="disc-section__eyebrow">Live Now</p>
                                <h2 className="disc-section__title">Private live rooms</h2>
                                <p className="disc-section__desc">
                                    Subscription and PPV livestreams stay wallet-gated and stream through IVS playback tokens.
                                </p>
                            </div>
                        </div>

                        {!wallet.connected ? (
                            <div className="card card--panel disc-panel-empty">
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
                            <div className="card card--panel disc-panel-empty">
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
                                                    ? `${formatCredits(stream.ppvPriceMicrocredits)} pay-per-view`
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
                ) : null}

                {showCreatorsSection && loading ? (
                    <section className="disc-section disc-feed-shell ic-fade-up ic-delay-200">
                        <FeedSkeleton />
                    </section>
                ) : null}

                {shouldShowCreatorEmptyState && (
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

                {/* Creator Feed */}
                {showCreatorsSection && !loading && !error && filteredCreators.length > 0 && (
                    <section className="disc-section disc-feed-shell ic-fade-up ic-delay-200">
                        <div className="disc-section__head">
                            <div className="disc-section__copy">
                                <p className="disc-section__eyebrow">Creator Feed</p>
                                <h2 className="disc-section__title">Browse pages like a feed, not a directory.</h2>
                                <p className="disc-section__desc">
                                    Each row previews a creator page with pricing, bio, and a direct path into their private wall.
                                </p>
                            </div>
                        </div>

                        <div className="disc-feed">
                            {filteredCreators.map((creator) => {
                                const initials = getInitials(creator);
                                const creatorName = creator.displayName ?? creator.handle;
                                const previewCopy = getCreatorPreviewCopy(creator);
                                const description =
                                    creator.bio?.trim() || "Wallet-gated creator page with private drops, live rooms, and direct unlocks.";
                                const followerLabel = formatFollowerLabel(creator.followerCount);
                                const joinedLabel = formatTimestamp(creator.createdAt);
                                const subscriptionLabel = formatSubscriptionPrice(creator.subscriptionPriceMicrocredits);
                                const isPaidMembership =
                                    creator.subscriptionPriceMicrocredits !== null && Number(creator.subscriptionPriceMicrocredits) > 0;

                            return (
                                <Link key={creator.id} href={`/creator/${creator.handle}`} className="disc-post-link">
                                    <article className="disc-post disc-post--creator">
                                        <div className="disc-post__cover">
                                            <div className="disc-post__badges">
                                                <span className="disc-post__pill">Creator Feed</span>
                                                {creator.category ? <span className="disc-post__pill">{creator.category}</span> : null}
                                                {creator.isVerified ? (
                                                    <span className="disc-post__pill disc-post__pill--verified">Verified</span>
                                                ) : null}
                                            </div>

                                            <div className="disc-post__hero">
                                                <div className="disc-post__headline">
                                                    <p className="disc-post__kicker">Fresh page preview</p>
                                                    <h3 className="disc-post__cover-title">{creatorName}</h3>
                                                    <p className="disc-post__cover-copy">{previewCopy}</p>
                                                </div>
                                                <div className="disc-post__price disc-post__price--creator">{subscriptionLabel}</div>
                                            </div>

                                            <div className="disc-post__creator-strip">
                                                <span>{followerLabel}</span>
                                                <span>{isPaidMembership ? "Monthly subscription" : "Free page"}</span>
                                                <span>Joined {joinedLabel}</span>
                                            </div>
                                        </div>

                                        <div className="disc-post__body">
                                            <div className="disc-post__header">
                                                <div className="disc-post__avatar">{initials}</div>
                                                <div className="disc-post__creator">

                                                    <div className="disc-post__creator-row">
                                                        <h4 className="disc-post__creator-name">{creatorName}</h4>
                                                        {creator.isVerified ? (
                                                            <span className="disc-post__verified">Verified</span>
                                                        ) : null}
                                                    </div>
                                                    <p className="disc-post__creator-handle">
                                                        @{creator.handle} / {joinedLabel}
                                                    </p>
                                                </div>
                                            </div>

                                            <p className="disc-post__description">
                                                {description.length > 220 ? `${description.slice(0, 220)}...` : description}
                                            </p>

                                            <div className="disc-post__footer">
                                                <div className="disc-post__tags">
                                                    <span className="disc-post__tag">{followerLabel}</span>
                                                    <span className="disc-post__tag">
                                                        {isPaidMembership ? "Subscription access" : "Open profile"}
                                                    </span>
                                                    <span className="disc-post__tag">Private wallet-gated page</span>
                                                </div>
                                                <span className="disc-post__unlock">Open creator feed</span>
                                            </div>
                                        </div>
                                    </article>
                                </Link>
                            );
                        })}
                        </div>
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
