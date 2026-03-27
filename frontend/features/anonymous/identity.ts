import { getOrCreateSessionId } from "./storage";

const shortFromSeed = (seed: string): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const normalized = Math.abs(hash).toString(36).toUpperCase();
  return normalized.padStart(6, "0").slice(0, 6);
};

export const anonLabelFromSession = (sessionId?: string): string => {
  const id = sessionId ?? getOrCreateSessionId();
  if (!id) return "Anon";
  return `Anon_${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
};

export const anonLabelFromSeed = (seed: string): string => {
  if (!seed) return "Anon";
  return `Anon_${shortFromSeed(seed)}`;
};

export const displayIdentity = (options: { anonymousMode: boolean; sessionId?: string; fallback?: string }): string => {
  if (options.anonymousMode) {
    return anonLabelFromSession(options.sessionId);
  }

  return options.fallback ?? "Private Member";
};
