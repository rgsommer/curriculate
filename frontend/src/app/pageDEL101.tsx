"use client";

import React, { useEffect, useMemo, useState } from "react";

export default function HomePage() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(!!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const stats = useMemo(
    () => [
      { label: "Stations", value: "6–12" },
      { label: "Tasks / set", value: "10–30" },
      { label: "Setup time", value: "< 3 min" },
    ],
    []
  );

  const features = useMemo(
    () => [
      {
        title: "AI-generated task sets",
        desc: "Instant stations-ready tasks tailored to grade, subject, difficulty, and your vocab bank.",
        icon: "✨",
      },
      {
        title: "Live teacher console",
        desc: "Launch, pause, regen, and guide teams with a clear, graphically rich control room.",
        icon: "🎛️",
      },
      {
        title: "Student gameplay flow",
        desc: "Fast, themed task cards that keep learners moving and engaged with minimal friction.",
        icon: "🏃‍♂️",
      },
      {
        title: "Reports that matter",
        desc: "Session summaries, transcripts, analytics, and student insights—built for real classrooms.",
        icon: "📊",
      },
      {
        title: "QR-coded stations",
        desc: "Simple station posters + scanning = clean transitions and less classroom chaos.",
        icon: "🔳",
      },
      {
        title: "Built to scale",
        desc: "Multiple apps, consistent UI, strong task type system, and a roadmap for more modules.",
        icon: "🚀",
      },
    ],
    []
  );

  return (
    <div className="page">
      {/* Top glow + background */}
      <div className="bg" aria-hidden="true">
        {!reducedMotion && (
          <>
            <div className="blob blobA" />
            <div className="blob blobB" />
            <div className="blob blobC" />
          </>
        )}
        <div className="noise" />
      </div>

      {/* Header */}
      <header className="header">
        <div className="wrap headerInner">
          <a className="brand" href="/">
            <span className="brandDot" aria-hidden="true" />
            <span className="brandText">Curriculate</span>
          </a>

          <nav className="nav">
            <a href="/features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>

          <div className="headerCtas">
            <a className="btn ghost" href="/demo">
              Try Demo
            </a>
            <a className="btn primary" href="/signup">
              Get Started
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="hero">
        <div className="wrap heroGrid">
          <section className="heroCopy">
            <div className="pill">
              <span className="pillDot" />
              <span>Station-based learning, upgraded</span>
            </div>

            <h1 className="h1">
              Turn your classroom into a{" "}
              <span className="accent">live, gamified station experience</span>.
            </h1>

            <p className="sub">
              Generate task sets in seconds, launch them to teams, and capture
              rich session data—all with a polished, consistent interface across
              student, teacher, and reporting flows.
            </p>

            <div className="ctaRow">
              <a className="btn primary big" href="/demo">
                Launch the Demo
              </a>
              <a className="btn ghost big" href="/features">
                See Features
              </a>
            </div>

            <div className="stats">
              {stats.map((s) => (
                <div key={s.label} className="statCard">
                  <div className="statValue">{s.value}</div>
                  <div className="statLabel">{s.label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="heroMedia" aria-label="Curriculate preview">
            <div className="videoFrame">
              <div className="videoTopBar" aria-hidden="true">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
                <span className="barTitle">play.curriculate.net</span>
              </div>

              <div className="videoInner">
                <video
                  className="video"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                >
                  <source src="/videos/hero.mp4" type="video/mp4" />
                </video>

                {/* subtle overlay to make text readable + unify theme */}
                <div className="videoOverlay" aria-hidden="true" />
              </div>

              {!reducedMotion && (
                <div className="scanLine" aria-hidden="true" />
              )}
            </div>

            <div className="miniRow">
              <MiniCard
                title="Teacher Console"
                desc="Launch + regen + live pacing"
                icon="🎚️"
              />
              <MiniCard
                title="Student App"
                desc="Fast, themed tasks + stations"
                icon="🧩"
              />
              <MiniCard
                title="Reports"
                desc="Transcripts + analytics"
                icon="🧾"
              />
            </div>
          </section>
        </div>

        {!reducedMotion && (
          <div className="scrollCue" aria-hidden="true">
            <div className="mouse">
              <div className="wheel" />
            </div>
            <div className="scrollText">Scroll</div>
          </div>
        )}
      </main>

      {/* Features */}
      <section className="section">
        <div className="wrap">
          <h2 className="h2">Built for real classrooms</h2>
          <p className="lead">
            Less downtime. More movement. Better feedback. Stronger reporting.
          </p>

          <div className="grid">
            {features.map((f) => (
              <article key={f.title} className="card">
                <div className="cardIcon" aria-hidden="true">
                  {f.icon}
                </div>
                <div className="cardTitle">{f.title}</div>
                <div className="cardDesc">{f.desc}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="wrap ctaInner">
          <div>
            <h3 className="h3">Ready to run a stations session this week?</h3>
            <p className="ctaSub">
              Start with the demo, then generate your first real task set in
              minutes.
            </p>
          </div>
          <div className="ctaButtons">
            <a className="btn primary big" href="/demo">
              Go to Demo
            </a>
            <a className="btn ghost big" href="/signup">
              Create Account
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footerInner">
          <div className="footerLeft">
            <div className="brand small">
              <span className="brandDot" aria-hidden="true" />
              <span className="brandText">Curriculate</span>
            </div>
            <div className="footerNote">
              © {new Date().getFullYear()} Curriculate. All rights reserved.
            </div>
          </div>

          <div className="footerLinks">
            <a href="/privacy">Privacy</a>
            <a href="/termsofservice">Terms</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
      </footer>

      <style jsx>{`
        .page {
          min-height: 100vh;
          color: #0b1020;
          position: relative;
          overflow-x: hidden;
        }

        .bg {
          position: fixed;
          inset: 0;
          z-index: -2;
          background: radial-gradient(
              1200px 600px at 15% 10%,
              rgba(80, 150, 255, 0.18),
              transparent 55%
            ),
            radial-gradient(
              900px 500px at 85% 20%,
              rgba(145, 90, 255, 0.14),
              transparent 60%
            ),
            radial-gradient(
              800px 520px at 50% 85%,
              rgba(20, 200, 170, 0.12),
              transparent 55%
            ),
            linear-gradient(#f7f9ff, #f7f9ff);
        }

        .noise {
          position: absolute;
          inset: 0;
          opacity: 0.05;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");
        }

        .blob {
          position: absolute;
          width: 520px;
          height: 520px;
          filter: blur(22px);
          border-radius: 999px;
          opacity: 0.55;
          mix-blend-mode: multiply;
          transform: translate3d(0, 0, 0);
          animation: float 12s ease-in-out infinite;
        }
        .blobA {
          left: -120px;
          top: -140px;
          background: radial-gradient(
            circle at 30% 30%,
            rgba(100, 170, 255, 0.9),
            rgba(100, 170, 255, 0)
          );
          animation-delay: 0s;
        }
        .blobB {
          right: -160px;
          top: -90px;
          background: radial-gradient(
            circle at 30% 30%,
            rgba(160, 110, 255, 0.85),
            rgba(160, 110, 255, 0)
          );
          animation-delay: 2s;
        }
        .blobC {
          left: 15%;
          bottom: -220px;
          background: radial-gradient(
            circle at 30% 30%,
            rgba(40, 210, 180, 0.8),
            rgba(40, 210, 180, 0)
          );
          animation-delay: 4s;
        }

        @keyframes float {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(18px, -12px, 0) scale(1.03);
          }
        }

        .wrap {
          width: min(1120px, calc(100% - 32px));
          margin: 0 auto;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 50;
          backdrop-filter: blur(10px);
          background: rgba(247, 249, 255, 0.72);
          border-bottom: 1px solid rgba(20, 35, 70, 0.08);
        }
        .headerInner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 0;
          gap: 12px;
        }

        .brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          color: inherit;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .brand.small {
          font-size: 14px;
        }
        .brandText {
          font-size: 16px;
        }
        .brandDot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(135deg, #2b66ff, #8a5bff, #19c7a4);
          box-shadow: 0 10px 24px rgba(43, 102, 255, 0.25);
        }

        .nav {
          display: none;
          gap: 18px;
          font-weight: 600;
          font-size: 14px;
        }
        .nav a {
          text-decoration: none;
          color: rgba(10, 16, 32, 0.76);
        }
        .nav a:hover {
          color: rgba(10, 16, 32, 0.95);
        }

        .headerCtas {
          display: flex;
          gap: 10px;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          font-weight: 800;
          font-size: 14px;
          border: 1px solid rgba(20, 35, 70, 0.14);
          background: rgba(255, 255, 255, 0.7);
          color: rgba(10, 16, 32, 0.9);
          box-shadow: 0 10px 26px rgba(15, 25, 50, 0.06);
          transition: transform 0.15s ease, box-shadow 0.15s ease,
            background 0.15s ease;
        }
        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 34px rgba(15, 25, 50, 0.1);
        }
        .btn.primary {
          border: 0;
          color: white;
          background: linear-gradient(135deg, #2b66ff, #8a5bff);
        }
        .btn.ghost {
          background: rgba(255, 255, 255, 0.5);
        }
        .btn.big {
          padding: 12px 18px;
          font-size: 15px;
        }

        .hero {
          position: relative;
          padding: 52px 0 46px;
        }

        .heroGrid {
          display: grid;
          gap: 22px;
          grid-template-columns: 1fr;
          align-items: start;
        }

        .heroCopy {
          padding-top: 6px;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(20, 35, 70, 0.12);
          font-weight: 800;
          font-size: 13px;
          color: rgba(10, 16, 32, 0.76);
          margin-bottom: 14px;
        }
        .pillDot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: linear-gradient(135deg, #2b66ff, #8a5bff, #19c7a4);
          box-shadow: 0 10px 24px rgba(43, 102, 255, 0.22);
        }

        .h1 {
          font-size: 40px;
          line-height: 1.05;
          letter-spacing: -0.04em;
          margin: 0 0 14px;
        }
        .accent {
          background: linear-gradient(135deg, #2b66ff, #8a5bff, #19c7a4);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        .sub {
          margin: 0 0 18px;
          font-size: 16px;
          line-height: 1.55;
          color: rgba(10, 16, 32, 0.72);
          max-width: 58ch;
        }

        .ctaRow {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin: 18px 0 18px;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 14px;
        }
        .statCard {
          border-radius: 16px;
          padding: 12px 12px;
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(20, 35, 70, 0.1);
        }
        .statValue {
          font-weight: 900;
          font-size: 16px;
          letter-spacing: -0.02em;
        }
        .statLabel {
          margin-top: 2px;
          font-weight: 700;
          font-size: 12px;
          color: rgba(10, 16, 32, 0.62);
        }

        .heroMedia {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .videoFrame {
          border-radius: 22px;
          overflow: hidden;
          border: 1px solid rgba(20, 35, 70, 0.12);
          background: rgba(255, 255, 255, 0.7);
          box-shadow: 0 24px 60px rgba(15, 25, 50, 0.14);
          position: relative;
        }

        .videoTopBar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(20, 35, 70, 0.1);
          background: rgba(247, 249, 255, 0.86);
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          opacity: 0.85;
        }
        .dot.red {
          background: #ff5f57;
        }
        .dot.yellow {
          background: #febc2e;
        }
        .dot.green {
          background: #28c840;
        }
        .barTitle {
          margin-left: 6px;
          font-weight: 800;
          font-size: 12px;
          color: rgba(10, 16, 32, 0.6);
        }

        .videoInner {
          position: relative;
          aspect-ratio: 16 / 9;
          background: #0b1020;
        }
        .video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .videoOverlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(
              800px 360px at 30% 10%,
              rgba(255, 255, 255, 0.08),
              transparent 60%
            ),
            linear-gradient(
              to bottom,
              rgba(0, 0, 0, 0.18),
              rgba(0, 0, 0, 0.22)
            );
          pointer-events: none;
        }

        .scanLine {
          position: absolute;
          left: 0;
          right: 0;
          top: 18%;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(43, 102, 255, 0.9),
            rgba(25, 199, 164, 0.8),
            transparent
          );
          opacity: 0.65;
          filter: blur(0.3px);
          animation: scan 2.6s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes scan {
          0% {
            transform: translateY(0);
            opacity: 0.35;
          }
          50% {
            transform: translateY(220%);
            opacity: 0.75;
          }
          100% {
            transform: translateY(0);
            opacity: 0.35;
          }
        }

        .miniRow {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }

        .scrollCue {
          position: absolute;
          left: 50%;
          bottom: 8px;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          opacity: 0.75;
          pointer-events: none;
        }
        .mouse {
          width: 22px;
          height: 34px;
          border-radius: 999px;
          border: 2px solid rgba(10, 16, 32, 0.38);
          position: relative;
        }
        .wheel {
          width: 4px;
          height: 8px;
          border-radius: 999px;
          background: rgba(10, 16, 32, 0.4);
          position: absolute;
          left: 50%;
          top: 8px;
          transform: translateX(-50%);
          animation: wheel 1.2s ease-in-out infinite;
        }
        @keyframes wheel {
          0% {
            transform: translateX(-50%) translateY(0);
            opacity: 0.55;
          }
          60% {
            transform: translateX(-50%) translateY(8px);
            opacity: 0.2;
          }
          100% {
            transform: translateX(-50%) translateY(0);
            opacity: 0.55;
          }
        }
        .scrollText {
          font-weight: 800;
          font-size: 12px;
          color: rgba(10, 16, 32, 0.62);
        }

        .section {
          padding: 34px 0 44px;
        }
        .h2 {
          font-size: 26px;
          letter-spacing: -0.03em;
          margin: 0 0 8px;
        }
        .lead {
          margin: 0 0 18px;
          color: rgba(10, 16, 32, 0.68);
          font-weight: 650;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-top: 14px;
        }

        .card {
          border-radius: 18px;
          padding: 16px 16px;
          background: rgba(255, 255, 255, 0.74);
          border: 1px solid rgba(20, 35, 70, 0.1);
          box-shadow: 0 18px 44px rgba(15, 25, 50, 0.08);
        }
        .cardIcon {
          font-size: 18px;
          margin-bottom: 10px;
        }
        .cardTitle {
          font-weight: 900;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }
        .cardDesc {
          color: rgba(10, 16, 32, 0.68);
          line-height: 1.5;
          font-weight: 600;
          font-size: 14px;
        }

        .cta {
          padding: 34px 0 40px;
        }
        .ctaInner {
          border-radius: 22px;
          padding: 18px 18px;
          background: linear-gradient(
            135deg,
            rgba(43, 102, 255, 0.12),
            rgba(138, 91, 255, 0.1),
            rgba(25, 199, 164, 0.1)
          );
          border: 1px solid rgba(20, 35, 70, 0.12);
          display: flex;
          flex-direction: column;
          gap: 14px;
          align-items: flex-start;
          justify-content: space-between;
        }
        .h3 {
          margin: 0;
          font-size: 20px;
          letter-spacing: -0.02em;
        }
        .ctaSub {
          margin: 6px 0 0;
          color: rgba(10, 16, 32, 0.68);
          font-weight: 650;
        }
        .ctaButtons {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .footer {
          padding: 22px 0 26px;
          border-top: 1px solid rgba(20, 35, 70, 0.08);
          background: rgba(247, 249, 255, 0.6);
        }
        .footerInner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .footerNote {
          margin-top: 6px;
          font-weight: 650;
          color: rgba(10, 16, 32, 0.56);
          font-size: 13px;
        }
        .footerLinks {
          display: flex;
          gap: 14px;
          font-weight: 750;
          font-size: 13px;
        }
        .footerLinks a {
          text-decoration: none;
          color: rgba(10, 16, 32, 0.68);
        }
        .footerLinks a:hover {
          color: rgba(10, 16, 32, 0.9);
        }

        @media (min-width: 860px) {
          .nav {
            display: flex;
          }
          .heroGrid {
            grid-template-columns: 1.05fr 0.95fr;
            gap: 26px;
            align-items: center;
          }
          .h1 {
            font-size: 52px;
          }
          .miniRow {
            grid-template-columns: repeat(3, 1fr);
          }
          .grid {
            grid-template-columns: repeat(3, 1fr);
          }
          .ctaInner {
            flex-direction: row;
            align-items: center;
            padding: 20px 22px;
          }
        }
      `}</style>
    </div>
  );
}

function MiniCard({
  title,
  desc,
  icon,
}: {
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <>
      <div className="mini">
        <div className="miniIcon" aria-hidden="true">
          {icon}
        </div>
        <div className="miniTitle">{title}</div>
        <div className="miniDesc">{desc}</div>
      </div>

      <style jsx>{`
        .mini {
          border-radius: 16px;
          padding: 12px 12px;
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(20, 35, 70, 0.1);
          box-shadow: 0 16px 38px rgba(15, 25, 50, 0.08);
        }
        .miniIcon {
          font-size: 16px;
          margin-bottom: 8px;
        }
        .miniTitle {
          font-weight: 900;
          letter-spacing: -0.02em;
          margin-bottom: 4px;
        }
        .miniDesc {
          color: rgba(10, 16, 32, 0.66);
          font-weight: 650;
          font-size: 13px;
          line-height: 1.4;
        }
      `}</style>
    </>
  );
}
