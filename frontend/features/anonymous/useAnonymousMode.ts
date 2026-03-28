"use client";

import { useCallback, useEffect, useState } from "react";
import { anonLabelFromSession } from "./identity";
import {
  getOrCreateSessionId,
  onAnonymousModeChange,
  readAnonymousMode,
  readAnonymousRegistrationStatus,
  writeAnonymousMode,
} from "./storage";

export const useAnonymousMode = () => {
  const [enabled, setEnabled] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [registrationStatus, setRegistrationStatus] = useState(() => readAnonymousRegistrationStatus());

  useEffect(() => {
    const syncState = () => {
      setEnabled(readAnonymousMode());
      setSessionId(getOrCreateSessionId());
      setRegistrationStatus(readAnonymousRegistrationStatus());
    };

    syncState();
    return onAnonymousModeChange(syncState);
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
    registrationStatus: registrationStatus.state,
    registrationMessage: registrationStatus.message,
    activeRegistrationCount: registrationStatus.activeCircleIds.length,
    toggle,
  };
};
