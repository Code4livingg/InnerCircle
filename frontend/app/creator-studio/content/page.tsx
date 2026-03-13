"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/walletContext";
import { fetchCreatorByWallet, fetchSubscriptionTiers, updateContentMetadata, type Content, type SubscriptionTier } from "../../../lib/api";
import { getWalletSessionToken } from "../../../lib/walletSession";

export default function MyContentPage() {
    const wallet = useWallet();
    const { address } = wallet;
    const [contents, setContents] = useState<Content[]>([]);
    const [loading, setLoading] = useState(true);
    const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const loadContents = async () => {
            try {
                if (!address) {
                    setContents([]);
                    return;
                }

                const data = await fetchCreatorByWallet(address);
                setContents(data.creator.contents);
                localStorage.setItem("innercircle_creator_handle", data.creator.handle);
                const tierData = await fetchSubscriptionTiers(data.creator.handle);
                setTiers(tierData.tiers);
            } catch {
                setContents([]);
            } finally {
                setLoading(false);
            }
        };

        void loadContents();
    }, [address]);

    const handleTierChange = async (contentId: string, nextTierId: string) => {
        if (!address) return;
        setSavingId(contentId);
        setSaveError(null);
        try {
            const token = await getWalletSessionToken(wallet);
            const updated = await updateContentMetadata(
                contentId,
                { subscriptionTierId: nextTierId || null },
                token,
            );
            setContents((prev) =>
                prev.map((item) =>
                    item.id === contentId ? { ...item, subscriptionTierId: updated.content.subscriptionTierId } : item,
                ),
            );
        } catch (error) {
            setSaveError((error as Error).message || "Failed to update tier.");
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div style={{ padding: "var(--s4) 0" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "var(--s6)", flexWrap: "wrap", gap: "var(--s3)" }}>
                <div className="stack stack-1">
                    <p className="section__label">Creator Studio</p>
                    <h1 style={{ fontSize: "1.75rem" }}>My Content</h1>
                </div>
                <Link href="/creator-studio/upload" className="btn btn--primary btn--sm" id="content-upload-btn">
                    ⊕ Upload
                </Link>
            </div>

            {loading && (
                <div className="stack stack-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="skeleton-card">
                            <div className="skeleton skeleton-line skeleton-line--medium" />
                            <div className="skeleton skeleton-line skeleton-line--short" />
                        </div>
                    ))}
                </div>
            )}

            {!loading && contents.length === 0 && (
                <div className="empty-state">
                    <span className="empty-state__icon">▣</span>
                    <span className="empty-state__title">No content yet</span>
                    <span className="empty-state__desc">Upload your first piece of content to start building your channel.</span>
                    <Link href="/creator-studio/upload" className="btn btn--primary btn--sm">Upload now</Link>
                </div>
            )}

            {!loading && contents.length > 0 && (
                <div className="stack stack-2">
                    {saveError && (
                        <div className="card card--panel" style={{ borderColor: "var(--c-error)" }}>
                            <p className="t-sm t-error">{saveError}</p>
                        </div>
                    )}
                    {contents.map((item) => (
                        <div key={item.id} className="card" style={{ padding: "var(--s3)" }}>
                            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--s2)" }}>
                                <div className="stack stack-1">
                                    <span style={{ fontWeight: 600, color: "var(--c-text-1)", fontSize: "0.9375rem" }}>{item.title}</span>
                                    <div className="row row-2">
                                        <span className="t-xs t-dim">{item.kind}</span>
                                        <span className="t-xs t-dim">·</span>
                                        <span className="t-xs t-dim">
                                            {item.ppvPriceMicrocredits
                                                ? `PPV · ${(Number(item.ppvPriceMicrocredits) / 1_000_000).toFixed(2)} credits`
                                                : "Subscription"}
                                        </span>
                                    </div>
                                </div>
                                <div className="row row-2">
                                    <span className={`badge ${item.isPublished ? "badge--secure" : "badge--locked"}`}>
                                        {item.isPublished ? "Live" : "Draft"}
                                    </span>
                                </div>
                            </div>
                            {item.accessType === "SUBSCRIPTION" && (
                                <div className="row row-2" style={{ marginTop: "var(--s2)" }}>
                                    <span className="t-xs t-dim">Tier</span>
                                    <select
                                        className="form-select"
                                        value={item.subscriptionTierId ?? ""}
                                        onChange={(e) => handleTierChange(item.id, e.target.value)}
                                        disabled={savingId === item.id}
                                        style={{ minWidth: 220 }}
                                    >
                                        <option value="">All subscribers</option>
                                        {tiers.map((tier) => (
                                            <option key={tier.id} value={tier.id}>
                                                {tier.tierName} Â· {(Number(tier.priceMicrocredits) / 1_000_000).toFixed(2)} credits
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
