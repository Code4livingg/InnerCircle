const DEFAULT_LOCAL_API_BASE = "http://localhost:8080";

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const normalizeApiBase = (value: string): string => {
  const trimmed = trimTrailingSlash(value);
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};

const getServerApiBase = (): string => {
  const configured =
    process.env.API_PROXY_BASE?.trim() ??
    process.env.NEXT_PUBLIC_API_BASE?.trim();

  if (configured) {
    return normalizeApiBase(configured);
  }

  return DEFAULT_LOCAL_API_BASE;
};

export const getApiBase = (): string => {
  const publicBase = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (publicBase) {
    return normalizeApiBase(publicBase);
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return normalizeApiBase(DEFAULT_LOCAL_API_BASE);
    }
    // Use same-origin /api in the browser by default.
    return "";
  }

  return getServerApiBase();
};

export const toApiUrl = (path: string): string => `${getApiBase()}${path}`;
