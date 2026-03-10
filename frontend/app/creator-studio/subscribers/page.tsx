export default function SubscribersPage() {
    return (
        <div style={{ padding: "var(--s4) 0" }}>
            <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
                <p className="section__label">Creator Studio</p>
                <h1 style={{ fontSize: "1.75rem" }}>Subscribers</h1>
            </div>

            <div className="card card--panel" style={{ marginBottom: "var(--s4)" }}>
                <div className="row row-2" style={{ marginBottom: "var(--s2)" }}>
                    <span style={{ color: "var(--c-violet)", fontSize: "1rem" }}>◉</span>
                    <p style={{ fontWeight: 600, color: "var(--c-text-1)" }}>Privacy-first subscriber data</p>
                </div>
                <p className="t-sm t-muted" style={{ lineHeight: 1.65 }}>
                    Subscriber identities are stored as private records on the Aleo blockchain.
                    You can see aggregate counts, but individual subscriber wallet addresses are never revealed —
                    not even to you. This is by design.
                </p>
            </div>

            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "var(--s6)" }}>
                <div className="stat-card">
                    <span className="stat-card__label">Total Subscribers</span>
                    <span className="stat-card__value" style={{ color: "var(--c-violet)" }}>—</span>
                    <span className="stat-card__sub">Fetched from Aleo network</span>
                </div>
                <div className="stat-card">
                    <span className="stat-card__label">Active This Month</span>
                    <span className="stat-card__value" style={{ color: "var(--c-teal)" }}>—</span>
                    <span className="stat-card__sub">Renewed subscriptions</span>
                </div>
            </div>

            <div className="empty-state">
                <span className="empty-state__icon">◉</span>
                <span className="empty-state__title">Subscriber data is private</span>
                <span className="empty-state__desc">
                    Individual subscriber details are not accessible. This protects your subscribers&apos; privacy.
                    Aggregate counts will appear here once the Aleo network integration is active.
                </span>
            </div>
        </div>
    );
}
