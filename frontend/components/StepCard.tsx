interface StepCardProps {
    number: number;
    title: string;
    description: string;
}

export function StepCard({ number, title, description }: StepCardProps) {
    return (
        <div className="card card--step stack stack-3">
            <div className="step-number">{number}</div>
            <div className="stack stack-2">
                <h4>{title}</h4>
                <p className="t-sm">{description}</p>
            </div>
        </div>
    );
}
