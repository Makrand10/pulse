'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main className="landing-page">
      <div className="landing-glow" />

      <section className="landing-card">
        <div className="landing-top">
          <div>
            <div className="landing-wordmark">PULSE</div>

            <div className="landing-tagline">
              <span className="landing-status-dot" />
              <span>know before your users do</span>
            </div>
          </div>

          <div className="landing-ecg" aria-hidden="true">
  <svg viewBox="0 0 400 120">
    <path
      className="ecg-line"
      pathLength="600"
      d="M0 60 H104
         L111 51 L118 72 L125 43 L132 84
         L139 27 L146 100 L153 10 L160 112
         L167 20 L174 92 L181 36 L188 76
         L195 48 L202 68 L209 54 L216 64
         L223 58 L230 60 H400"
    />
  </svg>

          </div>
        </div>

        <div className="landing-content">
          <p>
          Pulse monitors your APIs 24/7, detects failures and performance issues, and uses AI to identify likely root causes. When something goes wrong, Pulse creates an incident and keeps your status page up to date.
          </p>
        </div>

        <div className="landing-action">
          <Link href="/login" className="landing-button">
            <span>try it</span>
            <span className="landing-arrow">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}