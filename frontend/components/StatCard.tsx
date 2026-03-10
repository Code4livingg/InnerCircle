interface StatCardProps {
    label: string;
    value: string | number;
    sub?: string;
    accent?: string;
}

export function StatCard({ label, value, sub, accent = "var(--c-violet)" }: StatCardProps) {
    return (
        <div className="stat-card">
            <span className="stat-card__label">{label}</span>
            <span className="stat-card__value" style={{ color: accent }}>{value}</span>
            {sub && <span className="stat-card__sub">{sub}</span>}
        </div>
    );
}
