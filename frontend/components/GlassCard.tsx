import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "compact" | "hero" | "panel" | "step";
  onClick?: () => void;
}

export function GlassCard({
  children,
  className = "",
  variant = "default",
  onClick,
}: GlassCardProps) {
  const variantClass = {
    default: "card",
    compact: "card card--compact",
    hero: "card card--hero",
    panel: "card card--panel",
    step: "card card--step",
  }[variant];

  return (
    <div className={`${variantClass} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}
