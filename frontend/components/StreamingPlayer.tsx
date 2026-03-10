"use client";

interface StreamingPlayerProps {
  src: string | null;
  mimeType?: string | null;
  title?: string;
}

export function StreamingPlayer({ src, mimeType, title }: StreamingPlayerProps) {
  if (!src) {
    return <p>Unlock required before playback.</p>;
  }

  const normalizedMimeType = String(mimeType ?? "").toLowerCase();

  if (normalizedMimeType.startsWith("image/")) {
    return (
      <img
        src={src}
        alt={title ?? "Protected content"}
        style={{ display: "block", width: "100%", height: "auto", borderRadius: 16 }}
      />
    );
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return <audio controls preload="metadata" src={src} style={{ width: "100%" }} />;
  }

  return <video controls preload="metadata" src={src} style={{ width: "100%", height: "auto" }} />;
}
