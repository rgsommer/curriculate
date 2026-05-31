// /teebee-loans — TeeBee Loans landing. Loan-readiness & financing-package prep
// overview with a CTA into the internal workspace (/teebee-loans/app, PIN-gated).
"use client";
import React from "react";
import Link from "next/link";
import {
  ArrowRight, ShieldCheck, Gauge, Sparkles, Building2, Mail, Phone,
  TrendingUp, ClipboardCheck, Landmark,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  red: "#b9302a",
};

export default function TeebeeLoansLanding() {
  return (
    <main style={{
      background: C.paper, color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      minHeight: "100vh",
    }}>
      <TopBar />
      <Hero />
      <ValueBand />
      <HowItWorks />
      <Lenders />
      <Trust />
      <Footer />
      <SeoStructuredData />
    </main>
  );
}

function TopBar() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.96)",
      backdropFilter: "blur(8px)", borderBottom: "1px solid #e5e7eb",
      padding: "12px 28px", display: "flex", alignItems: "center", gap: 24,
    }}>
      <Link href="/teebee-loans" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, letterSpacing: -0.5,
        }}>TBA</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>TeeBee Loans</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1, marginTop: 3 }}>TeeBee Accountants Ltd</div>
        </div>
      </Link>
      <nav style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 14, color: C.inkSoft, alignItems: "center" }}>
        <a href="#how" style={navLink}>How it works</a>
        <Link href="/teebee-loans/app" style={{ ...navLink, background: C.navy, color: "#fff", padding: "8px 16px", borderRadius: 8, fontWeight: 600 }}>
          Open workspace
        </Link>
      </nav>
    </header>
  );
}
const navLink: React.CSSProperties = { color: "inherit", textDecoration: "none" };

function Hero() {
  return (
    <section style={{ padding: "84px 28px 64px", background: `linear-gradient(180deg, ${C.cream} 0%, #fff 100%)` }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px",
          borderRadius: 999, background: C.goldSoft, color: C.navy, fontSize: 12, fontWeight: 600,
          letterSpacing: 0.04, marginBottom: 18,
        }}>
          <Sparkles size={14} /> For PNG SMEs · scored against real lender benchmarks
        </div>
        <h1 style={{
          margin: "0 0 18px", fontSize: 56, fontWeight: 800, lineHeight: 1.05,
          letterSpacing: -1.5, maxWidth: 880, marginInline: "auto",
        }}>
          Walk into the bank{" "}
          <span style={{ color: C.gold }}>loan-ready</span>.
        </h1>
        <p style={{ margin: "0 auto 30px", fontSize: 18, lineHeight: 1.55, color: C.inkSoft, maxWidth: 720 }}>
          We score your financials the way a lender will — liquidity, leverage,
          debt-service cover, loan-to-value — show you exactly where the gaps are,
          and assemble a complete financing package before you ever submit to BSP,
          Kina or Westpac.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/teebee-loans/app" style={primaryBtn}>
            <Gauge size={16} /> Open the loan workspace
          </Link>
          <a href="#how" style={secondaryBtn}>
            See how it works <ArrowRight size={16} />
          </a>
        </div>
        <div style={{ marginTop: 28, fontSize: 12, color: C.muted }}>
          Registered with the PNG Accountants Registration Board · 10+ years serving PNG SMEs
        </div>
      </div>
    </section>
  );
}
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "13px 22px", borderRadius: 10,
  background: C.navy, color: "#fff", fontWeight: 700, fontSize: 15,
  textDecoration: "none", border: "none", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "13px 22px", borderRadius: 10,
  background: "#fff", color: C.ink, fontWeight: 600, fontSize: 15,
  textDecoration: "none", border: `1px solid ${C.inkSoft}33`, cursor: "pointer",
};

function ValueBand() {
  const items = [
    { icon: <Gauge size={22} />, t: "Readiness score 0–100", d: "A weighted score across current and quick ratio, debt-to-equity, net margin, return on assets, DSCR and loan-to-value — each banded strong / adequate / weak against lender norms." },
    { icon: <TrendingUp size={22} />, t: "Debt-service cover", d: "We amortise the proposed facility, add existing commitments, and test EBITDA cover — the single ratio that most often sinks an application." },
    { icon: <ClipboardCheck size={22} />, t: "Financing package", d: "A documented checklist — financials, tax clearance, cash-flow forecast, security, business plan — tracked to 100% before anything goes to the lender." },
    { icon: <ShieldCheck size={22} />, t: "Gaps closed first", d: "Every weak metric comes with the reason and the fix, so the application that lands on the credit officer's desk is one they can say yes to." },
  ];
  return (
    <section style={{ padding: "72px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>Why TeeBee Loans</SectionEyebrow>
        <h2 style={h2}>See your application the way the bank will.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, marginTop: 36 }}>
          {items.map((it, i) => (
            <div key={i} style={{ padding: 22, background: C.cream, borderRadius: 12, border: "1px solid #fde68a" }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, background: "#fff",
                color: C.navy, display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12, border: `1px solid ${C.goldSoft}`,
              }}>{it.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{it.t}</h3>
              <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{it.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Client intake", d: "Capture the business, the amount sought, the purpose and the facility terms. The application opens in the intake stage." },
    { n: "02", t: "Score the financials", d: "Enter the balance sheet and P&L figures. The engine scores readiness 0–100 against lender benchmarks and flags every weak ratio with its cause." },
    { n: "03", t: "Assess & close gaps", d: "Mark the application assessed, then work the gap list — restructure, recapitalise, or document — until the score supports the ask." },
    { n: "04", t: "Build the package", d: "Tick off the financing-package checklist. The application can't be marked package-ready until every required document is in." },
    { n: "05", t: "Submit to the lender", d: "With the package complete, submit to the chosen lender. The pipeline stage and submission date are recorded." },
  ];
  return (
    <section id="how" style={{ padding: "80px 28px", background: C.cream }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>How it works</SectionEyebrow>
        <h2 style={h2}>From intake to submitted, nothing missed.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 36 }}>
          {steps.map((s) => (
            <div key={s.n} style={{ padding: 22, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: 0.08 }}>{s.n}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "6px 0 8px" }}>{s.t}</h3>
              <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{s.d}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link href="/teebee-loans/app" style={primaryBtn}>
            Open the loan workspace <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Lenders() {
  return (
    <section style={{ padding: "64px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>Built for PNG lenders</SectionEyebrow>
        <h2 style={{ ...h2, marginBottom: 18 }}>Benchmarked to who you'll actually borrow from.</h2>
        <div style={{ display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap", color: C.navy, fontWeight: 700, fontSize: 17 }}>
          {["BSP", "Kina Bank", "Westpac PNG", "ANZ PNG", "Microfinance / NDB"].map((l) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Landmark size={16} style={{ color: C.gold }} /> {l}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section style={{ padding: "60px 28px", background: C.cream }}>
      <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: 0.08, textTransform: "uppercase", marginBottom: 14 }}>
          TeeBee Accountants Ltd · CPA · 10+ years · 500+ clients
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 36, flexWrap: "wrap", fontSize: 14, color: C.inkSoft }}>
          <span><Building2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Port Moresby, NCD, PNG</span>
          <span><Mail size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> info@teebeeaccountants.com.pg</span>
          <span><Phone size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> +675 300 0000</span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{
      padding: "26px 28px", borderTop: "1px solid #e5e7eb", background: C.navy, color: "#cbd5e1",
      fontSize: 13, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 14,
    }}>
      <div>
        TeeBee Accountants Ltd · Registered with the PNG Accountants Registration Board · IRC-registered Tax Agent
      </div>
      <div>
        <Link href="/teebee" style={{ color: C.gold, textDecoration: "none" }}>Main site</Link>
        {"  ·  "}
        <Link href="/teebeepay" style={{ color: C.gold, textDecoration: "none" }}>TeebeePay</Link>
        {"  ·  "}
        <Link href="/teebee-loans/app" style={{ color: "#94a3b8", textDecoration: "none" }}>Loan workspace</Link>
      </div>
    </footer>
  );
}

/* ─────── reusables ─────── */
const h2: React.CSSProperties = {
  fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.8,
  margin: "12px 0 8px", color: C.ink,
};
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: 0.08, textTransform: "uppercase" }}>{children}</div>;
}

/* ─────── structured data ─────── */
function SeoStructuredData() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "TeeBee Loans — TeeBee Accountants Ltd",
    description:
      "Loan-readiness scoring and financing-package preparation for PNG SMEs. Score financials against lender benchmarks (liquidity, leverage, DSCR, loan-to-value), close the gaps, and assemble a complete package for BSP, Kina, Westpac and microfinance lenders.",
    address: { "@type": "PostalAddress", addressLocality: "Port Moresby", addressRegion: "NCD", addressCountry: "PG" },
    areaServed: "PG",
    url: "https://www.curriculate.net/teebee-loans",
    provider: { "@type": "Organization", name: "TeeBee Accountants Ltd" },
    serviceType: ["Loan readiness", "Financing package preparation", "SME finance advisory"],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />;
}
