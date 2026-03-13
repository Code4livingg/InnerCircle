const DEFAULT_LOCAL_API_BASE = "http://localhost:8080";

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

export const getApiBase = (): string => {
  const configured = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_API_BASE;
  }

  return "";
};

export const toApiUrl = (path: string): string => `${getApiBase()}${path}`;
