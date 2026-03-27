"use client";

import { useEffect } from "react";

export function RuntimeChecks(): null {
  useEffect(() => {
    console.log("[InnerCircle] crossOriginIsolated:", window.crossOriginIsolated);
    if (!window.crossOriginIsolated) {
      console.error("[InnerCircle] WASM proving will fail - not cross-origin isolated");
    }
  }, []);

  return null;
}
