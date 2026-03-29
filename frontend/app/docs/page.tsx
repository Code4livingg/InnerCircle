"use client";

import Link from "next/link";
import { useState } from "react";

const SECTIONS = [
  { id: "overview",     label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "zk-invoice",  label: "ZK Invoice System" },
  { id: "payments",    label: "Payment Options" },
  { id: "anonymous",   label: "Anonymous Viewing" },
  { id: "tipping",     label: "Tipping" },
  { id: "creator-studio", label: "Creator Studio" },
  { id: "contracts",   label: "Smart Contracts" },
  { id: "faq",         label: "FAQ" },
];

export default function DocsPage() {
  const [active, setActive] = useState("overview");

  return (
    <div className="docs-page">
      {/* Sidebar */}
      <aside className="docs-sidebar">
        <div className="docs-sidebar__brand">
          <span className="docs-sidebar__logo">IC</span>
          <div>
            <p className="docs-sidebar__title">InnerCircle</p>
            <p className="docs-sidebar__version">Docs v1.0</p>
          </div>
        </div>

        <nav className="docs-nav">
          <p className="docs-nav__group-label">Documentation</p>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`docs-nav__item${active === s.id ? " docs-nav__item--active" : ""}`}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="docs-sidebar__footer">
          <Link href="/" className="docs-sidebar__back">← Back to app</Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="docs-main">
        <div className="docs-content">

          {/* Hero banner */}
          <div className="docs-hero">
            <span className="docs-hero__badge">Documentation</span>
            <h1 className="docs-hero__title">InnerCircle Platform Guide</h1>
            <p className="docs-hero__sub">
              Everything you need to understand, use, and build on InnerCircle —
              the privacy-first creator subscription platform built on the Aleo blockchain.
            </p>
            <div className="docs-hero__tags">
              <span className="badge badge--secure">Aleo Blockchain</span>
              <span className="badge badge--secure">Zero-Knowledge Proofs</span>
              <span className="badge badge--locked">Private by Default</span>
            </div>
          </div>

          {/* ── SECTION 1: Overview ── */}
          <section id="overview" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">01</span>
              <h2>What is InnerCircle?</h2>
            </div>
            <p className="docs-section__lead">
              InnerCircle is a Web3 creator subscription platform that lets creators monetize their exclusive
              content while protecting both creator and fan identities using Aleo's zero-knowledge proof system.
            </p>
            <div className="docs-callout docs-callout--info">
              <strong>Core Principle:</strong> Unlike traditional platforms where subscription data is publicly visible
              on-chain, InnerCircle uses private records — your subscriptions, payments, and content access
              are invisible to everyone except you.
            </div>

            <div className="docs-grid-2">
              <div className="docs-card">
                <div className="docs-card__icon">🎭</div>
                <h3>For Fans</h3>
                <p>Subscribe to creators privately. Your wallet address is never linked to your subscriptions publicly. Pay with Aleo Credits or USDCx stablecoin.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card__icon">🎨</div>
                <h3>For Creators</h3>
                <p>Set up subscription tiers, upload exclusive content, receive private tips, and go live — all without a centralized middleman taking a majority cut.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card__icon">🔐</div>
                <h3>ZK Security</h3>
                <p>Payments generate a zero-knowledge invoice record minted to your wallet. Access is proved locally — the backend never stores your private record.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card__icon">⚡</div>
                <h3>Direct Payments</h3>
                <p>Aleo Credits or USDCx stablecoin settle directly to the creator's wallet. No escrow, no delays, no platform holding your funds.</p>
              </div>
            </div>
          </section>

          {/* ── SECTION 2: How it works ── */}
          <section id="how-it-works" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">02</span>
              <h2>How It Works</h2>
            </div>
            <p className="docs-section__lead">
              InnerCircle's subscription flow combines on-chain ZK proofs with session-based content access for a seamless, private experience.
            </p>

            <div className="docs-steps">
              <div className="docs-step">
                <div className="docs-step__num">1</div>
                <div className="docs-step__body">
                  <h4>Connect Wallet</h4>
                  <p>Connect your Aleo wallet (Leo Wallet or Shield Wallet). This is your identity — no email or password required. Your address is never stored in plaintext.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">2</div>
                <div className="docs-step__body">
                  <h4>Choose a Creator & Tier</h4>
                  <p>Browse the Discover page. Select a creator and choose a subscription tier. Each tier defines which content you can access.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">3</div>
                <div className="docs-step__body">
                  <h4>Pay & Mint ZK Invoice</h4>
                  <p>Your payment mints a private <code>SubscriptionInvoice</code> record directly to your wallet via the <code>sub_invoice_v8_xwnxp.aleo</code> contract. This record contains your circle ID, expiry block, tier, and a random salt — all encrypted.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">4</div>
                <div className="docs-step__body">
                  <h4>Prove Locally, Access Content</h4>
                  <p>When visiting a creator's page, your browser generates a ZK proof from the private invoice record. This proof is sent to the backend which verifies the subscription commitment without ever seeing your wallet address.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">5</div>
                <div className="docs-step__body">
                  <h4>Stream & Interact</h4>
                  <p>Unlocked content streams via signed URLs that expire in 60–120 seconds. Live sessions use IVS with EC384 JWT tokens. Each session is watermarked for leak attribution.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── SECTION 3: ZK Invoice ── */}
          <section id="zk-invoice" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">03</span>
              <h2>ZK Invoice System</h2>
            </div>
            <p className="docs-section__lead">
              The ZK Invoice is the core privacy primitive of InnerCircle. It lets you prove you have an active
              subscription without revealing your identity to the creator or the backend.
            </p>

            <div className="docs-callout docs-callout--success">
              <strong>Privacy guarantee:</strong> The creator never learns your wallet address. The backend never stores your private invoice record. Only the on-chain commitment is public — and it's a hash.
            </div>

            <h3>How the Invoice Works</h3>
            <div className="docs-code-block">
              <div className="docs-code-block__label">Contract: sub_invoice_v8_xwnxp.aleo</div>
              <pre>{`// When you subscribe, a private record is minted to YOUR wallet:
record SubscriptionInvoice {
  owner: address,         // your wallet (private)
  circle_id: field,       // creator's ID
  expiry_block: u32,      // when it expires
  tier: u8,               // which tier
  salt: field             // random blinding factor
}

// A public commitment is stored on-chain (hash only):
active_subscriptions[BHP256::hash(SubscriptionKey)] = true`}</pre>
            </div>

            <h3 style={{marginTop:"var(--s4)"}}>Verification Flow</h3>
            <p>When you prove a subscription, the <code>verify_subscription</code> transition checks your private invoice against the on-chain mapping — using only the hashed key, never your raw address.</p>

            <div className="docs-callout docs-callout--warning">
              <strong>Important:</strong> Your private invoice record is stored in your Aleo wallet, not the backend. If you clear your wallet or switch accounts, you will need to re-subscribe to re-generate the proof.
            </div>
          </section>

          {/* ── SECTION 4: Payments ── */}
          <section id="payments" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">04</span>
              <h2>Payment Options</h2>
            </div>
            <p className="docs-section__lead">
              InnerCircle supports two payment assets and two payment routes. Understanding the combination that works best for your situation improves reliability.
            </p>

            <div className="docs-grid-2">
              <div className="docs-card docs-card--highlight">
                <div className="docs-card__icon">⚡</div>
                <h3>Aleo Credits</h3>
                <p>The native Aleo token. Always available if you have testnet credits. Fastest and most reliable option.</p>
                <div className="docs-card__tags">
                  <span className="badge badge--secure">Default</span>
                  <span className="badge badge--locked">Fastest</span>
                </div>
              </div>
              <div className="docs-card">
                <div className="docs-card__icon">💵</div>
                <h3>USDCx Stablecoin</h3>
                <p>Privacy-preserving USDC on Aleo. Backed 1:1 by USDC. Uses private token records and Merkle freeze-list compliance proofs.</p>
                <div className="docs-card__tags">
                  <span className="badge badge--secure">Stable</span>
                </div>
              </div>
            </div>

            <h3 style={{marginTop:"var(--s5)"}}>Payment Routes</h3>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr><th>Route</th><th>Method</th><th>When to Use</th><th>Privacy</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Public</strong></td>
                    <td>Public balance transfer</td>
                    <td>Default — most reliable for proving</td>
                    <td>Payment amount visible on-chain</td>
                  </tr>
                  <tr>
                    <td><strong>Private</strong></td>
                    <td>Private record spend</td>
                    <td>When you have a record large enough to cover the subscription</td>
                    <td>Amount hidden, but fee still public</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="docs-callout docs-callout--info">
              <strong>Recommendation:</strong> Use the <strong>Public route</strong> with <strong>Aleo Credits</strong> for the most reliable subscription experience on testnet. Private route is available for advanced users.
            </div>

            <h3 style={{marginTop:"var(--s5)"}}>Getting Testnet Funds</h3>
            <p>Need testnet credits? Visit the <a href="https://faucet.aleo.org" target="_blank" rel="noopener noreferrer" style={{color:"var(--c-violet)"}}>Aleo Faucet</a> to request credits.</p>
            <p style={{marginTop:"var(--s2)"}}>Need USDCx? Visit <a href="https://usdcx.aleo.dev" target="_blank" rel="noopener noreferrer" style={{color:"var(--c-violet)"}}>usdcx.aleo.dev</a> to mint testnet USDCx tokens.</p>
          </section>

          {/* ── SECTION 5: Anonymous Viewing ── */}
          <section id="anonymous" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">05</span>
              <h2>Anonymous Viewing</h2>
            </div>
            <p className="docs-section__lead">
              InnerCircle's anonymous session system lets you browse and consume content using a pseudonym derived from your wallet — decoupled from your real identity.
            </p>

            <h3>How Anon Sessions Work</h3>
            <div className="docs-steps">
              <div className="docs-step">
                <div className="docs-step__num">1</div>
                <div className="docs-step__body">
                  <h4>Toggle ANON Mode</h4>
                  <p>Enable the ANON switch in the top navbar. This activates anonymous session mode — your browsing activity is attributed to a deterministic pseudonym instead of your wallet address.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">2</div>
                <div className="docs-step__body">
                  <h4>Pseudonym Derivation</h4>
                  <p>Your anonymous label is derived as <code>anonLabelFromSeed(address)</code> — a deterministic hash that produces a consistent handle like "AnonNebula7" from your wallet without revealing it.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">3</div>
                <div className="docs-step__body">
                  <h4>Session Registration</h4>
                  <p>After subscribing, your browser automatically registers an anonymous session linked to your ZK invoice. The creator sees activity but not your wallet address.</p>
                </div>
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <strong>What creators see:</strong> Subscriber counts, tips amounts, content view counts — but never wallet addresses. The ANON system maps all activity to pseudonyms.
            </div>
          </section>

          {/* ── SECTION 6: Tipping ── */}
          <section id="tipping" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">06</span>
              <h2>Tipping</h2>
            </div>
            <p className="docs-section__lead">
              Send direct tips to creators with optional anonymous mode and public messages.
            </p>

            <div className="docs-grid-2">
              <div className="docs-card">
                <div className="docs-card__icon">🔒</div>
                <h3>Private Tip</h3>
                <p>Enable "Send tip anonymously" to use a private record transfer. Your wallet address is not linked to the tip on-chain.</p>
              </div>
              <div className="docs-card">
                <div className="docs-card__icon">🏆</div>
                <h3>Supporter Leaderboard</h3>
                <p>Top tippers appear on the creator's page under a pseudonym (anonymous label). No wallet addresses are ever displayed.</p>
              </div>
            </div>

            <h3 style={{marginTop:"var(--s4)"}}>Tip Contract</h3>
            <div className="docs-code-block">
              <div className="docs-code-block__label">Contract: tip_pay_v4_xwnxp.aleo</div>
              <pre>{`// Public tip (on-chain attribution):
tip_public(creator_id: field, amount: u64)

// Private tip (hidden sender):
tip_private_v2(creator_record: TipCreatorRecord, amount: u64)

// USDCx tip:
tip_usdcx_public(creator_id: field, token: Token, amount: u128)`}</pre>
            </div>
          </section>

          {/* ── SECTION 7: Creator Studio ── */}
          <section id="creator-studio" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">07</span>
              <h2>Creator Studio</h2>
            </div>
            <p className="docs-section__lead">
              The Creator Studio is your command center for managing content, tiers, subscribers, and earnings.
            </p>

            <div className="docs-steps">
              <div className="docs-step">
                <div className="docs-step__num">1</div>
                <div className="docs-step__body">
                  <h4>Onboarding</h4>
                  <p>Register as a creator by deploying your creator record on-chain via <code>creator_reg_v5_xwnxp.aleo</code>. Set your handle, display name, bio, and initial subscription price.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">2</div>
                <div className="docs-step__body">
                  <h4>Create Tiers</h4>
                  <p>Set up multiple membership tiers with different prices and content access levels. Tiers are stored on-chain and updated via wallet transactions.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">3</div>
                <div className="docs-step__body">
                  <h4>Upload Content</h4>
                  <p>Upload videos, images, and posts from the Studio. Content is encrypted on ingest using AES-256-GCM with per-file keys and stored in private S3.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">4</div>
                <div className="docs-step__body">
                  <h4>Go Live</h4>
                  <p>Start a live stream directly from the Studio. InnerCircle uses Amazon IVS with EC384 JWT playback tokens — only verified subscribers can join.</p>
                </div>
              </div>
              <div className="docs-step">
                <div className="docs-step__num">5</div>
                <div className="docs-step__body">
                  <h4>Track Earnings</h4>
                  <p>View subscriber counts, monthly tips, PPV revenue, and content view analytics in the Earnings dashboard.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── SECTION 8: Contracts ── */}
          <section id="contracts" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">08</span>
              <h2>Smart Contract Architecture</h2>
            </div>
            <p className="docs-section__lead">
              InnerCircle runs on 5 core Aleo programs, each handling a distinct part of the privacy stack.
            </p>

            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr><th>Contract</th><th>Purpose</th><th>Key Feature</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>sub_invoice_v8_xwnxp.aleo</code></td>
                    <td>Subscriptions</td>
                    <td>Mints private SubscriptionInvoice records. Supports Aleo Credits + USDCx.</td>
                  </tr>
                  <tr>
                    <td><code>tip_pay_v4_xwnxp.aleo</code></td>
                    <td>Tips</td>
                    <td>Public and private tip transfers. Leaderboard via public mapping.</td>
                  </tr>
                  <tr>
                    <td><code>ppv_pay_v5_xwnxp.aleo</code></td>
                    <td>Pay-Per-View</td>
                    <td>One-time content unlock records. Blind relay for privacy.</td>
                  </tr>
                  <tr>
                    <td><code>access_pass_v4_xwnxp.aleo</code></td>
                    <td>Access Passes</td>
                    <td>Transferable on-chain access credentials for exclusive drops.</td>
                  </tr>
                  <tr>
                    <td><code>creator_reg_v5_xwnxp.aleo</code></td>
                    <td>Creator Registry</td>
                    <td>On-chain creator registration with handle → address resolution.</td>
                  </tr>
                  <tr>
                    <td><code>test_usdcx_stablecoin.aleo</code></td>
                    <td>USDCx Token</td>
                    <td>Private token records for stablecoin payments with Merkle freeze-list compliance.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="docs-callout docs-callout--info" style={{marginTop:"var(--s4)"}}>
              <strong>Deployment:</strong> All contracts are deployed on Aleo Testnet 3. Contract IDs are configured via <code>NEXT_PUBLIC_*</code> environment variables in the frontend.
            </div>
          </section>

          {/* ── SECTION 9: FAQ ── */}
          <section id="faq" className="docs-section">
            <div className="docs-section__heading">
              <span className="docs-section__number">09</span>
              <h2>Frequently Asked Questions</h2>
            </div>

            <div className="docs-faq">
              {[
                {
                  q: "Is InnerCircle on mainnet?",
                  a: "No. InnerCircle is currently deployed on Aleo Testnet 3. Use the Aleo faucet to get testnet credits."
                },
                {
                  q: "Can the creator see my wallet address?",
                  a: "No. Your ZK invoice is a private record minted to your wallet. The creator's contract only stores a BHP256 hash of the subscription key — never your raw address."
                },
                {
                  q: "What happens if my subscription expires?",
                  a: "Your private invoice has an expiry_block field. After that block, the verify_subscription proof fails and you lose access to private content. Simply re-subscribe to renew."
                },
                {
                  q: "Why does the balance check show 0 credits?",
                  a: "The balance check scans your connected wallet's public and private balances. If you've recently received credits, they may take a few minutes to appear after the transaction confirms."
                },
                {
                  q: "What is USDCx?",
                  a: "USDCx is a privacy-preserving stablecoin token on Aleo, backed 1:1 by USDC. It uses private token records so the payment amount is hidden on-chain. Mint testnet USDCx at usdcx.aleo.dev."
                },
                {
                  q: "How do I become a creator?",
                  a: "Connect your wallet, navigate to Creator Studio, and complete the onboarding flow. This registers your creator record on-chain via the creator_reg_v5_xwnxp.aleo contract."
                },
                {
                  q: "Is content end-to-end encrypted?",
                  a: "Content at rest is encrypted with AES-256-GCM using per-file keys. Live streaming uses short-lived signed URLs. Full browser-side E2E decryption is a planned future upgrade."
                }
              ].map(({ q, a }) => (
                <div key={q} className="docs-faq__item">
                  <h4>{q}</h4>
                  <p>{a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div className="docs-footer">
            <p className="t-xs t-dim">InnerCircle · Built on Aleo · Privacy is the new premium</p>
            <div className="docs-footer__links">
              <Link href="/discover" className="docs-footer__link">Discover Creators</Link>
              <Link href="/wallet" className="docs-footer__link">Connect Wallet</Link>
              <Link href="/creator-studio/onboarding" className="docs-footer__link">Become a Creator</Link>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
