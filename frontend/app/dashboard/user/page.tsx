"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toApiUrl } from "@/lib/apiBase";
import { useWallet } from "@/lib/walletContext";

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
  const { connected, publicKey } = useWallet();

  const [feedCreators, setFeedCreators] = useState<FeedCreator[]>([]);
  const [feedContents, setFeedContents] = useState<FeedContent[]>([]);
  const [status, setStatus] = useState<string>("");

  const walletAddress = useMemo(() => (connected ? publicKey : null), [connected, publicKey]);

  useEffect(() => {
    const run = async () => {
      const res = await fetch(toApiUrl("/api/discover/feed"));
      const payload = (await res.json()) as { creators: FeedCreator[]; contents: FeedContent[] };
      setFeedCreators(payload.creators);
      setFeedContents(payload.contents);
    };

    run().catch((e) => setStatus((e as Error).message));
  }, []);

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
          <h3>Wallet Status</h3>
          <p>
            {walletAddress
              ? `Connected wallet: ${walletAddress}`
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
