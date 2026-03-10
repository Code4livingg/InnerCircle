interface LockedContentCardProps {
    title?: string;
    locked?: boolean;
}

export function LockedContentCard({ title, locked = true }: LockedContentCardProps) {
    return (
        <div className="locked-card">
            {locked && (
                <div className="locked-card__blur">
                    <svg
                        className="lock-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                    >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
            )}
            {title && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: "8px 12px",
                        background: "linear-gradient(transparent, rgba(6,8,16,0.85))",
                        fontSize: "0.8125rem",
                        color: locked ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.85)",
                        fontWeight: 500,
                    }}
                >
                    {title}
                </div>
            )}
        </div>
    );
}
