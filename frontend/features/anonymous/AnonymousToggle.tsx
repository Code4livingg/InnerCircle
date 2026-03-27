"use client";

import { useAnonymousMode } from "./useAnonymousMode";

export function AnonymousToggle() {
  const { enabled, toggle } = useAnonymousMode();

  return (
    <div className="anon-toggle">
      <label className="anon-toggle__label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span>Anonymous Mode</span>
      </label>
      {enabled ? <span className="anon-toggle__indicator">Anonymous Mode ON</span> : null}
    </div>
  );
}
