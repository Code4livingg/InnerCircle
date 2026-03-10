import { InputHTMLAttributes } from "react";

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
}

export function GlassInput({ label, className = "", ...props }: GlassInputProps) {
    return (
        <div className="glass-input-wrapper">
            {label && <label className="glass-input-label">{label}</label>}
            <input className={`glass-input ${className}`} {...props} />
        </div>
    );
}
