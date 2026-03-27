"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPrivateLiveComments } from "@/lib/api";
import { getOrCreateKeypair } from "./keys";
import { decryptLiveComment } from "./utils";
import { anonLabelFromSeed } from "@/features/anonymous/identity";

interface PrivateMessagesPanelProps {
  liveStreamId: string | null;
  walletToken: string | null;
}

interface DecryptedMessage {
  id: string;
  senderLabel: string;
  message: string;
  createdAt: string;
}

export function PrivateMessagesPanel({ liveStreamId, walletToken }: PrivateMessagesPanelProps) {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  const keypair = useMemo(() => getOrCreateKeypair(), []);

  useEffect(() => {
    if (!liveStreamId || !walletToken) {
      setMessages([]);
      return undefined;
    }

    let stopped = false;

    const poll = async () => {
      try {
        const data = await fetchPrivateLiveComments(liveStreamId, walletToken, lastSeenRef.current ?? undefined);
        if (stopped) return;
        if (data.comments.length === 0) return;

        const decrypted = data.comments.map((comment) => {
          const message = decryptLiveComment(
            {
              ciphertextB64: comment.ciphertextB64,
              nonceB64: comment.nonceB64,
              senderPublicKeyB64: comment.senderPublicKeyB64,
            },
            keypair.privateKeyB64,
          );
          return {
            id: comment.id,
            senderLabel: comment.senderLabel ?? anonLabelFromSeed(comment.senderPublicKeyB64),
            message,
            createdAt: comment.createdAt,
          };
        });

        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.id));
          const next = [...prev];
          decrypted.forEach((item) => {
            if (!existing.has(item.id)) {
              next.push(item);
            }
          });
          return next;
        });

        lastSeenRef.current = data.comments[data.comments.length - 1]?.createdAt ?? lastSeenRef.current;
        setError(null);
      } catch (err) {
        if (!stopped) {
          setError((err as Error).message || "Failed to load messages.");
        }
      }
    };

    void poll();
    const interval = window.setInterval(poll, 4000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [liveStreamId, walletToken, keypair.privateKeyB64]);

  return (
    <div className="card card--panel stack stack-3">
      <div className="row between" style={{ alignItems: "center" }}>
        <p className="dashboard__panel-title" style={{ marginBottom: 0 }}>Private Live Messages</p>
        <span className="badge badge--secure">End-to-End Encrypted</span>
      </div>
      {error ? <p className="t-sm t-error">{error}</p> : null}
      {messages.length === 0 ? (
        <p className="t-sm t-muted">No private messages yet.</p>
      ) : (
        <div className="stack stack-2">
          {messages.map((item) => (
            <div key={item.id} className="stack stack-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "var(--s2)" }}>
              <span className="t-xs t-dim">{item.senderLabel}</span>
              <span className="t-sm">{item.message}</span>
              <span className="t-xs t-dim">{new Date(item.createdAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
