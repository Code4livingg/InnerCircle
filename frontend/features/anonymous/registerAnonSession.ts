"use client";

import { toApiUrl } from "@/lib/apiBase";
import { deriveInvoiceNullifier } from "./deriveNullifier";
import { getOrCreateSessionId, persistAnonymousRegistration, readAnonymousRegistration } from "./storage";

interface RegisterAnonSessionParams {
  nullifier: string;
  circleId: string;
  tier: number;
  expiresAtBlock: number;
}

export async function registerAnonSession(params: RegisterAnonSessionParams): Promise<void> {
  const sessionId = getOrCreateSessionId();
  if (!sessionId) {
    throw new Error("Anonymous session storage is unavailable in this environment.");
  }

  const response = await fetch(toApiUrl("/api/anon/register"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Session": sessionId,
    },
    body: JSON.stringify({
      sessionId,
      nullifier: params.nullifier,
      circleId: params.circleId,
      tier: params.tier,
      expiresAtBlock: params.expiresAtBlock,
    }),
  });

  if (response.ok) {
    return;
  }

  let message = "Failed to register anonymous session.";
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error;
    }
  } catch {
    const text = await response.text().catch(() => "");
    if (text.trim()) {
      message = text.trim();
    }
  }

  throw new Error(message);
}

interface RegisterDerivedAnonSessionParams {
  circleId: string;
  tier: number;
  expiresAtBlock: number;
  subscriberSeed: string;
}

const isAlreadyRegisteredError = (error: unknown): boolean =>
  /nullifier already used/i.test((error as Error)?.message ?? "");

export async function registerSubscriptionAnonSession(
  params: RegisterDerivedAnonSessionParams,
): Promise<{ nullifier: string; reused: boolean }> {
  const sessionId = getOrCreateSessionId();
  if (!sessionId) {
    throw new Error("Anonymous session storage is unavailable in this environment.");
  }

  const normalizedCircleId = params.circleId.trim().replace(/field$/i, "");
  const nullifier = await deriveInvoiceNullifier({
    circleId: normalizedCircleId,
    tier: params.tier,
    expiresAtBlock: params.expiresAtBlock,
    subscriberSeed: params.subscriberSeed,
  });

  const existing = readAnonymousRegistration(normalizedCircleId);
  if (
    existing &&
    existing.sessionId === sessionId &&
    existing.nullifier === nullifier &&
    existing.expiresAtBlock === params.expiresAtBlock &&
    existing.tier === params.tier
  ) {
    return { nullifier, reused: true };
  }

  try {
    await registerAnonSession({
      nullifier,
      circleId: normalizedCircleId,
      tier: params.tier,
      expiresAtBlock: params.expiresAtBlock,
    });
  } catch (error) {
    if (!isAlreadyRegisteredError(error)) {
      throw error;
    }
  }

  persistAnonymousRegistration({
    circleId: normalizedCircleId,
    sessionId,
    nullifier,
    tier: params.tier,
    expiresAtBlock: params.expiresAtBlock,
    registeredAt: Date.now(),
  });

  return { nullifier, reused: false };
}
