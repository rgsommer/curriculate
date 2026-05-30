// frontend/src/app/teebee/page.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import {
  ArrowRight,
  CheckCircle2,
  Shield,
  Award,
  Users,
  Building2,
  Calculator,
  ClipboardCheck,
  Briefcase,
  TrendingUp,
  FileText,
  Receipt,
  Phone,
  Mail,
  MapPin,
  Clock,
  Loader2,
  BookOpen,
  Landmark,
} from "lucide-react";

/* ─────────── Brand palette (navy + gold, professional services) ────── */
const C = {
  ink: "#0a1a2e",
  inkSoft: "#475569",
  muted: "#64748b",
  navy: "#0f2c52",
  navyDeep: "#081d3a",
  gold: "#c9a227",
  goldSoft: "#fef6dc",
  cream: "#fbfaf6",
  paper: "#ffffff",
};

const SERVICES = [
  { num: "01", icon: <ClipboardCheck size={22} />, title: "Audit & Assurance",
    text: "Independent IFRS-compliant audits via Tee Bee Audit — our new AI-assisted platform. Upload your files, software runs reconciliations and anomaly checks, a CPA reviews and signs the opinion. Faster, cheaper, audit-trail complete.",
    href: "/audit", hrefLabel: "Explore Tee Bee Audit", badge: "Platform live" },
  { num: "02", icon: <Calculator size={22} />, title: "Taxation Services",
    text: "Strategic tax planning, return preparation and lodgement, and IRC compliance — keeping your tax position optimised and fully aligned with IRC requirements. A dedicated taxation platform is in development.",
    badge: "Platform coming soon" },
  { num: "03", icon: <FileText size={22} />, title: "Accounting Services",
    text: "Cloud bookkeeping, a full double-entry General Ledger, financial reporting and management accounting — plus fortnightly payroll. Run your books and your pay run in one place with TeebeePay.",
    href: "/teebeepay", hrefLabel: "Explore TeebeePay", badge: "Platform live" },
  { num: "04", icon: <BookOpen size={22} />, title: "General Ledger & Reporting",
    text: "A real double-entry ledger behind your books: chart of accounts, journal entries, trial balance, income statement and balance sheet — always reconciled to your payroll. Built into TeebeePay.",
    href: "/teebeepay", hrefLabel: "Explore TeebeePay", badge: "Platform live" },
  { num: "05", icon: <TrendingUp size={22} />, title: "Business Advisory",
    text: "Strategic guidance on growth, financial planning, risk management, and operational efficiency improvements." },
  { num: "06", icon: <Landmark size={22} />, title: "Loan Preparation",
    text: "Lender-ready financial packs assembled straight from your books — statements, projections and supporting schedules — so your bank or development-finance application lands complete.",
    badge: "Platform coming soon" },
  { num: "07", icon: <Receipt size={22} />, title: "Statutory Compliance",
    text: "Company secretarial services, IPA annual returns, and full regulatory compliance support to keep your business in good standing." },
  { num: "08", icon: <Briefcase size={22} />, title: "Financial Consulting",
    text: "Expert financial analysis, feasibility studies, and due-diligence services for informed decision-making and investment readiness." },
];

const TESTIMONIALS = [
  { initials: "JM", quote: "TBA has been instrumental in streamlining our financial operations. Their expertise in PNG taxation has saved us significant costs while ensuring full compliance.",
    name: "John Maino", role: "Managing Director, Trade PNG Ltd" },
  { initials: "SK", quote: "Professional, reliable, and always available when we need them. The team at Tee Bee Accountants truly understands the needs of businesses operating in PNG.",
    name: "Sarah Kuri", role: "CFO, Pacific Resources" },
  { initials: "PT", quote: "Their audit services are thorough and their advisory insights have helped us make better business decisions. Highly recommended for any company in PNG.",
    name: "Peter Temu", role: "Owner, Highlands Construction" },
];

export default function TeeBeeAccountantsLanding() {
  return (
    <div style={{ background: C.paper, color: C.ink, fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif" }}>
      <SeoLd />
      <TopBar />
      <Hero />
      <Stats />
      <WhyChoose />
      <Services />
      <AuditPlug />
      <PayrollPlug />
      <Testimonials />
      <Contact />
      <Footer />
    </div>
  );
}

/* ────────── SEO structured data ────── */
function SeoLd() {
  const org = {
    "@context": "https://schema.org",
    "@type": "AccountingService",
    name: "Tee Bee Accountants Ltd",
    alternateName: "TBA",
    url: "https://www.curriculate.net/teebee",
    sameAs: ["https://www.teebeeaccountants.com.pg"],
    description:
      "CPA-certified accounting and audit firm in Papua New Guinea. Audit & assurance, taxation, accounting, business advisory, statutory compliance, financial consulting.",
    areaServed: "PG",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Port Moresby",
      addressRegion: "National Capital District",
      addressCountry: "PG",
    },
    telephone: "+675-300-0000",
    email: "info@teebeeaccountants.com.pg",
    openingHours: "Mo-Fr 08:00-17:00",
    priceRange: "$$",
    knowsAbout: ["Audit", "AI-assisted audit", "Audit readiness", "IFRS compliance", "Taxation", "Accounting",
                  "Business Advisory", "Statutory Compliance", "Payroll", "IRC SWT", "NASFund"],
  };
  const breadcrumb = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.curriculate.net" },
      { "@type": "ListItem", position: 2, name: "Tee Bee Accountants", item: "https://www.curriculate.net/teebee" },
    ],
  };
  const services = {
    "@context": "https://schema.org", "@type": "ItemList",
    itemListElement: SERVICES.map((s, i) => ({
      "@type": "ListItem", position: i + 1,
      item: { "@type": "Service", name: s.title, description: s.text, provider: { "@type": "AccountingService", name: "Tee Bee Accountants Ltd" } },
    })),
  };
  return (
    <>
      <Script id="tba-ld-org"        type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
      <Script id="tba-ld-services"   type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(services) }} />
      <Script id="tba-ld-breadcrumb" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
    </>
  );
}

/* ────────── Top bar ────── */
function TopBar() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(255,255,255,0.95)", backdropFilter: "blur(10px)",
      borderBottom: `1px solid #eaeaea`,
    }}>
      <nav style={{
        maxWidth: 1180, margin: "0 auto", padding: "16px 24px",
        display: "flex", alignItems: "center", gap: 28,
      }}>
        <a href="#home" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: C.ink }}>
          <TbaLogo />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.1 }}>Tee Bee Accountants</div>
            <div style={{ fontSize: 11, color: C.gold, fontWeight: 600, letterSpacing: 0.04, textTransform: "uppercase" }}>Professional services</div>
          </div>
        </a>
        <div style={{ display: "flex", gap: 24, marginLeft: "auto", alignItems: "center" }}>
          <a href="#services" style={navLink}>Services</a>
          <a href="#about" style={navLink}>About</a>
          <a href="#testimonials" style={navLink}>Testimonials</a>
          <Link href="/audit" style={navLink}>Audit</Link>
          <Link href="/teebeepay" style={navLink}>TeebeePay</Link>
          <a href="#contact" style={navCta}>Get consultation</a>
        </div>
      </nav>
    </header>
  );
}
const navLink: React.CSSProperties = { fontSize: 14, color: C.inkSoft, textDecoration: "none", fontWeight: 500 };
const navCta: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, padding: "9px 16px", borderRadius: 8,
  background: C.navy, color: "#fff", textDecoration: "none",
  display: "inline-flex", alignItems: "center", gap: 6,
};

function TbaLogo() {
  return (
    <svg width="42" height="42" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="23" fill={C.navy} />
      <text x="24" y="30" textAnchor="middle" fontFamily="Georgia, serif"
        fontSize="20" fontWeight="700" fill={C.gold}>TBA</text>
    </svg>
  );
}

/* ────────── Hero ────── */
function Hero() {
  return (
    <section id="home" style={{
      background: `linear-gradient(180deg, ${C.cream} 0%, #fff 100%)`,
      padding: "84px 24px 64px",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid",
        gridTemplateColumns: "1.1fr 0.9fr", gap: 56, alignItems: "center" }} className="tba-hero-grid">
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700,
            background: C.goldSoft, color: C.navy, padding: "7px 14px", borderRadius: 999, marginBottom: 22 }}>
            <Shield size={14} /> CPA Certified · Registered Tax Agents
          </div>
          <h1 style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.08, margin: 0, color: C.ink, fontFamily: "Georgia, serif" }}>
            Professional <span style={{ color: C.navy }}>accounting</span> &amp; <span style={{ color: C.navy }}>audit</span> services.
          </h1>
          <p style={{ fontSize: 19, color: C.inkSoft, lineHeight: 1.55, margin: "22px 0 32px", maxWidth: 560 }}>
            CPA-certified professionals delivering the highest standards in accounting, audit, and business
            advisory across Papua New Guinea. Trusted by over 500 clients for more than a decade.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <a href="#contact" style={btnPrimary}>Get consultation <ArrowRight size={17} style={{ marginLeft: 6 }} /></a>
            <a href="#services" style={btnSecondary}>Our services</a>
            <a href="/api/teebee/brief" target="_blank" rel="noopener" style={{
              ...btnSecondary, color: C.navy, borderColor: C.navy,
              display: "inline-flex", alignItems: "center", gap: 8,
            }}>
              <FileText size={16} /> 2-page brief (PDF)
            </a>
          </div>
        </div>
        <HeroVisual />
      </div>
      <style>{`@media (max-width: 900px) { .tba-hero-grid { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}
const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "14px 24px",
  borderRadius: 10, background: C.navy, color: "#fff",
  fontSize: 15, fontWeight: 600, textDecoration: "none",
  boxShadow: "0 8px 22px rgba(15,44,82,.22)",
};
const btnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "14px 24px",
  borderRadius: 10, background: "#fff", color: C.ink,
  fontSize: 15, fontWeight: 600, textDecoration: "none",
  border: "1px solid #e5e7eb",
};

function HeroVisual() {
  return (
    <div style={{ position: "relative" }}>
      <div style={{
        background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
        borderRadius: 18, padding: 36, color: "#fff",
        boxShadow: "0 24px 60px rgba(15,44,82,.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <Award size={22} color={C.gold} />
          <span style={{ fontSize: 13, letterSpacing: 0.06, textTransform: "uppercase", fontWeight: 700, color: C.gold }}>
            Excellence since 2015
          </span>
        </div>
        <div style={{ fontSize: 60, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1, color: C.gold }}>10+</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6 }}>Years of trusted service</div>
        <div style={{ height: 1, background: "rgba(255,255,255,.15)", margin: "26px 0 22px" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Georgia, serif", color: "#fff" }}>500+</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)" }}>Satisfied clients</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Georgia, serif", color: "#fff" }}>1000+</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)" }}>Engagements delivered</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Georgia, serif", color: "#fff" }}>100%</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)" }}>IFRS-compliant</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Georgia, serif", color: "#fff" }}>24/7</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)" }}>Client support</div>
          </div>
        </div>
      </div>
      <div style={{
        position: "absolute", bottom: -16, right: -10, padding: "10px 16px",
        background: C.gold, color: C.navy, borderRadius: 999, fontSize: 12, fontWeight: 700,
        boxShadow: "0 10px 30px rgba(201,162,39,.4)",
      }}>
        Registered with PNG ARB
      </div>
    </div>
  );
}

/* ────────── Stats strip ────── */
function Stats() {
  const stats = [
    { v: "CPA", l: "Certified" },
    { v: "500+", l: "Clients served" },
    { v: "100%", l: "Commitment" },
    { v: "24/7", l: "Support" },
  ];
  return (
    <section style={{ background: C.navy, color: "#fff", padding: "40px 24px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 28, textAlign: "center" }}>
        {stats.map((s, i) => (
          <div key={i}>
            <div style={{ fontSize: 32, fontWeight: 700, color: C.gold, fontFamily: "Georgia, serif", letterSpacing: -0.5 }}>{s.v}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", textTransform: "uppercase", letterSpacing: 0.08, fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────── Why choose us ────── */
function WhyChoose() {
  const items = [
    { icon: <Award size={22} />,    t: "CPA Certified",         d: "Fully certified CPAs registered with the PNG Accountants Registration Board." },
    { icon: <Shield size={22} />,   t: "Highest Standards",     d: "International Financial Reporting Standards (IFRS) with rigorous quality control." },
    { icon: <Users size={22} />,    t: "Client-Focused",        d: "Lasting relationships through understanding each client's unique needs and goals." },
    { icon: <CheckCircle2 size={22} />, t: "Integrity & Trust", d: "Unwavering ethical standards and complete transparency in every interaction." },
    { icon: <MapPin size={22} />,   t: "Local Expertise",       d: "Deep understanding of PNG's regulatory environment, tax laws, and business landscape." },
    { icon: <Phone size={22} />,    t: "Dedicated Support",     d: "Responsive service with direct access to your dedicated team members." },
  ];
  return (
    <section id="about" style={{ padding: "80px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <Eyebrow>Why choose TBA</Eyebrow>
          <h2 style={h2}>Delivering excellence in every detail.</h2>
          <p style={{ ...lead, margin: "0 auto", textAlign: "center" }}>
            We combine expertise with dedication to provide the highest quality accounting services in Papua New Guinea.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 22 }}>
          {items.map((it, i) => (
            <div key={i} style={{ background: C.cream, border: "1px solid #eee", borderRadius: 14, padding: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: C.goldSoft, color: C.navy,
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                {it.icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>{it.t}</h3>
              <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{it.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────── Services ────── */
function Services() {
  return (
    <section id="services" style={{ padding: "80px 24px", background: C.cream }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <Eyebrow>Our services</Eyebrow>
          <h2 style={h2}>Comprehensive financial solutions.</h2>
          <p style={{ ...lead, margin: "0 auto", textAlign: "center" }}>
            From audit and assurance to tax planning and business advisory — a full suite of professional services.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 22 }}>
          {SERVICES.map((s, i) => {
            const live = s.badge === "Platform live";
            return (
            <div key={i} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: 28, position: "relative", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "absolute", top: 20, right: 24, fontSize: 24, fontWeight: 700,
                color: C.goldSoft, fontFamily: "Georgia, serif" }}>{s.num}</div>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: C.navy, color: C.gold,
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                {s.icon}
              </div>
              <h3 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 10px" }}>{s.title}</h3>
              <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.6, margin: 0, flex: 1 }}>{s.text}</p>
              {s.badge && (
                <span style={{ marginTop: 14, alignSelf: "flex-start", fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: 0.05, padding: "4px 10px", borderRadius: 999,
                  color: live ? "#166534" : C.muted, background: live ? "#dcfce7" : "#eef0f3" }}>
                  {s.badge}
                </span>
              )}
              {s.href && (
                <Link href={s.href} style={{ marginTop: 14, display: "inline-flex", alignItems: "center",
                  gap: 6, fontSize: 14, fontWeight: 700, color: C.navy, textDecoration: "none" }}>
                  {s.hrefLabel} <ArrowRight size={15} />
                </Link>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ────────── Tee Bee Audit plug ────── */
function AuditPlug() {
  return (
    <section style={{ padding: "60px 24px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto",
        background: `linear-gradient(135deg, ${C.cream} 0%, ${C.goldSoft} 100%)`,
        borderRadius: 20, padding: "48px 40px", color: C.ink,
        display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 36, alignItems: "center",
        border: `1px solid ${C.gold}`,
      }} className="tba-hero-grid">
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12,
            fontWeight: 700, color: C.navy, background: "rgba(15,44,82,.08)", padding: "6px 12px",
            borderRadius: 999, marginBottom: 18, letterSpacing: 0.05, textTransform: "uppercase" }}>
            <ClipboardCheck size={13} /> New · AI-assisted audit
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.6, margin: 0, fontFamily: "Georgia, serif", color: C.ink }}>
            Tee Bee Audit — faster audits, signed by your CPA.
          </h2>
          <p style={{ fontSize: 16, color: C.inkSoft, lineHeight: 1.6, margin: "14px 0 22px", maxWidth: 540 }}>
            Upload your trial balance, GL and supporting files. Our software runs reconciliations,
            anomaly checks and compliance scans. A registered CPA reviews every finding before
            the opinion goes out. Statutory audits, audit-readiness reviews, IRC compliance — all in one place.
          </p>
          <Link href="/audit" style={{
            display: "inline-flex", alignItems: "center", padding: "12px 22px",
            background: C.navy, color: "#fff", borderRadius: 10, fontWeight: 700,
            textDecoration: "none", fontSize: 15,
          }}>
            Explore Tee Bee Audit <ArrowRight size={16} style={{ marginLeft: 8 }} />
          </Link>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {[
            "Statutory audits · IFRS / IFRS-SME compliant",
            "Audit-readiness reviews before next year's audit",
            "Tax / IRC due diligence audits",
            "Landowner-company and donor-fund audits",
            "AI-assisted analysis · CPA-signed opinion",
            "Indicative pricing in 2 business days",
          ].map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: C.inkSoft }}>
              <CheckCircle2 size={18} color={C.navy} style={{ flexShrink: 0 }} />
              {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────── TeebeePay plug ────── */
function PayrollPlug() {
  return (
    <section style={{ padding: "60px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto",
        background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
        borderRadius: 20, padding: "48px 40px", color: "#fff",
        display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 36, alignItems: "center"
      }} className="tba-hero-grid">
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12,
            fontWeight: 700, color: C.gold, background: "rgba(201,162,39,.15)", padding: "6px 12px",
            borderRadius: 999, marginBottom: 18, letterSpacing: 0.05, textTransform: "uppercase" }}>
            <Building2 size={13} /> Now available
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.6, margin: 0, fontFamily: "Georgia, serif", color: "#fff" }}>
            Fortnightly payroll — done for you.
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.85)", lineHeight: 1.6, margin: "14px 0 22px", maxWidth: 540 }}>
            TBA's new web-based payroll service runs your fortnight end-to-end:
            pay stubs, BSP batch, NASFund returns, and IRC summary — all delivered to the right inboxes.
          </p>
          <Link href="/teebeepay" style={{
            display: "inline-flex", alignItems: "center", padding: "12px 22px",
            background: C.gold, color: C.navy, borderRadius: 10, fontWeight: 700,
            textDecoration: "none", fontSize: 15,
          }}>
            Discover TeebeePay <ArrowRight size={16} style={{ marginLeft: 8 }} />
          </Link>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {[
            "Pay stubs to every employee by email",
            "BSP batch upload file ready in seconds",
            "NASFund / NCSL returns auto-generated",
            "IRC SWT compliance baked in",
          ].map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: "rgba(255,255,255,.92)" }}>
              <CheckCircle2 size={18} color={C.gold} style={{ flexShrink: 0 }} />
              {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────── Testimonials ────── */
function Testimonials() {
  return (
    <section id="testimonials" style={{ padding: "80px 24px", background: C.cream }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <Eyebrow>Testimonials</Eyebrow>
          <h2 style={h2}>What our clients say.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22 }}>
          {TESTIMONIALS.map((t, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: 28 }}>
              <p style={{ fontSize: 15, color: C.inkSoft, lineHeight: 1.6, fontStyle: "italic", margin: "0 0 22px" }}>
                "{t.quote}"
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                <div style={{ width: 42, height: 42, borderRadius: 999, background: C.navy, color: C.gold,
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                  {t.initials}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────── Contact ────── */
function Contact() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", service: "", message: "", hp: "" });
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSubmitting(true);
    try {
      const res = await fetch("/api/teebee/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Submission failed");
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please email info@teebeeaccountants.com.pg.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="contact" style={{ padding: "80px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid",
        gridTemplateColumns: "1fr 1.2fr", gap: 48, alignItems: "start" }} className="tba-hero-grid">
        <div>
          <Eyebrow>Get in touch</Eyebrow>
          <h2 style={{ ...h2, fontSize: 36 }}>Ready to take your business finances to the next level?</h2>
          <p style={{ ...lead, marginBottom: 28 }}>
            Contact us today for a consultation. We'll respond within one business day.
          </p>

          <div style={{ display: "grid", gap: 20, marginTop: 24 }}>
            <ContactItem icon={<MapPin size={18} />} label="Office address">
              Port Moresby, National Capital District<br />Papua New Guinea
            </ContactItem>
            <ContactItem icon={<Phone size={18} />} label="Phone">
              <a href="tel:+6753000000" style={{ color: C.ink, textDecoration: "none" }}>+675 300 0000</a>
            </ContactItem>
            <ContactItem icon={<Mail size={18} />} label="Email">
              <a href="mailto:info@teebeeaccountants.com.pg" style={{ color: C.ink, textDecoration: "none" }}>
                info@teebeeaccountants.com.pg
              </a>
            </ContactItem>
            <ContactItem icon={<Clock size={18} />} label="Working hours">
              Monday – Friday: 8:00 AM – 5:00 PM
            </ContactItem>
          </div>
        </div>

        <div style={{ background: C.cream, border: "1px solid #eee", borderRadius: 16, padding: 32 }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: "#dcfce7", color: "#166534",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={32} />
              </div>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Thank you!</h3>
              <p style={{ color: C.inkSoft, marginTop: 10 }}>
                Your message has been sent to <strong>info@teebeeaccountants.com.pg</strong>.
                We'll be in touch within one business day.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h3 style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 700 }}>Send us a message</h3>
              <input type="text" name="company-url" tabIndex={-1} autoComplete="off"
                value={f.hp} onChange={e => set("hp", e.target.value)}
                style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }} aria-hidden="true" />
              <Field label="Full name *"><input style={input} value={f.name} onChange={e => set("name", e.target.value)} required /></Field>
              <Field label="Email address *"><input style={input} type="email" value={f.email} onChange={e => set("email", e.target.value)} required /></Field>
              <Field label="Phone number"><input style={input} value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="+675 …" /></Field>
              <Field label="Service needed">
                <select style={input} value={f.service} onChange={e => set("service", e.target.value)}>
                  <option value="">Select a service</option>
                  <option>Audit &amp; Assurance</option>
                  <option>Taxation Services</option>
                  <option>Accounting Services</option>
                  <option>Business Advisory</option>
                  <option>Statutory Compliance</option>
                  <option>Payroll (TeebeePay)</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Your message *">
                <textarea style={{ ...input, minHeight: 120, resize: "vertical" }} value={f.message} onChange={e => set("message", e.target.value)} required />
              </Field>
              {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}
              <button type="submit" disabled={submitting} style={{ ...btnPrimary, width: "100%", padding: "13px 22px", border: "none", cursor: "pointer" }}>
                {submitting
                  ? <><Loader2 size={16} className="tba-spin" style={{ marginRight: 8 }} /> Sending…</>
                  : <>Send message <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
              </button>
              <style>{`@keyframes tba-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tba-spin { animation: tba-spin .9s linear infinite; }`}</style>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
function ContactItem({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: C.goldSoft, color: C.navy,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 15, color: C.ink, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 14px", borderRadius: 8,
  border: "1px solid #d4d4d4", fontSize: 14, background: "#fff", color: C.ink, outline: "none",
};

/* ────────── Footer ────── */
function Footer() {
  return (
    <footer style={{ background: C.navyDeep, color: "rgba(255,255,255,.7)", padding: "48px 24px 30px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 36 }} className="tba-hero-grid">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <TbaLogo />
              <strong style={{ color: "#fff", fontSize: 17 }}>Tee Bee Accountants</strong>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, maxWidth: 360 }}>
              Your trusted partner for professional accounting, audit, and business advisory services in Papua New Guinea.
            </p>
          </div>
          <FooterCol heading="Services" items={["Audit & Assurance", "Taxation Services", "Accounting", "Business Advisory", "Compliance"]} />
          <FooterCol heading="Company"  items={["About Us", "Why Choose Us", "Testimonials", "Contact"]} />
          <FooterCol heading="Products" items={[<Link key="tp" href="/teebeepay" style={{ color: "rgba(255,255,255,.7)", textDecoration: "none" }}>TeebeePay (payroll)</Link>]} />
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", marginTop: 36, paddingTop: 20, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
          <span>© {new Date().getFullYear()} Tee Bee Accountants Ltd. All rights reserved.</span>
          <span>Registered with the PNG Accountants Registration Board</span>
        </div>
      </div>
    </footer>
  );
}
function FooterCol({ heading, items }: { heading: string; items: React.ReactNode[] }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.06 }}>{heading}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, fontSize: 13 }}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

/* ────────── Shared ────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-block", fontSize: 12, fontWeight: 700,
      color: C.gold, textTransform: "uppercase", letterSpacing: 0.12, marginBottom: 12 }}>
      {children}
    </div>
  );
}
const h2: React.CSSProperties = {
  fontSize: 42, fontWeight: 800, letterSpacing: -0.8,
  margin: "0 0 14px", color: C.ink, lineHeight: 1.1, fontFamily: "Georgia, serif",
};
const lead: React.CSSProperties = {
  fontSize: 18, color: C.inkSoft, lineHeight: 1.55, margin: "0 0 28px", maxWidth: 680,
};
