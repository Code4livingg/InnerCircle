"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/lib/walletContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

const postJson = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Request failed");
  }

  return (await res.json()) as T;
};

export default function CreatorDashboardPage() {
  const { publicKey, connected } = useWallet();

  const [handle, setHandle] = useState("onlyaleo_creator");
  const [displayName, setDisplayName] = useState("OnlyAleo Creator");
  const [bio, setBio] = useState("Privacy-first creator on Aleo.");
  const [subscriptionPriceMicrocredits, setSubscriptionPriceMicrocredits] = useState("0");

  const [uploadTitle, setUploadTitle] = useState("Demo Content");
  const [uploadDescription, setUploadDescription] = useState("Encrypted upload demo.");
  const [uploadKind, setUploadKind] = useState<"VIDEO" | "IMAGE">("VIDEO");
  const [uploadPrice, setUploadPrice] = useState("0");
  const [uploadPublished, setUploadPublished] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [status, setStatus] = useState<string>("");
  const walletAddress = useMemo(() => (connected ? publicKey : null), [connected, publicKey]);

  const requireWallet = () => {
    if (!walletAddress) throw new Error("Connect wallet first");
    return walletAddress;
  };

  const onSaveProfile = async () => {
    try {
      setStatus("Saving profile...");
      const walletAddress = requireWallet();

      const out = await postJson<{ creator: unknown }>("/api/creators/register", {
        walletAddress,
        handle,
        displayName,
        bio,
      });

      setStatus(`Profile saved.`);
      void out;
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const onSavePricing = async () => {
    try {
      setStatus("Saving pricing...");
      const walletAddress = requireWallet();

      await postJson<{ creator: unknown }>("/api/creators/pricing", {
        walletAddress,
        subscriptionPriceMicrocredits,
      });

      setStatus("Pricing saved.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const onUpload = async () => {
    try {
      setStatus("Uploading and encrypting content...");
      const walletAddress = requireWallet();

      if (!uploadFile) throw new Error("Select a file to upload");

      const form = new FormData();
      form.set("file", uploadFile);
      form.set("walletAddress", walletAddress);
      form.set("title", uploadTitle);
      form.set("description", uploadDescription);
      form.set("kind", uploadKind);
      form.set("ppvPriceMicrocredits", uploadPrice);
      form.set("isPublished", String(uploadPublished));

      const res = await fetch(`${API_BASE}/api/content/upload`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "Upload failed");
      }

      const payload = (await res.json()) as { content?: { id?: string } };
      setStatus(`Upload complete. contentId=${payload.content?.id ?? "(unknown)"}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <main className="stack">
      <section className="hero stack">
        <p>Creator Dashboard</p>
        <h2>Upload encrypted content and set pricing</h2>
        <p>No usernames or emails. Your wallet is your identity.</p>
      </section>

      <section className="grid">
        <article className="card stack">
          <h3>Profile</h3>
          <label>
            Handle
            <input value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Bio
            <input value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <button onClick={onSaveProfile}>Save profile</button>
        </article>

        <article className="card stack">
          <h3>Subscription Pricing</h3>
          <p>Amount is stored server-side; on-chain ownership stays private.</p>
          <label>
            Price (microcredits)
            <input value={subscriptionPriceMicrocredits} onChange={(e) => setSubscriptionPriceMicrocredits(e.target.value)} />
          </label>
          <button onClick={onSavePricing}>Save pricing</button>
        </article>

        <article className="card stack">
          <h3>Upload Content</h3>
          <label>
            Title
            <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
          </label>
          <label>
            Description
            <input value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} />
          </label>
          <label>
            Kind
            <input value={uploadKind} onChange={(e) => setUploadKind(e.target.value === "IMAGE" ? "IMAGE" : "VIDEO")} placeholder="VIDEO or IMAGE" />
          </label>
          <label>
            PPV price (microcredits)
            <input value={uploadPrice} onChange={(e) => setUploadPrice(e.target.value)} />
          </label>
          <label>
            Publish now?
            <input value={uploadPublished ? "true" : "false"} onChange={(e) => setUploadPublished(e.target.value === "true")} placeholder="true or false" />
          </label>
          <label>
            File
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
          </label>
          <button onClick={onUpload}>Upload (encrypt + chunk)</button>
        </article>
      </section>

      <section className="card stack">
        <h3>Status</h3>
        <p>{status || "(idle)"}</p>
      </section>
    </main>
  );
}
