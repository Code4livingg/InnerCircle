"use client";

import { useEffect, useState } from "react";
import { toApiUrl } from "@/lib/apiBase";
import { useWallet } from "@/lib/walletContext";
import { ApiError, fetchCreatorByWallet } from "../../../lib/api";
import {
    claimWalletRoleWithBackend,
    syncWalletRoleFromBackend,
    WalletRoleConflictError,
} from "../../../lib/walletRole";

const readApiError = async (res: Response): Promise<string> => {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
};

export default function CreatorProfilePage() {
    const { address } = useWallet();

    const [hydrating, setHydrating] = useState(true);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        walletAddress: "",
        handle: "",
        displayName: "",
        bio: "",
        subscriptionPrice: "",
    });

    useEffect(() => {
        const hydrateProfile = async () => {
            if (!address) {
                setForm({
                    walletAddress: "",
                    handle: "",
                    displayName: "",
                    bio: "",
                    subscriptionPrice: "",
                });
                setHydrating(false);
                return;
            }

            try {
                const role = await syncWalletRoleFromBackend(address).catch(() => null);
                if (role === "user") {
                    setError("This wallet is locked as fan. Use a separate wallet for creator profile actions.");
                    setHydrating(false);
                    return;
                }

                const data = await fetchCreatorByWallet(address);
                await claimWalletRoleWithBackend(address, "creator");

                const creator = data.creator;
                setForm({
                    walletAddress: address,
                    handle: creator.handle,
                    displayName: creator.displayName ?? "",
                    bio: creator.bio ?? "",
                    subscriptionPrice: creator.subscriptionPriceMicrocredits
                        ? (Number(creator.subscriptionPriceMicrocredits) / 1_000_000).toString()
                        : "",
                });
                localStorage.setItem("innercircle_creator_handle", creator.handle);
            } catch {
                // Creator does not exist for this wallet yet.
            } finally {
                setHydrating(false);
            }
        };

        void hydrateProfile();
    }, [address]);

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const save = async () => {
        if (!form.walletAddress || !form.handle) {
            setError("Wallet address and handle are required.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            await claimWalletRoleWithBackend(form.walletAddress, "creator");

            const res = await fetch(toApiUrl("/api/creators/register"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    walletAddress: form.walletAddress,
                    handle: form.handle,
                    displayName: form.displayName || undefined,
                    bio: form.bio || undefined,
                }),
            });

            if (!res.ok) {
                throw new Error(await readApiError(res));
            }

            if (form.subscriptionPrice) {
                const microcredits = Math.round(parseFloat(form.subscriptionPrice) * 1_000_000);
                const pricingRes = await fetch(toApiUrl("/api/creators/pricing"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ walletAddress: form.walletAddress, subscriptionPriceMicrocredits: microcredits }),
                });
                if (!pricingRes.ok) {
                    throw new Error(await readApiError(pricingRes));
                }
            }

            localStorage.setItem("innercircle_creator_handle", form.handle);
            setSuccess(true);
        } catch (err) {
            if (err instanceof WalletRoleConflictError) {
                setError(`This wallet is locked as ${err.existingRole}. Use a different wallet for ${err.requestedRole}.`);
            } else if (err instanceof ApiError) {
                setError(err.message);
            } else {
                setError((err as Error).message);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 560, padding: "var(--s4) 0" }}>
            <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
                <p className="section__label">Creator Studio</p>
                <h1 style={{ fontSize: "1.75rem" }}>Edit Profile</h1>
            </div>

            {success && (
                <div className="card card--panel" style={{ marginBottom: "var(--s4)", borderColor: "var(--c-success)" }}>
                    <p className="t-sm" style={{ color: "var(--c-success)" }}>Profile saved successfully.</p>
                </div>
            )}
            {error && (
                <div className="card card--panel" style={{ marginBottom: "var(--s4)", borderColor: "var(--c-error)" }}>
                    <p className="t-sm" style={{ color: "var(--c-error)" }}>{error}</p>
                </div>
            )}

            <div className="card card--panel stack stack-4">
                <div className="form-group">
                    <label className="form-label">Wallet Address *</label>
                    <input className="form-input" placeholder="aleo1..." value={form.walletAddress} onChange={(e) => update("walletAddress", e.target.value)} id="profile-wallet" />
                </div>
                <div className="form-group">
                    <label className="form-label">Handle *</label>
                    <input className="form-input" placeholder="your-handle" value={form.handle} onChange={(e) => update("handle", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} id="profile-handle" />
                    <span className="form-hint">Your public URL: innercircle.com/creator/{form.handle || "your-handle"}</span>
                </div>
                <div className="form-group">
                    <label className="form-label">Display Name</label>
                    <input className="form-input" placeholder="Your Name" value={form.displayName} onChange={(e) => update("displayName", e.target.value)} id="profile-displayname" />
                </div>
                <div className="form-group">
                    <label className="form-label">Bio</label>
                    <textarea className="form-textarea" placeholder="Tell subscribers what you create..." value={form.bio} onChange={(e) => update("bio", e.target.value)} id="profile-bio" />
                </div>
                <div className="form-group">
                    <label className="form-label">Monthly Subscription Price (credits)</label>
                    <input className="form-input" type="number" min="0" step="0.01" placeholder="e.g. 5.00 (leave blank for free)" value={form.subscriptionPrice} onChange={(e) => update("subscriptionPrice", e.target.value)} id="profile-price" />
                </div>
                <button className="btn btn--primary" onClick={() => void save()} disabled={loading} id="profile-save">
                    {loading ? "Saving..." : "Save Changes"}
                </button>
                {hydrating && <p className="t-xs t-dim">Loading connected wallet profile...</p>}
            </div>
        </div>
    );
}
