import Link from "next/link";
import { ApiError, fetchCreators, type Creator } from "../../lib/api";

const CATEGORIES = ["All", "Art", "Music", "Writing", "Technology", "Film"];

// Derive initials from display name or handle
function getInitials(creator: Creator): string {
    const name = creator.displayName ?? creator.handle;
    return name
        .split(/\s+/)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .slice(0, 2)
        .join("");
}

// Deterministic accent color from handle string
function accentColor(handle: string): string {
    const PALETTE = ["#7c6fcd", "#4e9ea3", "#8a7fbd", "#5a9e72", "#9e7a4e", "#6a7fbd", "#a07090"];
    let hash = 0;
    for (let i = 0; i < handle.length; i++) hash = handle.charCodeAt(i) + ((hash << 5) - hash);
    return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default async function CreatorsPage() {
    let creators: Creator[] = [];
    let error: string | null = null;

    try {
        const data = await fetchCreators();
        creators = data.creators;
    } catch (err) {
        if (err instanceof ApiError) {
            error = err.message;
        } else {
            error = "Could not reach the backend. Make sure the server is running.";
        }
    }

    return (
        <main className="creators-page">
            <div className="container">

                {/* Header */}
                <div className="page-header stack stack-2">
                    <p className="section__label">Discover</p>
                    <h1>Private Creators</h1>
                    <p className="t-muted" style={{ maxWidth: 520 }}>
                        Subscribe privately. Your membership is stored as a zero-knowledge record —
                        invisible to everyone except you.
                    </p>
                </div>

                {/* Filter bar — client-side filtering requires a client component; keep static for now */}
                <div className="filter-bar">
                    {CATEGORIES.map((cat) => (
                        <span key={cat} className={`filter-pill${cat === "All" ? " filter-pill--active" : ""}`}>
                            {cat}
                        </span>
                    ))}
                </div>

                {/* Error state */}
                {error && (
                    <div className="card card--panel" style={{ marginBottom: "var(--s4)" }}>
                        <p className="t-sm t-error">{error}</p>
                    </div>
                )}

                {/* Empty state */}
                {!error && creators.length === 0 && (
                    <div className="card card--panel" style={{ textAlign: "center", padding: "var(--s8)" }}>
                        <p className="t-muted">No creators have registered yet.</p>
                        <p className="t-sm t-dim" style={{ marginTop: "var(--s2)" }}>
                            Be the first — connect your wallet and register as a creator.
                        </p>
                    </div>
                )}

                {/* Creator grid */}
                {creators.length > 0 && (
                    <div className="creators-grid">
                        {creators.map((creator) => {
                            const color = accentColor(creator.handle);
                            const initials = getInitials(creator);
                            const price = creator.subscriptionPriceMicrocredits
                                ? `${(Number(creator.subscriptionPriceMicrocredits) / 1_000_000).toFixed(2)} credits`
                                : null;

                            return (
                                <Link
                                    key={creator.id}
                                    href={`/creator/${creator.handle}`}
                                    style={{ textDecoration: "none" }}
                                >
                                    <div className="card creator-card">
                                        <div className="row row-3">
                                            <div
                                                className="creator-card__avatar"
                                                style={{
                                                    background: `radial-gradient(circle at 35% 35%, ${color}33, ${color}11)`,
                                                    border: `1px solid ${color}44`,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: "0.8125rem",
                                                    fontWeight: 600,
                                                    color,
                                                    letterSpacing: "0.04em",
                                                }}
                                            >
                                                {initials}
                                            </div>
                                            <div className="creator-card__meta">
                                                <span className="creator-card__name">
                                                    {creator.displayName ?? creator.handle}
                                                </span>
                                                <span className="creator-card__category t-xs t-dim">
                                                    @{creator.handle}
                                                    {creator.isVerified && " ✓"}
                                                </span>
                                            </div>
                                        </div>

                                        {creator.bio && (
                                            <p className="t-sm t-muted" style={{ lineHeight: 1.65 }}>
                                                {creator.bio.length > 100
                                                    ? creator.bio.slice(0, 100) + "…"
                                                    : creator.bio}
                                            </p>
                                        )}

                                        <div className="creator-card__footer">
                                            <span className="badge badge--locked">
                                                {price ?? "Private"}
                                            </span>
                                            <span className="btn btn--secondary btn--sm">Subscribe</span>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}

            </div>
        </main>
    );
}
