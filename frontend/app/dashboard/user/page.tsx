"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toApiUrl } from "@/lib/apiBase";
import { useWallet } from "@/lib/walletContext";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import { displayIdentity } from "@/features/anonymous/identity";
import { fetchTipHistory, type TipEntry } from "@/lib/api";
import { getWalletSessionToken } from "@/lib/walletSession";

type FeedCreator = {
  id: string;
  creatorFieldId: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  subscriptionPriceMicrocredits: string;
  isVerified: boolean;
};

type FeedContent = {
  id: string;
  contentFieldId: string;
  title: string;
  description: string | null;
  kind: "VIDEO" | "IMAGE";
  ppvPriceMicrocredits: string;
  creator: {
    handle: string;
    displayName: string | null;
    creatorFieldId: string;
    isVerified: boolean;
  };
};

export default function UserDashboardPage() {
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  const { enabled: anonEnabled, sessionId: anonSessionId } = useAnonymousMode();
  const identityLabel = displayIdentity({ anonymousMode: anonEnabled, sessionId: anonSessionId, fallback: "Wallet Connected" });

  const [feedCreators, setFeedCreators] = useState<FeedCreator[]>([]);
  const [feedContents, setFeedContents] = useState<FeedContent[]>([]);
  const [status, setStatus] = useState<string>("");
  const [tipHistory, setTipHistory] = useState<TipEntry[]>([]);
  const [tipError, setTipError] = useState<string>("");


  useEffect(() => {
    const run = async () => {
      const res = await fetch(toApiUrl("/api/discover/feed"));
      const payload = (await res.json()) as { creators: FeedCreator[]; contents: FeedContent[] };
      setFeedCreators(payload.creators);
      setFeedContents(payload.contents);
    };

    run().catch((e) => setStatus((e as Error).message));
  }, []);

  useEffect(() => {
    const loadTips = async () => {
      if (!connected || !publicKey) {
        setTipHistory([]);
        return;
      }
      try {
        const token = await getWalletSessionToken(wallet);
        const data = await fetchTipHistory(token);
        setTipHistory(data.tips);
        setTipError("");
      } catch (e) {
        setTipError((e as Error).message || "Failed to load tip history.");
      }
    };

    loadTips().catch(() => undefined);
  }, [connected, publicKey]);

  return (
    <main className="stack">
      <section className="hero stack">
        <p>User Dashboard</p>
        <h2>Browse and unlock privately</h2>
        <p>Your subscriptions and purchases are unlocked from verified credits.aleo payments.</p>
      </section>

      <section className="grid">
        <article className="card stack">
          <h3>Creators</h3>
          {feedCreators.slice(0, 8).map((c) => (
            <div key={c.id} className="stack">
              <strong>@{c.handle}</strong>
              <p>{c.displayName ?? ""}</p>
              <Link href={`/creator/${c.handle}`}>Open</Link>
            </div>
          ))}
        </article>

        <article className="card stack">
          <h3>Latest Content</h3>
          {feedContents.slice(0, 8).map((c) => (
            <div key={c.id} className="stack">
              <strong>{c.title}</strong>
              <p>@{c.creator.handle}</p>
              <Link href={`/content/${c.id}`}>Open</Link>
            </div>
          ))}
        </article>

        <article className="card stack">
          <h3>Tip History</h3>
          {tipError ? <p className="t-sm t-error">{tipError}</p> : null}
          {tipHistory.length === 0 ? (
            <p className="t-sm t-muted">No tips sent yet.</p>
          ) : (
            tipHistory.slice(0, 6).map((tip) => (
              <div key={tip.id} className="stack">
                <strong>{(Number(tip.amountMicrocredits) / 1_000_000).toFixed(2)} credits</strong>
                <p>@{tip.creatorHandle}</p>
                {tip.message ? <p className="t-xs t-dim">{tip.message}</p> : null}
              </div>
            ))
          )}
        </article>

        <article className="card stack">
          <h3>Wallet Status</h3>
          <p>
            {connected
              ? `Connected identity: ${identityLabel}`
              : "Connect a wallet to verify creator subscriptions and PPV purchases."}
          </p>
          <p>InnerCircle now uses direct credits.aleo/transfer_public payments instead of custom payment programs.</p>
        </article>
      </section>

      <section className="card stack">
        <h3>Status</h3>
        <p>{status || "(idle)"}</p>
      </section>
    </main>
  );
}
