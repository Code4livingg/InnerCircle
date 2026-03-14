import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const normalizeBase = (value: string): string => {
  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};

const getBackendBase = (): string => {
  const configured =
    process.env.API_PROXY_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "";

  if (configured) {
    return normalizeBase(configured);
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:8080";
  }

  return "";
};

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const filterHeaders = (headers: Headers): Headers => {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      out.set(key, value);
    }
  });
  return out;
};

const buildTargetUrl = (request: NextRequest): string | null => {
  const base = getBackendBase();
  if (!base) return null;
  const url = new URL(request.url);
  return `${base}${url.pathname}${url.search}`;
};

const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const targetUrl = buildTargetUrl(request);
  if (!targetUrl) {
    return NextResponse.json(
      { error: "Backend API base not configured. Set API_PROXY_BASE." },
      { status: 502 },
    );
  }

  const init: RequestInit = {
    method: request.method,
    headers: filterHeaders(request.headers),
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(targetUrl, init);
    return new NextResponse(response.body, {
      status: response.status,
      headers: filterHeaders(response.headers),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to reach backend API." },
      { status: 502 },
    );
  }
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
