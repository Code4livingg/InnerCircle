"use client";

import { useState } from "react";
import { sendPrivateLiveComment } from "@/lib/api";
import { useAnonymousMode } from "@/features/anonymous/useAnonymousMode";
import { getOrCreateKeypair } from "./keys";
import { encryptLiveComment } from "./utils";

interface PrivateCommentComposerProps {
  liveStreamId: string;
  creatorPublicKeyB64: string | null;
}

export function PrivateCommentComposer({ liveStreamId, creatorPublicKeyB64 }: PrivateCommentComposerProps) {
  const { anonLabel, enabled, sessionId } = useAnonymousMode();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const disabled = !creatorPublicKeyB64 || sending;

  const onSend = async () => {
    if (!creatorPublicKeyB64) return;
    if (!message.trim()) {
      setStatus("Enter a message first.");
      return;
    }

    setSending(true);
    setStatus(null);

    try {
      const keypair = getOrCreateKeypair(sessionId);
      const encrypted = encryptLiveComment(message.trim(), creatorPublicKeyB64, keypair);
      await sendPrivateLiveComment(liveStreamId, {
        ciphertextB64: encrypted.ciphertextB64,
        nonceB64: encrypted.nonceB64,
        senderPublicKeyB64: encrypted.senderPublicKeyB64,
        senderLabel: anonLabel,
      });
      setMessage("");
      setStatus("Sent privately.");
    } catch (error) {
      setStatus((error as Error).message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card card--panel stack stack-2">
      <div className="row between" style={{ alignItems: "center" }}>
        <p className="dashboard__panel-title" style={{ marginBottom: 0 }}>Send private message to creator</p>
        <div className="row row-2" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="badge badge--secure">End-to-End Encrypted</span>
          <span className="badge badge--neutral">{anonLabel}</span>
          {enabled ? <span className="badge badge--neutral">Anonymous Mode ON</span> : null}
        </div>
      </div>
      <textarea
        className="form-textarea"
        placeholder={creatorPublicKeyB64 ? "Type your private note" : "Creator encryption key not available"}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={!creatorPublicKeyB64}
      />
      <div className="row row-2" style={{ alignItems: "center" }}>
        <button type="button" className="btn btn--primary" onClick={onSend} disabled={disabled}>
          {sending ? "Encrypting..." : "Send"}
        </button>
        {status ? <span className={status.includes("Failed") ? "t-sm t-error" : "t-sm t-success"}>{status}</span> : null}
      </div>
    </div>
  );
}
