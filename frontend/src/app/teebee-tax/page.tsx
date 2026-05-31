// /teebee-tax — Tee Bee Tax landing. PNG tax-compliance service overview with a
// CTA into the internal workspace (/teebee-tax/app, PIN-gated for the firm).
"use client";
import React from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, ShieldCheck, FileText, Calculator,
  Sparkles, Building2, Mail, Phone, Landmark, Users, Receipt,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  red: "#b9302a",
};

export default function TeebeeTaxLanding() {
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
      <Link href="/teebee-tax" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, letterSpacing: -0.5,
        }}>TBA</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>Tee Bee Tax</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1, marginTop: 3 }}>Tee Bee Accountants Ltd</div>
        </div>
      </Link>
      <nav style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 14, color: C.inkSoft, alignItems: "center" }}>
        <a href="#how" style={navLink}>How it works</a>
        <Link href="/teebee-tax/app" style={{ ...navLink, background: C.navy, color: "#fff", padding: "8px 16px", borderRadius: 8, fontWeight: 600 }}>
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
          <Sparkles size={14} /> IRC-registered tax agent · CPA-reviewed
        </div>
        <h1 style={{
          margin: "0 0 18px", fontSize: 56, fontWeight: 800, lineHeight: 1.05,
          letterSpacing: -1.5, maxWidth: 880, marginInline: "auto",
        }}>
          PNG tax returns, computed and filed{" "}
          <span style={{ color: C.gold }}>without the guesswork</span>.
        </h1>
        <p style={{ margin: "0 auto 30px", fontSize: 18, lineHeight: 1.55, color: C.inkSoft, maxWidth: 720 }}>
          Company income tax, individual income tax and GST — computed against the
          current IRC rates and brackets, walked through a draft → prepared → reviewed
          → filed workflow, and signed off by a registered tax agent before lodgement.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/teebee-tax/app" style={primaryBtn}>
            <Calculator size={16} /> Open the tax workspace
          </Link>
          <a href="#how" style={secondaryBtn}>
            See how it works <ArrowRight size={16} />
          </a>
        </div>
        <div style={{ marginTop: 28, fontSize: 12, color: C.muted }}>
          Registered with the PNG Accountants Registration Board · IRC Tax Agent · 10+ years serving PNG SMEs
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
    { icon: <Building2 size={22} />, t: "Company income tax", d: "Accounting profit → tax adjustments (add-backs, deductions) → taxable income → tax at the 30% resident / 48% non-resident rate, less provisional and other credits." },
    { icon: <Users size={22} />, t: "Individual income tax", d: "Resident marginal scale applied band by band, with the average and marginal rate shown so the figure is always explainable to the client." },
    { icon: <Receipt size={22} />, t: "GST returns", d: "Output tax less input tax at 10%, net GST payable or refundable, ready for the IRC monthly return." },
    { icon: <ShieldCheck size={22} />, t: "Reviewed before filing", d: "The preparer can never self-review. A second registered agent reviews, then files with the IRC reference recorded against the return." },
  ];
  return (
    <section style={{ padding: "72px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>What it covers</SectionEyebrow>
        <h2 style={h2}>Every PNG tax your business actually files.</h2>
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
    { n: "01", t: "Create the return", d: "Pick the tax type — company, individual or GST — and the taxpayer, TIN and period. The return opens as a draft." },
    { n: "02", t: "Enter the figures", d: "Key the accounting profit and adjustments (or income, or sales/purchases). The engine computes taxable income and tax on the current IRC rates, live." },
    { n: "03", t: "Mark prepared", d: "When the computation is complete the preparer signs it off as prepared. Editing the figures after this reverts it for re-review — a filed return's numbers can never silently change." },
    { n: "04", t: "Independent review", d: "A second registered tax agent reviews. The person who prepared the return cannot review their own work." },
    { n: "05", t: "File with the IRC", d: "Once reviewed, the return is filed and the IRC lodgement reference is recorded against it for the audit trail." },
  ];
  return (
    <section id="how" style={{ padding: "80px 28px", background: C.cream }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>How it works</SectionEyebrow>
        <h2 style={h2}>A clean trail from draft to lodged.</h2>
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
          <Link href="/teebee-tax/app" style={primaryBtn}>
            Open the tax workspace <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section style={{ padding: "60px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: 0.08, textTransform: "uppercase", marginBottom: 14 }}>
          Tee Bee Accountants Ltd · CPA · IRC Tax Agent · 10+ years
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
        Tee Bee Accountants Ltd · Registered with the PNG Accountants Registration Board · IRC-registered Tax Agent
      </div>
      <div>
        <Link href="/teebee" style={{ color: C.gold, textDecoration: "none" }}>Main site</Link>
        {"  ·  "}
        <Link href="/teebeepay" style={{ color: C.gold, textDecoration: "none" }}>TeebeePay</Link>
        {"  ·  "}
        <Link href="/teebee-tax/app" style={{ color: "#94a3b8", textDecoration: "none" }}>Tax workspace</Link>
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
    name: "Tee Bee Tax — Tee Bee Accountants Ltd",
    description:
      "PNG tax compliance from Tee Bee Accountants. Company income tax, individual income tax and GST returns computed on current IRC rates, reviewed and filed by a registered tax agent.",
    address: { "@type": "PostalAddress", addressLocality: "Port Moresby", addressRegion: "NCD", addressCountry: "PG" },
    areaServed: "PG",
    url: "https://www.curriculate.net/teebee-tax",
    provider: { "@type": "Organization", name: "Tee Bee Accountants Ltd" },
    serviceType: ["Company income tax", "Individual income tax", "GST returns", "Tax compliance"],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />;
}
