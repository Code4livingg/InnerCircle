"use client";

export function ProofLoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="proof-loading-overlay">
      <div className="glass-card glass-card--compact">
        <div className="loading-spinner" />
        <p className="text-sm">Generating proof...</p>
      </div>
    </div>
  );
}