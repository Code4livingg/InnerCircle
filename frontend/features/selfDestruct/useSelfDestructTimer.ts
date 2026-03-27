"use client";

import { useEffect, useMemo, useState } from "react";

export const useCountdownSeconds = (expiresAt?: string | null) => {
  const target = useMemo(() => (expiresAt ? new Date(expiresAt).getTime() : null), [expiresAt]);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!target) {
      setSecondsLeft(null);
      return undefined;
    }

    const update = () => {
      const diff = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setSecondsLeft(diff);
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [target]);

  return secondsLeft;
};

export const formatRemainingLabel = (secondsLeft: number | null): string | null => {
  if (secondsLeft === null) return null;
  return `⏳ Disappears in ${secondsLeft} seconds`;
};

export const formatViewRemainingLabel = (viewLimit?: number | null, views?: number | null): string | null => {
  if (!viewLimit || viewLimit <= 0) return null;
  const viewed = views ?? 0;
  const remaining = Math.max(viewLimit - viewed, 0);
  if (remaining === 1) return "1 view remaining";
  return `${remaining} views remaining`;
};
