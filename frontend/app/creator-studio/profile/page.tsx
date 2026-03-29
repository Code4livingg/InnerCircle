"use client";

import { useEffect, useState } from "react";
import { toApiUrl } from "@/lib/apiBase";
import { useWallet } from "@/lib/walletContext";
import {
    ApiError,
    fetchCreatorByWallet,
    fetchCreatorVerificationStatus,
    setCreatorPaymentPreferences,
    submitCreatorVerification,
    type CreatorPaymentAsset,
    type CreatorPaymentVisibility,
} from "../../../lib/api";
import {
    claimWalletRoleWithBackend,
    syncWalletRoleFromBackend,
    WalletRoleConflictError,
} from "../../../lib/walletRole";
import {
    readStoredCreatorPaymentPreferences,
    storeCreatorPaymentPreferences,
} from "../../../lib/creatorPaymentPreferences";
import { getWalletSessionToken } from "../../../lib/walletSession";

const readApiError = async (res: Response): Promise<string> => {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
};

export default function CreatorProfilePage() {
    const wallet = useWallet();
    const { address } = wallet;

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
        acceptedPaymentAssets: ["ALEO_CREDITS"] as CreatorPaymentAsset[],
        acceptedPaymentVisibilities: ["PUBLIC", "PRIVATE"] as CreatorPaymentVisibility[],
    });

    const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
    const [verificationNotes, setVerificationNotes] = useState("");
    const [verificationSubmitting, setVerificationSubmitting] = useState(false);
    const [verificationError, setVerificationError] = useState<string | null>(null);

    useEffect(() => {
        const hydrateProfile = async () => {
            if (!address) {
                setForm({
                    walletAddress: "",
                    handle: "",
                    displayName: "",
                    bio: "",
                    subscriptionPrice: "",
                    acceptedPaymentAssets: ["ALEO_CREDITS"] as CreatorPaymentAsset[],
                    acceptedPaymentVisibilities: ["PUBLIC", "PRIVATE"] as CreatorPaymentVisibility[],
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
                const storedPaymentPreferences = readStoredCreatorPaymentPreferences(creator.handle);
                setForm({
                    walletAddress: address,
                    handle: creator.handle,
                    displayName: creator.displayName ?? "",
                    bio: creator.bio ?? "",
                    subscriptionPrice: creator.subscriptionPriceMicrocredits
                        ? (Number(creator.subscriptionPriceMicrocredits) / 1_000_000).toString()
                        : "",
                    acceptedPaymentAssets:
                        storedPaymentPreferences?.acceptedPaymentAssets
                            ? storedPaymentPreferences.acceptedPaymentAssets
                            : creator.acceptedPaymentAssets && creator.acceptedPaymentAssets.length > 0
                            ? (creator.acceptedPaymentAssets as CreatorPaymentAsset[])
                            : ["ALEO_CREDITS"],
                    acceptedPaymentVisibilities:
                        storedPaymentPreferences?.acceptedPaymentVisibilities
                            ? storedPaymentPreferences.acceptedPaymentVisibilities
                            : creator.acceptedPaymentVisibilities && creator.acceptedPaymentVisibilities.length > 0
                            ? (creator.acceptedPaymentVisibilities as CreatorPaymentVisibility[])
                            : ["PUBLIC", "PRIVATE"],
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

    useEffect(() => {
        const loadVerification = async () => {
            if (!form.handle) return;
            try {
                const status = await fetchCreatorVerificationStatus(form.handle);
                setVerificationStatus(status.status);
            } catch {
                setVerificationStatus(null);
            }
        };

        void loadVerification();
    }, [form.handle]);

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    const toggleAsset = (asset: CreatorPaymentAsset) =>
        setForm((prev) => {
            const next = prev.acceptedPaymentAssets.includes(asset)
                ? prev.acceptedPaymentAssets.filter((value) => value !== asset)
                : [...prev.acceptedPaymentAssets, asset];
            return {
                ...prev,
                acceptedPaymentAssets: next.length > 0 ? next : ["ALEO_CREDITS"],
            };
        });

    const toggleVisibility = (visibility: CreatorPaymentVisibility) =>
        setForm((prev) => {
            const next = prev.acceptedPaymentVisibilities.includes(visibility)
                ? prev.acceptedPaymentVisibilities.filter((value) => value !== visibility)
                : [...prev.acceptedPaymentVisibilities, visibility];
            return {
                ...prev,
                acceptedPaymentVisibilities: next.length > 0 ? next : ["PUBLIC"],
            };
        });

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
                    acceptedPaymentAssets: form.acceptedPaymentAssets,
                    acceptedPaymentVisibilities: form.acceptedPaymentVisibilities,
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

            try {
                await setCreatorPaymentPreferences({
                    walletAddress: form.walletAddress,
                    acceptedPaymentAssets: form.acceptedPaymentAssets,
                    acceptedPaymentVisibilities: form.acceptedPaymentVisibilities,
                });
            } catch (err) {
                if (!(err instanceof ApiError && err.status === 404)) {
                    throw err;
                }
            }

            localStorage.setItem("innercircle_creator_handle", form.handle);
            storeCreatorPaymentPreferences(
                form.handle,
                form.acceptedPaymentAssets,
                form.acceptedPaymentVisibilities,
            );
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

    const submitVerification = async () => {
        if (!address) {
            setVerificationError("Connect your wallet before submitting verification.");
            return;
        }

        setVerificationSubmitting(true);
        setVerificationError(null);

        try {
            const token = await getWalletSessionToken(wallet);
            await submitCreatorVerification(
                { notes: verificationNotes || undefined },
                token,
            );
            setVerificationStatus("PENDING");
            setVerificationNotes("");
        } catch (err) {
            setVerificationError((err as Error).message || "Failed to submit verification.");
        } finally {
            setVerificationSubmitting(false);
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
                    <input className="form-input" type="password" placeholder="Connected wallet (hidden)" value={form.walletAddress} onChange={(e) => update("walletAddress", e.target.value)} id="profile-wallet" />
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
                    <span className="form-hint">This sets the default subscription price. Manage tier pricing in the Tiers tab.</span>
                </div>
                <div className="form-group">
                    <label className="form-label">Accepted payment assets</label>
                    <div className="stack stack-1">
                        <label className="row row-2" style={{ alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={form.acceptedPaymentAssets.includes("ALEO_CREDITS")}
                                onChange={() => toggleAsset("ALEO_CREDITS")}
                            />
                            <span className="t-sm">Aleo credits</span>
                        </label>
                        <label className="row row-2" style={{ alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={form.acceptedPaymentAssets.includes("USDCX")}
                                onChange={() => toggleAsset("USDCX")}
                            />
                            <span className="t-sm">USDCx (USDC stablecoin on Aleo)</span>
                        </label>
                    </div>
                    <span className="form-hint">
                        Enable USDCx to let subscribers pay with privacy-preserving stablecoins. Both Aleo credits and
                        USDCx use the same contract for settlement.
                    </span>
                </div>
                <div className="form-group">
                    <label className="form-label">Accepted payment visibility</label>
                    <div className="stack stack-1">
                        <label className="row row-2" style={{ alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={form.acceptedPaymentVisibilities.includes("PUBLIC")}
                                onChange={() => toggleVisibility("PUBLIC")}
                            />
                            <span className="t-sm">Public balance</span>
                        </label>
                        <label className="row row-2" style={{ alignItems: "center" }}>
                            <input
                                type="checkbox"
                                checked={form.acceptedPaymentVisibilities.includes("PRIVATE")}
                                onChange={() => toggleVisibility("PRIVATE")}
                            />
                            <span className="t-sm">Private record</span>
                        </label>
                    </div>
                    <span className="form-hint">Private payment still depends on the wallet exposing spendable records and keeping enough public balance for fees.</span>
                </div>
                <button className="btn btn--primary" onClick={() => void save()} disabled={loading} id="profile-save">
                    {loading ? "Saving..." : "Save Changes"}
                </button>
                {hydrating && <p className="t-xs t-dim">Loading connected wallet profile...</p>}
            </div>

            <div className="card card--panel stack stack-3" style={{ marginTop: "var(--s4)" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="stack stack-1">
                        <h3 style={{ margin: 0 }}>Creator Verification</h3>
                        <p className="t-xs t-dim">Request a verified badge for your InnerCircle profile.</p>
                    </div>
                    {verificationStatus ? (
                        <span className={`badge ${verificationStatus === "APPROVED" ? "badge--secure" : "badge--locked"}`}>
                            {verificationStatus.toLowerCase()}
                        </span>
                    ) : null}
                </div>

                <div className="form-group">
                    <label className="form-label">Verification notes or links</label>
                    <textarea
                        className="form-textarea"
                        placeholder="Add any links or context to support your verification."
                        value={verificationNotes}
                        onChange={(e) => setVerificationNotes(e.target.value)}
                    />
                </div>

                {verificationError && <p className="t-sm t-error">{verificationError}</p>}

                <button className="btn btn--secondary" onClick={submitVerification} disabled={verificationSubmitting}>
                    {verificationSubmitting ? "Submitting..." : "Submit verification request"}
                </button>
            </div>
        </div>
    );
}
