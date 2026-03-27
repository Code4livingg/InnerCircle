"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const PAUSE_AT = 13; // second where girl stands still

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [revealed, setRevealed] = useState(false);

  // Pause video at PAUSE_AT → reveal CTA buttons
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      if (!revealed && video.currentTime >= PAUSE_AT) {
        video.pause();
        setRevealed(true);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [revealed]);

  // Reveal each .lc-ss when it enters view
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".lc-ss");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("is-visible"); }),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <main className="lc-landing">

      {/* ── FIXED VIDEO BACKGROUND — stays in place while everything scrolls ── */}
      <div className="lc-fixed-bg" aria-hidden="true">
        <video
          ref={videoRef}
          className="lc-fixed-bg__video"
          src="/demo.mp4"
          autoPlay
          muted
          playsInline
        />
        {/* Bottom fade so sections blend in seamlessly */}
        <div className="lc-fixed-bg__fade" />
      </div>

      {/* ── SLIDE 1: Hero screen — transparent, girl shows through ── */}
      <section className="lc-hero-screen">
        {/* Animated red smoke / living air effect */}
        <div className="lc-smoke-wrap" aria-hidden="true">
          <div className="lc-smoke lc-smoke--1" />
          <div className="lc-smoke lc-smoke--2" />
          <div className="lc-smoke lc-smoke--3" />
          <div className="lc-smoke lc-smoke--4" />
          <div className="lc-smoke lc-smoke--5" />
          <div className="lc-smoke lc-smoke--6" />
        </div>

        <div className={`lc-vh__story${revealed ? " is-revealed" : ""}`}>
          <div className="lc-vh__actions lc-story-1">
            <Link href="/wallet" className="lc-vh__btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none"/>
              </svg>
              Connect Wallet
            </Link>
            <Link href="/discover" className="lc-vh__btn-secondary">
              Explore Creators
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── SLIDE 2: How it works ── */}
      <section className="lc-ss" id="how">
        <div className="container">
          <div className="lc-ss__hd">
            <span className="lc-ss__label">How InnerCircle Works</span>
            <h2 className="lc-ss__title">Private by design,<br />effortless for fans</h2>
            <p className="lc-ss__sub">Wallet sessions unlock content only after verified payments. Your audience stays private, your earnings stay direct.</p>
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

      {/* ── SLIDE 3: Creator benefits ── */}
      <section className="lc-ss lc-ss--alt" id="benefits">
        <div className="container">
          <div className="lc-ss__hd">
            <span className="lc-ss__label">Creator Benefits</span>
            <h2 className="lc-ss__title">Everything you need to<br />monetize privately</h2>
          </div>
          <div className="lc-feature-grid">
            <div className="lc-feature"><h3>Flexible tiers</h3><p>Create, edit, and delete membership tiers anytime. Assign content to a specific tier or all subscribers.</p></div>
            <div className="lc-feature"><h3>Private tipping</h3><p>Enable anonymous tips with optional messages, plus a top supporters leaderboard.</p></div>
            <div className="lc-feature"><h3>Creator analytics</h3><p>Track subscribers, churn, tips, and content views with 30-day trend charts.</p></div>
            <div className="lc-feature"><h3>Instant payouts</h3><p>Payments settle directly to your wallet with no platform escrow.</p></div>
          </div>
        </div>
      </section>

      {/* ── SLIDE 4: Security ── */}
      <section className="lc-ss" id="security">
        <div className="container lc-security">
          <div className="lc-security__copy">
            <span className="lc-ss__label">Security & Privacy</span>
            <h2 className="lc-ss__title">Designed to stop leaks<br />and track abuse</h2>
            <p className="lc-ss__sub">Every playback session is validated, logged, and watermarked before a signed URL is issued.</p>
            <div className="lc-security__list">
              <div className="lc-security__item">Signed streaming URLs with 60–120 second expiry</div>
              <div className="lc-security__item">Per-user watermarking for leak attribution</div>
              <div className="lc-security__item">Zero-knowledge proof of payment — wallets never exposed</div>
              <div className="lc-security__item">Creator controls content visibility and revocation</div>
            </div>
          </div>
          <div className="lc-security__panel">
            <div className="lc-security__card">
              <div className="lc-metric"><span className="lc-metric__label">Session expiry</span><span className="lc-metric__value">60–120s</span></div>
              <div className="lc-metric"><span className="lc-metric__label">Payment proof</span><span className="lc-metric__value">ZK verified</span></div>
              <div className="lc-metric"><span className="lc-metric__label">Identity leak</span><span className="lc-metric__value">Zero</span></div>
              <div className="lc-metric"><span className="lc-metric__label">Watermark</span><span className="lc-metric__value">Per session</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SLIDE 5: Final CTA ── */}
      <section className="lc-ss lc-ss--cta" id="join">
        <div className="container">
          <div className="lc-cta__wrap">
            <div className="lc-ss__hd" style={{margin:"0 auto"}}>
              <span className="lc-ss__label">InnerCircle</span>
              <h2 className="lc-ss__title">Privacy is the<br />new premium</h2>
              <p className="lc-ss__sub">Own your audience. Keep your identity. Earn on your terms.</p>
            </div>
            <div className="lc-cta__btns">
              <Link href="/wallet" className="lc-vh__btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/>
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none"/>
                </svg>
                Get Started
              </Link>
              <Link href="/discover" className="lc-vh__btn-secondary">Browse Creators</Link>
            </div>
          </div>
        </div>
      </section>


    </main>
  );
}
