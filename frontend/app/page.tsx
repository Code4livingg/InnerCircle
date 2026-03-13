"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="ic-landing">

      {/* Ambient fixed red glow */}
      <div className="ic-portal-ambient" aria-hidden="true" />

      {/* ── Cinematic Portal Hero ── */}
      <section className="ic-hero-cinematic">

        {/* Portal Ring Visual (background) */}
        <div className="ic-portal" aria-hidden="true">

          {/* Atmospheric haze */}
          <div className="ic-portal__haze" />

          {/* Outer debris ring */}
          <div className="ic-portal__outer-ring">
            <div className="ic-particle" />
            <div className="ic-particle" />
          </div>

          {/* Main energy ring — pulsing + spinning */}
          <div className="ic-portal__main-ring">
            <div className="ic-portal__main-ring-inner">
              <div className="ic-orb" />
              <div className="ic-orb" />
              <div className="ic-orb" />
            </div>
          </div>

          {/* Inner plasma ring */}
          <div className="ic-portal__inner-ring" />
        </div>

        {/* Foreground hero content */}
        <div className="ic-hero__content ic-fade-up">

          {/* Stacked headline */}
          <h1 className="ic-hero__headline ic-fade-up ic-delay-100">
            <span>Watch.</span>
            <span>Subscribe.</span>
            <span className="ic-red">Own.</span>
          </h1>

          {/* Subheadline */}
          <h2 className="ic-hero__sub ic-fade-up ic-delay-200">
            Where Privacy Meets Power
          </h2>

          {/* Supporting text */}
          <p className="ic-hero__desc-text ic-fade-up ic-delay-200">
            A private creator economy powered by Aleo.
          </p>

          {/* Pill row — three bullet points */}
          <div className="ic-hero__pill-row ic-fade-up ic-delay-300">
            <div className="ic-hero__pill-item">
              <div className="ic-hero__pill-dot" />
              No surveillance
            </div>
            <div className="ic-hero__pill-sep" />
            <div className="ic-hero__pill-item">
              <div className="ic-hero__pill-dot" />
              No platform control
            </div>
            <div className="ic-hero__pill-sep" />
            <div className="ic-hero__pill-item">
              <div className="ic-hero__pill-dot" />
              Only creators and their circle
            </div>
          </div>

          {/* CTA */}
          <Link href="/wallet" className="ic-hero__cta ic-fade-up ic-delay-400">
            Connect Wallet
            <span className="ic-hero__cta-arrow">→</span>
          </Link>
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
