import { ButtonHTMLAttributes, ReactNode } from "react";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md" | "lg";
    className?: string;
}

export function GlassButton({
    children,
    variant = "primary",
    size = "md",
    className = "",
    ...props
}: GlassButtonProps) {
    const variantClass = {
        primary: "btn btn--primary",
        secondary: "btn btn--secondary",
        ghost: "btn btn--ghost",
    }[variant];

    const sizeClass = {
        sm: "btn--sm",
        md: "",
        lg: "btn--lg",
    }[size];

    return (
        <button className={`${variantClass} ${sizeClass} ${className}`} {...props}>
            {children}
        </button>
    );
}
