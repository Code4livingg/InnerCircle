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
  if (typeof window !== "undefined") {
    // Always use the frontend's /api proxy in the browser so env resolution
    // and backend routing stay on the server side.
    return "";
  }

  return getServerApiBase();
};

export const toApiUrl = (path: string): string => `${getApiBase()}${path}`;
