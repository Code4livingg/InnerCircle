"use client";

import { useCallback, useEffect, useState } from "react";
import { anonLabelFromSession } from "./identity";
import { getOrCreateSessionId, onAnonymousModeChange, readAnonymousMode, writeAnonymousMode } from "./storage";

export const useAnonymousMode = () => {
  const [enabled, setEnabled] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    setEnabled(readAnonymousMode());
    setSessionId(getOrCreateSessionId());

    return onAnonymousModeChange(() => {
      setEnabled(readAnonymousMode());
      setSessionId(getOrCreateSessionId());
    });
  }, []);

  const toggle = useCallback((next?: boolean) => {
    const value = typeof next === "boolean" ? next : !enabled;
    setEnabled(value);
    writeAnonymousMode(value);
  }, [enabled]);

  return {
    enabled,
    sessionId,
    anonLabel: anonLabelFromSession(sessionId),
    toggle,
  };
};
