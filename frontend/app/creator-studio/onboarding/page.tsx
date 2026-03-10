"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/walletContext";
import { ApiError, fetchCreatorByWallet } from "../../../lib/api";
import {
    claimWalletRoleWithBackend,
    syncWalletRoleFromBackend,
    WalletRoleConflictError,
} from "../../../lib/walletRole";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
const STEPS = ["Profile", "Pricing", "Done"];

const readApiError = async (res: Response): Promise<string> => {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
};

export default function OnboardingPage() {
    const router = useRouter();
    const { address } = useWallet();

    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        walletAddress: "",
        handle: "",
        displayName: "",
        bio: "",
        subscriptionPrice: "",
    });

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }));

    useEffect(() => {
        if (!address) {
            return;
        }

        setForm((prev) => ({ ...prev, walletAddress: address }));

        const hydrateWalletRoleAndCreator = async () => {
            try {
                const existingRole = await syncWalletRoleFromBackend(address);
                if (existingRole === "user") {
                    setError("This wallet is locked as fan. Use a different wallet for creator onboarding.");
                    return;
                }
            } catch {
                // Continue with local fallback.
            }

            try {
                const data = await fetchCreatorByWallet(address);
                await claimWalletRoleWithBackend(address, "creator");
                localStorage.setItem("onlyaleo_creator_handle", data.creator.handle);
                router.replace("/creator-studio/dashboard");
            } catch {
                // No creator profile yet for this wallet.
            }
        };

        void hydrateWalletRoleAndCreator();
    }, [address, router]);

    const submitProfile = async () => {
        if (!form.handle || !form.walletAddress) {
            setError("Wallet address and handle are required.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await claimWalletRoleWithBackend(form.walletAddress, "creator");

            const res = await fetch(`${API}/api/creators/register`, {
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

            setStep(1);
        } catch (err) {
            if (err instanceof WalletRoleConflictError) {
                setError(`This wallet is locked as ${err.existingRole}. Use a different wallet for ${err.requestedRole}.`);
                return;
            }
            if (err instanceof ApiError) {
                setError(err.message);
                return;
            }
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const submitPricing = async () => {
        if (!form.subscriptionPrice) {
            setStep(2);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const microcredits = Math.round(parseFloat(form.subscriptionPrice) * 1_000_000);
            const res = await fetch(`${API}/api/creators/pricing`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    walletAddress: form.walletAddress,
                    subscriptionPriceMicrocredits: microcredits,
                }),
            });

            if (!res.ok) {
                throw new Error(await readApiError(res));
            }

            setStep(2);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "var(--s6) 0" }}>
            <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
                <p className="section__label">Creator Studio</p>
                <h1 style={{ fontSize: "1.75rem" }}>Set up your channel</h1>
            </div>

            <div className="step-indicator">
                {STEPS.map((label, i) => (
                    <div key={label} className="step-indicator__item">
                        <div className={`step-indicator__dot${i === step ? " step-indicator__dot--active" : i < step ? " step-indicator__dot--done" : ""}`}>
                            {i < step ? "OK" : i + 1}
                        </div>
                        <span className={`step-indicator__label${i === step ? " step-indicator__label--active" : ""}`}>{label}</span>
                        {i < STEPS.length - 1 && <div className="step-indicator__line" />}
                    </div>
                ))}
            </div>

            {error && (
                <div className="card card--panel" style={{ marginBottom: "var(--s4)", borderColor: "var(--c-error)" }}>
                    <p className="t-sm" style={{ color: "var(--c-error)" }}>{error}</p>
                </div>
            )}

            {step === 0 && (
                <div className="card card--panel stack stack-4">
                    <div className="form-group">
                        <label className="form-label">Wallet Address *</label>
                        <input className="form-input" placeholder="aleo1..." value={form.walletAddress} onChange={(e) => update("walletAddress", e.target.value)} id="onboard-wallet" />
                        <span className="form-hint">Your Aleo wallet address. Used to identify your creator account.</span>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Handle *</label>
                        <input className="form-input" placeholder="e.g. nova-writes" value={form.handle} onChange={(e) => update("handle", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} id="onboard-handle" />
                        <span className="form-hint">Lowercase letters, numbers, underscores, and hyphens only.</span>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Display Name</label>
                        <input className="form-input" placeholder="Nova Writes" value={form.displayName} onChange={(e) => update("displayName", e.target.value)} id="onboard-displayname" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Bio</label>
                        <textarea className="form-textarea" placeholder="Tell subscribers what you create..." value={form.bio} onChange={(e) => update("bio", e.target.value)} id="onboard-bio" />
                        <span className="form-hint">{form.bio.length}/500 characters</span>
                    </div>
                    <button className="btn btn--primary" onClick={() => void submitProfile()} disabled={loading} id="onboard-next-1">
                        {loading ? "Saving..." : "Continue ->"}
                    </button>
                </div>
            )}

            {step === 1 && (
                <div className="card card--panel stack stack-4">
                    <div className="stack stack-1">
                        <h3 style={{ fontSize: "1.125rem" }}>Set your subscription price</h3>
                        <p className="t-sm t-muted">Subscribers pay this amount in credits per month. Leave blank for free.</p>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Monthly Price (credits)</label>
                        <input className="form-input" type="number" min="0" step="0.01" placeholder="e.g. 5.00" value={form.subscriptionPrice} onChange={(e) => update("subscriptionPrice", e.target.value)} id="onboard-price" />
                        <span className="form-hint">1 credit = 1,000,000 microcredits on Aleo.</span>
                    </div>
                    <div className="row" style={{ gap: "var(--s2)" }}>
                        <button className="btn btn--secondary" onClick={() => setStep(0)}>Back</button>
                        <button className="btn btn--primary" onClick={() => void submitPricing()} disabled={loading} id="onboard-next-2">
                            {loading ? "Saving..." : "Continue ->"}
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="card card--panel" style={{ textAlign: "center" }}>
                    <div className="stack stack-3" style={{ alignItems: "center" }}>
                        <span style={{ fontSize: "3rem" }}>*</span>
                        <div className="stack stack-1">
                            <h3 style={{ fontSize: "1.25rem" }}>You&apos;re live!</h3>
                            <p className="t-sm t-muted">Your creator channel is ready. Start uploading content.</p>
                        </div>
                        <div className="row" style={{ gap: "var(--s2)" }}>
                            <button className="btn btn--primary" onClick={() => router.push("/creator-studio/dashboard")} id="onboard-go-dashboard">
                                Go to Dashboard
                            </button>
                            <button className="btn btn--secondary" onClick={() => router.push("/creator-studio/upload")} id="onboard-go-upload">
                                Upload Content
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
