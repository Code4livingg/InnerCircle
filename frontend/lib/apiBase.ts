const DEFAULT_LOCAL_API_BASE = "http://localhost:8080";

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const getServerApiBase = (): string => {
  const configured =
    process.env.API_PROXY_BASE?.trim() ??
    process.env.NEXT_PUBLIC_API_BASE?.trim();

  if (configured) {
    return trimTrailingSlash(configured);
  }

  return DEFAULT_LOCAL_API_BASE;
};

export const getApiBase = (): string => {
  // Always use same-origin /api in the browser to avoid mixed-content issues.
  if (typeof window !== "undefined") {
    return "";
  }

  return getServerApiBase();
};

export const toApiUrl = (path: string): string => `${getApiBase()}${path}`;
