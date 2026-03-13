"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/walletContext";
import { getWalletSessionToken } from "@/lib/walletSession";
import {
  createSubscriptionTier,
  deleteSubscriptionTier,
  fetchMySubscriptionTiers,
  updateSubscriptionTier,
  type SubscriptionTier,
} from "../../../lib/api";

interface TierDraft {
  tierName: string;
  price: string;
  description: string;
  benefits: string;
}

const toMicrocredits = (value: string): string => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "0";
  return String(Math.round(parsed * 1_000_000));
};

const toCredits = (microcredits: string): string =>
  (Number(microcredits) / 1_000_000).toFixed(2);

const serializeBenefits = (benefits: string[]): string => benefits.join(", ");

const parseBenefits = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export default function CreatorTiersPage() {
  const wallet = useWallet();
  const { address, connected } = wallet;

  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newTier, setNewTier] = useState<TierDraft>({
    tierName: "",
    price: "",
    description: "",
    benefits: "",
  });

  const hydrateDrafts = (data: SubscriptionTier[]) => {
    const next: Record<string, TierDraft> = {};
    data.forEach((tier) => {
      next[tier.id] = {
        tierName: tier.tierName,
        price: toCredits(tier.priceMicrocredits),
        description: tier.description ?? "",
        benefits: serializeBenefits(tier.benefits ?? []),
      };
    });
    setDrafts(next);
  };

  const loadTiers = async () => {
    if (!connected || !address) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const token = await getWalletSessionToken(wallet);
      const data = await fetchMySubscriptionTiers(token);
      setTiers(data.tiers);
      hydrateDrafts(data.tiers);
    } catch (err) {
      setError((err as Error).message || "Failed to load tiers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTiers();
  }, [address, connected]);

  const updateDraft = (id: string, field: keyof TierDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleCreate = async () => {
    try {
      setSaving("new");
      setError(null);
      const token = await getWalletSessionToken(wallet);
      await createSubscriptionTier(
        {
          tierName: newTier.tierName,
          priceMicrocredits: toMicrocredits(newTier.price),
          description: newTier.description || undefined,
          benefits: parseBenefits(newTier.benefits),
        },
        token,
      );
      setNewTier({ tierName: "", price: "", description: "", benefits: "" });
      await loadTiers();
    } catch (err) {
      setError((err as Error).message || "Failed to create tier.");
    } finally {
      setSaving(null);
    }
  };

  const handleSave = async (tierId: string) => {
    const draft = drafts[tierId];
    if (!draft) return;
    try {
      setSaving(tierId);
      setError(null);
      const token = await getWalletSessionToken(wallet);
      await updateSubscriptionTier(
        tierId,
        {
          tierName: draft.tierName,
          priceMicrocredits: toMicrocredits(draft.price),
          description: draft.description || undefined,
          benefits: parseBenefits(draft.benefits),
        },
        token,
      );
      await loadTiers();
    } catch (err) {
      setError((err as Error).message || "Failed to update tier.");
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (tierId: string) => {
    try {
      setSaving(tierId);
      setError(null);
      const token = await getWalletSessionToken(wallet);
      await deleteSubscriptionTier(tierId, token);
      await loadTiers();
    } catch (err) {
      setError((err as Error).message || "Failed to delete tier.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{ padding: "var(--s4) 0", maxWidth: 860 }}>
      <div className="stack stack-2" style={{ marginBottom: "var(--s6)" }}>
        <p className="section__label">Creator Studio</p>
        <h1 style={{ fontSize: "1.75rem" }}>Subscription Tiers</h1>
        <p className="t-sm t-muted">
          Build flexible membership tiers and assign content to each level.
        </p>
      </div>

      {error && (
        <div className="card card--panel" style={{ borderColor: "var(--c-error)", marginBottom: "var(--s4)" }}>
          <p className="t-sm t-error">{error}</p>
        </div>
      )}

      <div className="card card--panel" style={{ marginBottom: "var(--s5)" }}>
        <h3 style={{ marginBottom: "var(--s2)" }}>Create new tier</h3>
        <div className="grid-2" style={{ gap: "var(--s3)" }}>
          <div className="form-group">
            <label className="form-label">Tier name</label>
            <input
              className="form-input"
              value={newTier.tierName}
              onChange={(e) => setNewTier((prev) => ({ ...prev, tierName: e.target.value }))}
              placeholder="e.g. Inner Circle"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Price (credits)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={newTier.price}
              onChange={(e) => setNewTier((prev) => ({ ...prev, price: e.target.value }))}
              placeholder="e.g. 5.00"
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={newTier.description}
            onChange={(e) => setNewTier((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Describe this tier."
          />
        </div>
        <div className="form-group">
          <label className="form-label">Benefits (comma separated)</label>
          <input
            className="form-input"
            value={newTier.benefits}
            onChange={(e) => setNewTier((prev) => ({ ...prev, benefits: e.target.value }))}
            placeholder="Early posts, Behind-the-scenes, Community chat"
          />
        </div>
        <button className="btn btn--primary" onClick={handleCreate} disabled={saving === "new" || !newTier.tierName}>
          {saving === "new" ? "Creating tier..." : "Create tier"}
        </button>
      </div>

      {loading && (
        <div className="card card--panel">
          <p className="t-sm t-muted">Loading tiers...</p>
        </div>
      )}

      {!loading && tiers.length === 0 && (
        <div className="card card--panel">
          <p className="t-sm t-muted">No tiers yet. Create your first tier above.</p>
        </div>
      )}

      {!loading && tiers.length > 0 && (
        <div className="stack stack-3">
          {tiers.map((tier) => {
            const draft = drafts[tier.id];
            if (!draft) return null;
            return (
              <div key={tier.id} className="card card--panel">
                <div className="grid-2" style={{ gap: "var(--s3)" }}>
                  <div className="form-group">
                    <label className="form-label">Tier name</label>
                    <input
                      className="form-input"
                      value={draft.tierName}
                      onChange={(e) => updateDraft(tier.id, "tierName", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Price (credits)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.price}
                      onChange={(e) => updateDraft(tier.id, "price", e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-textarea"
                    value={draft.description}
                    onChange={(e) => updateDraft(tier.id, "description", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Benefits (comma separated)</label>
                  <input
                    className="form-input"
                    value={draft.benefits}
                    onChange={(e) => updateDraft(tier.id, "benefits", e.target.value)}
                  />
                </div>
                <div className="row row-2">
                  <button className="btn btn--primary btn--sm" onClick={() => handleSave(tier.id)} disabled={saving === tier.id}>
                    {saving === tier.id ? "Saving..." : "Save changes"}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => handleDelete(tier.id)} disabled={saving === tier.id}>
                    Delete tier
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
