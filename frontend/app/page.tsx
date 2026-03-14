"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="lc-landing">
      <section className="lc-hero">
        {/* Layered background gradients */}
        <div className="lc-hero__bg" aria-hidden="true" />
        {/* Subtle watermark brand text - low opacity, purely decorative */}
        <div className="lc-hero__watermark" aria-hidden="true">INNERCIRCLE</div>

        <div className="lc-hero__container">
          {/* -- Left column: copy -- */}
          <div className="lc-hero__copy">
            <span className="lc-hero__eyebrow">
              <span className="lc-hero__eyebrow-dot" />
              Privacy-first Creator Platform
            </span>

            <h1 className="lc-hero__title">
              The Private<br />Creator Economy
            </h1>

            <p className="lc-hero__subtitle">
              Launch paid memberships, share gated media, and accept private
              tips, without giving up ownership.
            </p>

            <div className="lc-hero__actions">
              <Link href="/wallet" className="lc-hero__btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/>
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none"/>
                </svg>
                Connect Wallet
              </Link>
              <Link href="/discover" className="lc-hero__btn-secondary">
                Explore Creators
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>

            {/* Trust indicators */}
            <div className="lc-hero__trust">
              <span className="lc-trust-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Secure streaming
              </span>
              <span className="lc-trust-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Private subscriptions
              </span>
              <span className="lc-trust-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Creator-owned economy
              </span>
            </div>
          </div>

          {/* -- Right column: phone mockup -- */}
          <div className="lc-hero__visual">
            <div className="lc-hero__phone-aura" aria-hidden="true" />
            <div className="lc-hero__phone">
              <div className="lc-hero__phone-notch" aria-hidden="true" />
              <img
                src="/creator-woman.png"
                alt="Creator on InnerCircle"
                className="lc-hero__phone-img"
              />
              <div className="lc-hero__phone-shine" aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      <section className="lc-section" id="how">
        <div className="container">
          <div className="lc-section__header">
            <span className="lc-section__label">How InnerCircle Works</span>
            <h2 className="lc-section__title">Private by design, effortless for fans</h2>
            <p className="lc-section__subtitle">
              Wallet sessions unlock content only after verified payments. Your audience stays private, your earnings stay direct.
            </p>
          </div>
          <div className="lc-step-grid">
            <div className="lc-step-card">
              <span className="lc-step">01</span>
              <h3>Launch tiers</h3>
              <p>Create flexible subscription tiers and assign content to each tier inside the Creator Dashboard.</p>
            </div>
            <div className="lc-step-card">
              <span className="lc-step">02</span>
              <h3>Fans pay privately</h3>
              <p>On-chain payments are verified, then sessions are issued without exposing fan identities.</p>
            </div>
            <div className="lc-step-card">
              <span className="lc-step">03</span>
              <h3>Stream securely</h3>
              <p>Media is delivered via short-lived signed URLs from private S3 storage.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lc-section lc-section--alt" id="benefits">
        <div className="container">
          <div className="lc-section__header">
            <span className="lc-section__label">Creator Benefits</span>
            <h2 className="lc-section__title">Everything you need to monetize privately</h2>
          </div>
          <div className="lc-feature-grid">
            <div className="lc-feature">
              <h3>Flexible tiers</h3>
              <p>Create, edit, and delete membership tiers anytime. Assign content to a specific tier or all subscribers.</p>
            </div>
            <div className="lc-feature">
              <h3>Private tipping</h3>
              <p>Enable anonymous tips with optional messages, plus a top supporters leaderboard.</p>
            </div>
            <div className="lc-feature">
              <h3>Creator analytics</h3>
              <p>Track subscribers, churn, tips, and content views with 30-day trend charts.</p>
            </div>
            <div className="lc-feature">
              <h3>Instant payouts</h3>
              <p>Payments settle directly to your wallet with no platform escrow.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lc-section" id="security">
        <div className="container lc-security">
          <div className="lc-security__copy">
            <span className="lc-section__label">Security and Privacy</span>
            <h2 className="lc-section__title">Designed to stop leaks and track abuse</h2>
            <p className="lc-section__subtitle">
              Every playback session is validated, logged, and watermarked before a signed URL is issued.
            </p>
            <div className="lc-security__list">
              <div className="lc-security__item">Signed streaming URLs with 60 to 120 second expiry</div>
              <div className="lc-security__item">Private S3 bucket with blocked public access</div>
              <div className="lc-security__item">Wallet sessions and rate-limited API requests</div>
              <div className="lc-security__item">Content access logging with per-session watermark IDs</div>
            </div>
          </div>
          <div className="lc-security__panel">
            <div className="lc-security__card">
              <h3>Secure delivery flow</h3>
              <ol className="lc-flow">
                <li>Fan requests media</li>
                <li>API validates subscription or PPV</li>
                <li>Signed URL issued (short-lived)</li>
                <li>Frontend streams securely</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="lc-section lc-section--alt" id="pricing">
        <div className="container">
          <div className="lc-section__header">
            <span className="lc-section__label">Pricing</span>
            <h2 className="lc-section__title">Set your own tiers, keep control</h2>
            <p className="lc-section__subtitle">Creators define pricing. Fans pay directly in credits with on-chain verification.</p>
          </div>
          <div className="lc-price-grid">
            <div className="lc-price-card">
              <h3>Fans</h3>
              <p className="lc-price">Pay per tier</p>
              <p className="lc-price-note">Subscribe or unlock PPV content with verified payments.</p>
              <ul className="lc-list">
                <li>Wallet-based access</li>
                <li>Anonymous tipping</li>
                <li>Private library</li>
              </ul>
            </div>
            <div className="lc-price-card lc-price-card--highlight">
              <h3>Creators</h3>
              <p className="lc-price">Your tiers, your rules</p>
              <p className="lc-price-note">Build multiple tiers and adjust pricing without touching fan data.</p>
              <ul className="lc-list">
                <li>Dynamic tier management</li>
                <li>Analytics dashboard</li>
                <li>Secure media delivery</li>
              </ul>
              <Link href="/creator-studio/onboarding" className="btn btn--primary btn--sm">Become a Creator</Link>
            </div>
            <div className="lc-price-card">
              <h3>Teams</h3>
              <p className="lc-price">Custom</p>
              <p className="lc-price-note">Need advanced workflows or concierge onboarding? Talk to us.</p>
              <ul className="lc-list">
                <li>Dedicated support</li>
                <li>Custom analytics</li>
                <li>Migration assistance</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="lc-section" id="explore">
        <div className="container lc-explore">
          <div className="lc-explore__copy">
            <span className="lc-section__label">Explore Creators</span>
            <h2 className="lc-section__title">Find your next private circle</h2>
            <p className="lc-section__subtitle">Discover verified creators across writing, music, art, and community-led channels.</p>
            <div className="lc-chip-row">
              {"Writing, Music, Visual Art, Education, Wellness, Crypto".split(", ").map((item) => (
                <span key={item} className="lc-chip">{item}</span>
              ))}
            </div>
          </div>
          <div className="lc-explore__actions">
            <Link href="/discover" className="btn btn--primary btn--lg">Explore Creators</Link>
            <Link href="/creator-studio/onboarding" className="btn btn--secondary btn--lg">Launch your channel</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
