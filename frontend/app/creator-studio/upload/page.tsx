"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@/lib/walletContext";
import { fetchCreatorByWallet } from "../../../lib/api";
import { claimWalletRoleWithBackend, WalletRoleConflictError } from "../../../lib/walletRole";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

export default function UploadPage() {
    const { address } = useWallet();

    const [file, setFile] = useState<File | null>(null);
    const [thumb, setThumb] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const thumbRef = useRef<HTMLInputElement>(null);

    const [form, setForm] = useState({
        walletAddress: "",
        title: "",
        description: "",
        kind: "VIDEO",
        accessType: "subscription",
        ppvPrice: "",
    });

    // Auto-fill wallet address when wallet connects
    useEffect(() => {
        if (address) {
            setForm((prev) => ({ ...prev, walletAddress: address }));
        } else {
            setForm((prev) => ({ ...prev, walletAddress: "" }));
        }
    }, [address]);

    useEffect(() => {
        const hydrateCreatorHandle = async () => {
            if (!address) return;
            try {
                await claimWalletRoleWithBackend(address, "creator");
                const data = await fetchCreatorByWallet(address);
                localStorage.setItem("onlyaleo_creator_handle", data.creator.handle);
            } catch (err) {
                if (err instanceof WalletRoleConflictError) {
                    setError(`This wallet is locked as ${err.existingRole}. Use a different wallet for ${err.requestedRole}.`);
                    return;
                }
                // Creator not registered yet for this wallet or backend unavailable.
            }
        };

        void hydrateCreatorHandle();
    }, [address]);

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped) setFile(dropped);
    };

    const handleSubmit = async () => {
        if (!file) { setError("Please select a file to upload."); return; }
        if (!form.walletAddress) { setError("Wallet address is required. Connect your wallet first."); return; }
        if (!form.title) { setError("Please enter a title for your content."); return; }

        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            await claimWalletRoleWithBackend(form.walletAddress, "creator");

            if (address) {
                await fetchCreatorByWallet(address);
            }

            const body = new FormData();
            body.append("file", file);
            if (thumb) body.append("thumbnail", thumb);
            body.append("walletAddress", form.walletAddress);
            body.append("title", form.title);
            if (form.description) body.append("description", form.description);
            body.append("kind", form.kind);
            if (form.accessType === "ppv" && form.ppvPrice) {
                body.append("ppvPriceMicrocredits", String(Math.round(parseFloat(form.ppvPrice) * 1_000_000)));
            }

            const res = await fetch(`${API}/api/content/upload`, { method: "POST", body });

            const contentType = res.headers.get("content-type") ?? "";
            let payload: { error?: string } = {};
            if (contentType.includes("application/json")) {
                payload = (await res.json()) as { error?: string };
            } else {
                const text = await res.text();
                payload = { error: text.slice(0, 200) };
            }

            if (!res.ok) {
                throw new Error(payload.error ?? `Upload failed (${res.status})`);
            }

            setSuccess(true);
            setFile(null);
            setThumb(null);
            setForm((prev) => ({ ...prev, title: "", description: "", ppvPrice: "" }));
        } catch (e) {
            if (e instanceof WalletRoleConflictError) {
                setError(`This wallet is locked as ${e.existingRole}. Use a different wallet for ${e.requestedRole}.`);
                return;
            }
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 640, padding: "var(--s4) 0" }}>
            <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
                <p className="section__label">Creator Studio</p>
                <h1 style={{ fontSize: "1.75rem" }}>Upload Content</h1>
            </div>

            {success && (
                <div className="card card--panel" style={{ marginBottom: "var(--s4)", borderColor: "var(--c-success)" }}>
                    <p className="t-sm" style={{ color: "var(--c-success)" }}>
                        ✓ Content uploaded securely to private media storage.
                    </p>
                </div>
            )}

            {error && (
                <div className="card card--panel" style={{ marginBottom: "var(--s4)", borderColor: "var(--c-error)" }}>
                    <div className="row row-2">
                        <span style={{ color: "var(--c-error)", flexShrink: 0 }}>✕</span>
                        <p className="t-sm" style={{ color: "var(--c-error)" }}>{error}</p>
                    </div>
                    <button
                        onClick={() => setError(null)}
                        style={{ marginTop: "var(--s2)", background: "none", border: "none", color: "var(--c-text-3)", cursor: "pointer", fontSize: "0.75rem", padding: 0 }}
                    >
                        Dismiss
                    </button>
                </div>
            )}

            <div className="stack stack-4">
                {/* Drop zone */}
                <div
                    className={`upload-zone${dragging ? " upload-zone--active" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                >
                    <div className="upload-zone__icon">⊕</div>
                    <p className="upload-zone__label">
                        {file ? file.name : "Drop your file here or click to browse"}
                    </p>
                    <p className="upload-zone__sub">
                        {file
                            ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.type || "unknown type"}`
                            : "MP4, MOV, AVI, MP3, JPG, PNG — max 1 GB"}
                    </p>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="video/*,audio/*,image/*"
                        style={{ display: "none" }}
                        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                    />
                </div>

                <div className="card card--panel stack stack-4">
                    {/* Wallet address — auto-filled */}
                    <div className="form-group">
                        <label className="form-label">Your Wallet Address *</label>
                        <input
                            className="form-input"
                            placeholder={address ? address : "Connect your wallet above, or paste aleo1…"}
                            value={form.walletAddress}
                            onChange={(e) => update("walletAddress", e.target.value)}
                            id="upload-wallet"
                        />
                        {address && form.walletAddress === address && (
                            <span className="form-hint" style={{ color: "var(--c-success)" }}>
                                ✓ Auto-filled from connected wallet
                            </span>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label">Title *</label>
                        <input
                            className="form-input"
                            placeholder="Content title"
                            value={form.title}
                            onChange={(e) => update("title", e.target.value)}
                            id="upload-title"
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea
                            className="form-textarea"
                            placeholder="What is this content about?"
                            value={form.description}
                            onChange={(e) => update("description", e.target.value)}
                            id="upload-desc"
                        />
                    </div>

                    <div className="grid-2" style={{ gap: "var(--s3)" }}>
                        <div className="form-group">
                            <label className="form-label">Content Type</label>
                            <select className="form-select" value={form.kind} onChange={(e) => update("kind", e.target.value)} id="upload-kind">
                                <option value="VIDEO">Video</option>
                                <option value="IMAGE">Image</option>
                                <option value="AUDIO">Audio</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Access</label>
                            <select className="form-select" value={form.accessType} onChange={(e) => update("accessType", e.target.value)} id="upload-access">
                                <option value="subscription">Subscription only</option>
                                <option value="ppv">Pay-per-view</option>
                            </select>
                        </div>
                    </div>

                    {form.accessType === "ppv" && (
                        <div className="form-group">
                            <label className="form-label">PPV Price (credits)</label>
                            <input
                                className="form-input"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="e.g. 2.00"
                                value={form.ppvPrice}
                                onChange={(e) => update("ppvPrice", e.target.value)}
                                id="upload-ppv-price"
                            />
                            <span className="form-hint">1 credit = 1,000,000 microcredits</span>
                        </div>
                    )}

                    {/* Thumbnail */}
                    <div className="form-group">
                        <label className="form-label">Thumbnail (optional)</label>
                        <div
                            className="upload-zone"
                            style={{ padding: "var(--s3)", cursor: "pointer" }}
                            onClick={() => thumbRef.current?.click()}
                        >
                            <p className="upload-zone__label" style={{ fontSize: "0.875rem" }}>
                                {thumb ? thumb.name : "Upload thumbnail image"}
                            </p>
                            <input
                                ref={thumbRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={(e) => setThumb(e.target.files?.[0] ?? null)}
                            />
                        </div>
                    </div>

                    <button
                        className="btn btn--primary"
                        onClick={handleSubmit}
                        disabled={loading || !file}
                        id="upload-submit"
                    >
                        {loading ? "Uploading to secure media storage…" : "Publish Content"}
                    </button>

                    {!address && (
                        <p className="t-xs t-dim">
                            Tip: Connect your wallet via the top bar to auto-fill your wallet address.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
