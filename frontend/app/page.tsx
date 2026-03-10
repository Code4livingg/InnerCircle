"use client";

import Link from "next/link";
import Image from "next/image";
import { HeroTypingText } from "../components/HeroTypingText";

export default function LandingPage() {
  return (
    <main className="ic-landing">
      {/* Noise texture overlay */}
      <div className="ic-noise" aria-hidden="true" />

      {/* Cinematic glow background */}
      <div className="ic-bg-glow" aria-hidden="true" />

      {/* Massive background typography */}
      <div className="ic-bg-text" aria-hidden="true">
        <h1>INNER CIRCLE</h1>
      </div>

      {/* ── Hero Card ── */}
      <section className="ic-hero-outer">
        <div className="ic-hero-card ic-fade-up">

          {/* 3-Column Narrative Grid */}
          <div className="ic-hero-grid">

            {/* Left — Story Text */}
            <div className="ic-hero__text ic-fade-up ic-delay-200">
              <h2 className="ic-hero__title">
                <span>Watch.</span>
                <span>Subscribe.</span>
                <span className="ic-red">Own.</span>
              </h2>

              <div className="ic-hero__copy">
                <div className="ic-hero__line-decor" />
                <HeroTypingText />
                <div className="ic-hero__desc">
                  <p>A private creator economy powered by Aleo.</p>
                  <p className="ic-dim">
                    No surveillance.<br />
                    No platform control.<br />
                    Only creators and their circle.
                  </p>
                </div>
              </div>
            </div>

            {/* Center — Visual Symbol */}
            <div className="ic-hero__visual ic-fade-up ic-delay-300">
              <div className="ic-hero__image-container">
                <div className="ic-hero__phone">
                  <div className="ic-hero__phone-overlay-top" />
                  <div className="ic-hero__phone-overlay-shadow" />
                  <Image
                    src="/hero-woman.png"
                    alt="InnerCircle — premium creator"
                    width={240}
                    height={420}
                    priority
                    style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  />
                </div>
              </div>
            </div>

            {/* Right — Step Panel */}
            <div className="ic-hero__panel ic-fade-up ic-delay-400">
              <div className="ic-panel">
                <div className="ic-panel__glow" />

                {/* Step 01 */}
                <div className="ic-step">
                  <span className="ic-step__label ic-red">Step 01</span>
                  <h3 className="ic-step__title">Connect your private wallet</h3>
                  <div className="ic-step__content">
                    <Link href="/wallet" className="ic-btn-red">
                      <span>Connect Wallet</span>
                      <span className="ic-btn-arrow">→</span>
                    </Link>
                  </div>
                </div>

                {/* Step 02 */}
                <div className="ic-step ic-step--dim">
                  <span className="ic-step__label">Step 02</span>
                  <h3 className="ic-step__title">Enter the creator circle</h3>
                  <div className="ic-step__content">
                    <Link href="/discover" className="ic-btn-outline">
                      <span>Explore Creators</span>
                      <span className="ic-btn-arrow">→</span>
                    </Link>
                  </div>
                </div>

                {/* Step 03 */}
                <div className="ic-step ic-step--locked">
                  <span className="ic-step__label">Step 03</span>
                  <h3 className="ic-step__title">Unlock private content</h3>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Privacy Architecture ── */}
      <section className="ic-section">
        <div className="container">
          <div className="ic-section__header">
            <span className="ic-section__label">Privacy Architecture</span>
            <h2 className="ic-section__title">Built different, by design</h2>
          </div>

          <div className="ic-privacy-grid">
            {[
              { icon: "◈", title: "No identity required", desc: "Wallet address is your only identifier. No email, no name, no tracking." },
              { icon: "◉", title: "Direct payments", desc: "Credits go straight from your wallet to the creator. No middleman." },
              { icon: "▣", title: "Encrypted streaming", desc: "Content is AES-256 encrypted. Only verified subscribers can decrypt." },
              { icon: "◎", title: "Ephemeral sessions", desc: "Access tokens exist only in your browser. Nothing stored on our servers." },
            ].map((item) => (
              <div key={item.title} className="ic-privacy-item">
                <span className="ic-privacy-item__icon">{item.icon}</span>
                <h4 className="ic-privacy-item__title">{item.title}</h4>
                <p className="ic-privacy-item__desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="ic-section ic-section--cta">
        <div className="container" style={{ textAlign: "center" }}>
          <div className="ic-cta">
            <h2 className="ic-section__title">Ready to enter the circle?</h2>
            <p className="ic-dim" style={{ marginBottom: "var(--s4)" }}>
              Join as a fan or launch your private creator channel.
            </p>
            <div className="ic-cta__actions">
              <Link href="/wallet" className="ic-btn-red">Get Started</Link>
              <Link href="/creator-studio/onboarding" className="ic-btn-outline">Become a Creator</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
