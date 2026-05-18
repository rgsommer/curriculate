// frontend/src/app/teebeepay/page.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Banknote,
  ShieldCheck,
  FileSpreadsheet,
  Mail,
  Building2,
  Users,
  Receipt,
  UploadCloud,
  Bell,
  KeyRound,
  Sparkles,
  Loader2,
  Play,
  Quote,
  X as XIcon,
  NotebookPen,
  AlertTriangle,
  History,
  MailCheck,
  Archive,
  UserCircle2,
  Layers,
  Network,
  Smartphone,
  QrCode,
  ScanLine,
  Timer,
} from "lucide-react";

const COLORS = {
  ink: "#0f172a",
  inkSoft: "#334155",
  muted: "#64748b",
  paper: "#ffffff",
  cream: "#fffaf0",
  gold: "#f4b400",
  goldDeep: "#c08c00",
  red: "#b9302a",
  redDeep: "#8a1f1a",
};

/* ──────────── SEO: FAQ + features content available to schema ──────── */
const FAQS = [
  { q: "Where is my data stored?", a: "On a managed MongoDB cluster (Atlas) with daily backups. No data leaves the database except the file outputs you generate (BSP CSV, payslip PDFs)." },
  { q: "What banks do you support?", a: "Primary support is BSP Batch Manager (the 12-column CSV format). Kina, Westpac, ANZ — we generate a generic disbursement CSV that imports to most banks. Tell us the bank during onboarding." },
  { q: "Can my field manager work remotely?", a: "Yes — field managers (site key persons) log in from any browser. They can enter hours and notes, but can't approve a payroll run. That stays with your principal or bookkeeper." },
  { q: "What if PNG tax rates change?", a: "Tax brackets are editable in the app's Tax Rules tab — no code change required when the IRC publishes new tables. Updated brackets apply to new pay periods only; confirmed historical runs keep their original numbers." },
  { q: "Can I import from my old payroll?", a: "Yes. CSV import matched to common payroll-export formats (we also have a specific importer for the legacy MS Access PNGPay export). Historical pay periods can be re-attached so reports show the full history." },
  { q: "How much does TeebeePay cost?", a: "K9–K12 per employee per fortnight, depending on company size. Bureau pricing is custom. First fortnight is free so you can see actual output before committing." },
  { q: "Is TeebeePay only for Papua New Guinea?", a: "TeebeePay is built around PNG-specific requirements: SWT brackets, NASFund/NCSL filings, BSP batch format, IRC compliance. Companies operating in PNG benefit most." },
];

export default function TeebeePayLanding() {
  return (
    <div style={{ background: COLORS.paper, color: COLORS.ink, fontFamily: "system-ui, -apple-system, Segoe UI, Inter, Roboto, sans-serif" }}>
      <SeoStructuredData />
      <TopBar />
      <Hero />
      <TrustBar />
      <Advantages />
      <VideoWalkthrough />
      <ForOwners />
      <ForExistingClients />
      <HowItWorks />
      <Comparison />
      <FeatureGrid />
      <Roadmap />
      <Testimonials />
      <PricingTeaser />
      <InterestForm />
      <FaqSection />
      <CtaFooter />
      <SiteFooter />
      <StickyDemoButton />
    </div>
  );
}

/* ─────────── Video walkthrough section ─────────── */

function VideoWalkthrough() {
  // Override with NEXT_PUBLIC_TEEBEEPAY_DEMO_VIDEO_URL once a real walkthrough exists.
  const videoUrl = process.env.NEXT_PUBLIC_TEEBEEPAY_DEMO_VIDEO_URL || "";
  return (
    <section id="video" style={{ padding: "84px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>3-minute walkthrough</SectionEyebrow>
        <h2 style={{ ...h2, textAlign: "center", maxWidth: 720, margin: "0 auto 14px" }}>
          See a real fortnight in TeebeePay.
        </h2>
        <p style={{ ...lead, textAlign: "center", margin: "0 auto 36px", maxWidth: 640 }}>
          Hours in, approval, pay stubs out, BSP batch downloaded. End to end, no editing.
        </p>

        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9",
          borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(15,23,42,.12)",
          background: COLORS.ink, maxWidth: 880, margin: "0 auto" }}>
          {videoUrl ? (
            <iframe
              src={toEmbedUrl(videoUrl)}
              title="TeebeePay walkthrough"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          ) : (
            <VideoPlaceholder />
          )}
        </div>
      </div>
    </section>
  );
}

function toEmbedUrl(url: string): string {
  // Convert common YouTube formats to /embed/
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&?\/]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

function VideoPlaceholder() {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 18, color: "#fff",
      background: `linear-gradient(135deg, ${COLORS.red} 0%, ${COLORS.redDeep} 100%)`,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 999, background: "rgba(255,255,255,0.18)",
        backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Play size={36} color="#fff" fill="#fff" style={{ marginLeft: 4 }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: 420, padding: "0 24px" }}>
        <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Walkthrough coming soon</h3>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,.85)", margin: "8px 0 0", lineHeight: 1.5 }}>
          In the meantime, send us a CSV and we'll show you the exact output for your team's next fortnight.
        </p>
      </div>
    </div>
  );
}

/* ─────────── Testimonials carousel ─────────── */

const TESTIMONIAL_QUOTES = [
  { quote: "Switching to TeebeePay cut our fortnightly payroll from half a day to fifteen minutes. The BSP batch upload just works.",
    name: "Theresia Bob", role: "Principal, Tee Bee Accountants Ltd" },
  { quote: "NASFund returns used to be a monthly headache. Now it's a download and an upload — five minutes, no spreadsheet wrangling.",
    name: "Sarah K.",     role: "CFO, PNG SME (10+ staff)" },
  { quote: "Our field manager submits hours from a phone, the office approves from town, and pay stubs land in workers' inboxes the same day.",
    name: "John M.",      role: "Managing Director, services contractor" },
  { quote: "The audit trail saved us during our last IRC review. Every fortnight, every change — there in seconds.",
    name: "Pius P.",      role: "Senior Accountant, Highlands construction" },
];

function Testimonials() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % TESTIMONIAL_QUOTES.length), 7000);
    return () => clearInterval(t);
  }, []);
  const q = TESTIMONIAL_QUOTES[i];

  return (
    <section id="testimonials" style={{ padding: "84px 24px",
      background: `linear-gradient(180deg, ${COLORS.cream} 0%, #fff 100%)` }}>
      <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>What people say</SectionEyebrow>
        <h2 style={{ ...h2, textAlign: "center" }}>Built for the way PNG SMEs actually work.</h2>

        <div style={{
          background: "#fff", borderRadius: 18, padding: "44px 36px",
          boxShadow: "0 24px 60px rgba(15,23,42,.08)", border: "1px solid #f0f1f4",
          marginTop: 36, minHeight: 260, display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <Quote size={32} color={COLORS.gold} style={{ margin: "0 auto 14px" }} />
          <p style={{
            fontSize: 21, lineHeight: 1.55, color: COLORS.ink, fontStyle: "italic",
            margin: "0 0 24px", fontFamily: "Georgia, serif",
          }}>
            "{q.quote}"
          </p>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{q.name}</div>
            <div style={{ fontSize: 13, color: COLORS.muted }}>{q.role}</div>
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 24 }}>
            {TESTIMONIAL_QUOTES.map((_, idx) => (
              <button key={idx} onClick={() => setI(idx)} aria-label={`Show testimonial ${idx + 1}`}
                style={{
                  width: idx === i ? 24 : 8, height: 8, borderRadius: 999,
                  background: idx === i ? COLORS.red : "#e5e7eb",
                  border: "none", cursor: "pointer", padding: 0, transition: "all .2s ease",
                }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────── Sticky "Book a demo" button ─────────── */

function StickyDemoButton() {
  const [visible, setVisible] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 60,
      transition: "transform .25s ease, opacity .25s ease",
    }}>
      {expanded ? (
        <div style={{
          background: "#fff", borderRadius: 16, padding: 22,
          boxShadow: "0 30px 60px rgba(0,0,0,.22)", width: 320,
          border: `1px solid ${COLORS.cream}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <strong style={{ fontSize: 16, color: COLORS.ink }}>Book a demo</strong>
            <button onClick={() => setExpanded(false)} aria-label="Close" style={{
              background: "none", border: "none", color: COLORS.muted, cursor: "pointer", padding: 0,
            }}>
              <XIcon size={16} />
            </button>
          </div>
          <p style={{ fontSize: 13, color: COLORS.muted, margin: "0 0 14px", lineHeight: 1.5 }}>
            See TeebeePay run a real fortnight for your business. 20-minute call. First fortnight is free.
          </p>
          <Link href="#interest" onClick={() => setExpanded(false)} style={{
            display: "block", padding: "11px 14px", background: COLORS.red, color: "#fff",
            borderRadius: 9, textDecoration: "none", fontWeight: 600, fontSize: 14, textAlign: "center",
            marginBottom: 8,
          }}>
            Fill the interest form
          </Link>
          <a href="mailto:info@teebeeaccountants.com.pg?subject=TeebeePay%20demo%20request" style={{
            display: "block", padding: "11px 14px", background: "#fff",
            color: COLORS.ink, border: "1px solid #e5e7eb",
            borderRadius: 9, textDecoration: "none", fontWeight: 600, fontSize: 14, textAlign: "center",
          }}>
            Email us directly
          </a>
        </div>
      ) : (
        <button onClick={() => setExpanded(true)} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 22px", borderRadius: 999, border: "none", cursor: "pointer",
          background: COLORS.red, color: "#fff", fontWeight: 700, fontSize: 15,
          boxShadow: "0 16px 40px rgba(185,48,42,.42)",
        }}>
          <Sparkles size={17} /> Book a demo
        </button>
      )}
    </div>
  );
}

/* ─────────── Why TeebeePay — 12 advantages ────────────────────────── */

function Advantages() {
  const advantages = [
    { icon: <CheckCircle2 size={22} />, h: "Consistency",
      d: "Same process every fortnight. Same accurate numbers. No more guessing whose Excel formula got tweaked." },
    { icon: <Banknote size={22} />, h: "Cheaper",
      d: "From K9 per employee per fortnight — far less than a part-time bookkeeper, and faster than a full-service accountant." },
    { icon: <ShieldCheck size={22} />, h: "Professional",
      d: "Branded pay stubs, signed NASFund returns, audit-ready records. Your business looks the part." },
    { icon: <Clock3 size={22} />, h: "Timely",
      d: "Stubs out the same day you approve. NASFund and IRC filings never miss a deadline — auto-reminders 5 days before due." },
    { icon: <ShieldCheck size={22} />, h: "Reliable",
      d: "Cloud-hosted with daily backups. No more 'the office laptop crashed' or 'the spreadsheet got corrupted'." },
    { icon: <CheckCircle2 size={22} />, h: "Accurate",
      d: "PNG SWT brackets, Nasfund formulas, dependant rebates — coded in, tested, and updated when the IRC publishes new tables." },
    { icon: <ShieldCheck size={22} />, h: "Compliant",
      d: "K500–K5,000 IRC penalties for late SWT? Gone. NASFund non-compliance audits? Filed automatically. Sleep well." },
    { icon: <KeyRound size={22} />, h: "Confidential",
      d: "Each employee sees only their own pay. Admins see only what their clearance allows. Roles enforced at the database level." },
    { icon: <FileSpreadsheet size={22} />, h: "Auditable",
      d: "Every rate change, every approval, every email logged. Hand the auditor a single PDF — they'll be done in an hour." },
    { icon: <UploadCloud size={22} />, h: "Anywhere",
      d: "Field manager submits hours from a phone in the bush. Office approves from town. Employees check stubs at home." },
    { icon: <Users size={22} />, h: "Scalable",
      d: "Three employees today, sixty next year — same workflow, same fortnightly time commitment. Per-employee pricing scales with you." },
    { icon: <Mail size={22} />, h: "Employees love it",
      d: "Pay stubs by email in their inbox the same day they're paid. No more 'show me my pay slip' walk-ins to the office." },
  ];
  return (
    <section id="advantages" style={{ padding: "84px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <SectionEyebrow>Why TeebeePay</SectionEyebrow>
          <h2 style={{ ...h2, textAlign: "center", maxWidth: 800, margin: "0 auto 14px" }}>
            Twelve reasons your fortnightly payroll should be on TeebeePay.
          </h2>
          <p style={{ ...lead, textAlign: "center", margin: "0 auto", maxWidth: 680 }}>
            Each one a thing PNG business owners tell us made the switch worth it.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 20 }}>
          {advantages.map((a, i) => (
            <div key={i} style={{
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
              padding: 22, display: "flex", gap: 14, alignItems: "flex-start",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.red; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 10, background: "#fff7e0", color: COLORS.goldDeep,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {a.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 5px" }}>{a.h}</h3>
                <p style={{ color: COLORS.inkSoft, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{a.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────── Before / after comparison ────────────────────────────── */

function Comparison() {
  const rows = [
    { f: "Time per fortnight",            o: "Half a day, sometimes more",          n: "12 minutes" },
    { f: "BSP batch file",                o: "Hand-built in Excel, often rejected", n: "One-click download, BSP-spec exact" },
    { f: "NASFund / NCSL returns",        o: "Manual spreadsheet, monthly chore",   n: "Auto-generated and stored" },
    { f: "Pay stubs to employees",        o: "Printed and handed out",              n: "Emailed as PDFs the moment payroll is approved" },
    { f: "IRC SWT compliance",            o: "Manual lookup tables, risk of error", n: "Calculated automatically — current rates and brackets" },
    { f: "Compliance penalties",          o: "K500–K5,000 always a possibility",    n: "Eliminated — nothing waits on a person" },
    { f: "Records for an audit",          o: "Stack of paper, lost emails",         n: "Every period, every change, every file searchable in seconds" },
    { f: "Bookkeeper costs",              o: "K150–K300 per hour",                  n: "K9 per employee per fortnight, flat" },
    { f: "Setup",                         o: "Weeks of onboarding",                 n: "Drop a CSV — first fortnight free" },
  ];
  return (
    <section style={{ padding: "84px 24px", background: COLORS.cream }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <SectionEyebrow>Before / after</SectionEyebrow>
          <h2 style={{ ...h2, textAlign: "center" }}>What changes when you switch.</h2>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 1.4fr", background: "#fafbfc",
            padding: "14px 20px", fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.06 }}>
            <div></div>
            <div>The old way</div>
            <div style={{ color: COLORS.red }}>With TeebeePay</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1.1fr 1.4fr 1.4fr",
              padding: "16px 20px", borderTop: "1px solid #f3f4f6",
              fontSize: 14, alignItems: "center",
            }}>
              <div style={{ fontWeight: 600, color: COLORS.ink }}>{r.f}</div>
              <div style={{ color: COLORS.muted }}>{r.o}</div>
              <div style={{ color: COLORS.ink, display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={16} color={COLORS.red} style={{ flexShrink: 0 }} />
                <span>{r.n}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function SeoStructuredData() {
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TeebeePay",
    url: "https://www.curriculate.net/teebeepay",
    logo: "https://www.curriculate.net/teebeepay/og.png",
    description:
      "TeebeePay is a multi-tenant payroll service for Papua New Guinea SMEs and bureaus: fortnightly pay stubs, BSP bank batch files, NASFund / NCSL returns, IRC SWT compliance, QuickBooks IIF, multi-bank splits, audit log, two-factor auth, anomaly alerts, divisions and supervisor flow, approve-via-email — all in one web app.",
    contactPoint: [{
      "@type": "ContactPoint",
      contactType: "sales",
      email: "hello@teebeepay.com",
      areaServed: "PG",
      availableLanguage: ["English", "Tok Pisin"],
    }],
  };
  const softwareLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TeebeePay",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Payroll",
    operatingSystem: "Web",
    description:
      "Web-based payroll for Papua New Guinea: fortnightly pay stubs, BSP batch upload, NASFund/NCSL returns, IRC Salary or Wages Tax compliance, multi-bank account splits, divisions and supervisor flow, approve-via-email, audit log, two-factor authentication, anomaly alerts, employee self-serve portal, QuickBooks IIF export.",
    featureList: [
      "Branded pay-stub PDF emails per employee",
      "BSP Batch Manager 12-column CSV export",
      "NASFund / NCSL monthly contribution returns with AP signature embedded",
      "IRC Salary or Wages Tax (SWT) compliance — current 2026 brackets",
      "QuickBooks IIF general-journal export",
      "Multi-company / bureau mode with strict tenant isolation",
      "Five-role hierarchy: owner, principal, bookkeeper, site key person, employee",
      "Divisions with assigned supervisors and per-division default hours",
      "Supervisor self-entry of team hours; site-payroll handles the rest",
      "Per-period notes for bookkeepers",
      "Anomaly alerts when totals deviate from the 6-period median",
      "Approve via email magic-link (no log-in needed for remote AP)",
      "Period archive ZIP: BSP + NASFund + IIF + pay-slip PDFs in one download",
      "Audit log of every approval, edit, invite and re-send",
      "Two-factor authentication (TOTP) on top of email-PIN",
      "Employee self-serve portal for historical pay stubs",
      "Multi-bank-account splits per employee with percentage rules",
      "Daily NASFund deadline reminder email",
    ],
    offers: [
      { "@type": "Offer", name: "Small",    price: "12", priceCurrency: "PGK", description: "Per employee per fortnight, up to 15 employees" },
      { "@type": "Offer", name: "Standard", price: "9",  priceCurrency: "PGK", description: "Per employee per fortnight, up to 50 employees" },
      { "@type": "Offer", name: "Bureau",   price: "Custom", priceCurrency: "PGK", description: "Multi-company payroll service providers" },
    ],
    aggregateRating: undefined,
    creator: { "@type": "Organization", name: "TeebeePay" },
    url: "https://www.curriculate.net/teebeepay",
    audience: { "@type": "BusinessAudience", audienceType: "Small and medium businesses in Papua New Guinea" },
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.curriculate.net" },
      { "@type": "ListItem", position: 2, name: "TeebeePay", item: "https://www.curriculate.net/teebeepay" },
    ],
  };
  return (
    <>
      <Script id="teebeepay-ld-org"        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }} />
      <Script id="teebeepay-ld-software"   type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareLd) }} />
      <Script id="teebeepay-ld-faq"        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <Script id="teebeepay-ld-breadcrumb" type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function TopBar() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)",
      borderBottom: `1px solid ${COLORS.cream}`,
    }}>
      <nav style={{
        maxWidth: 1180, margin: "0 auto", padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 28,
      }}>
        <Link href="/teebeepay" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: COLORS.ink }}>
          <Logo />
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>TeebeePay</span>
        </Link>
        <div style={{ display: "flex", gap: 24, marginLeft: "auto", alignItems: "center" }}>
          <a href="#how" style={navLink}>How it works</a>
          <a href="#features" style={navLink}>Features</a>
          <a href="#pricing" style={navLink}>Pricing</a>
          <a href="#faq" style={navLink}>FAQ</a>
          <Link href="/teebeepay/app" style={navBtn}>
            Sign in <ArrowRight size={15} style={{ marginLeft: 4 }} />
          </Link>
        </div>
      </nav>
    </header>
  );
}
const navLink: React.CSSProperties = {
  fontSize: 14, color: COLORS.inkSoft, textDecoration: "none", fontWeight: 500,
};
const navBtn: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
  background: COLORS.red, color: "#fff", textDecoration: "none",
  display: "inline-flex", alignItems: "center",
};

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill={COLORS.red} />
      <path d="M9 9h14M11 9v14M21 9v6c0 2-1.5 3-3.5 3H11"
        stroke={COLORS.gold} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section style={{
      background: `linear-gradient(180deg, ${COLORS.cream} 0%, #fff 100%)`,
      padding: "72px 24px 56px",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 56, alignItems: "center" }} className="tp-hero-grid">
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600,
            background: "#fff7e0", color: COLORS.goldDeep, padding: "6px 12px", borderRadius: 999, marginBottom: 18 }}>
            <Sparkles size={14} /> Built for PNG · BSP-ready · NASFund-compliant
          </div>
          <h1 style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1.6, lineHeight: 1.05, margin: 0, color: COLORS.ink }}>
            Payroll, <span style={{ color: COLORS.red }}>done for you</span>.
          </h1>
          <p style={{ fontSize: 20, color: COLORS.inkSoft, lineHeight: 1.5, margin: "20px 0 28px", maxWidth: 540 }}>
            Hours in by Tuesday. Pay stubs, BSP batch, NASFund return, and IRC summary out by Thursday.
            Built around the way payroll actually works in Papua New Guinea.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="#pricing" style={primaryBtn}>See pricing <ArrowRight size={17} style={{ marginLeft: 6 }} /></Link>
            <Link href="/teebeepay/app" style={secondaryBtn}>Sign in to your account</Link>
          </div>
          <div style={{ display: "flex", gap: 22, marginTop: 28, fontSize: 14, color: COLORS.muted }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={15} color={COLORS.red} /> No app to install</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={15} color={COLORS.red} /> Web-based</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={15} color={COLORS.red} /> A4 / PGK by default</span>
          </div>
        </div>
        <HeroVisual />
      </div>
      <style>{`@media (max-width: 900px) { .tp-hero-grid { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "14px 22px",
  borderRadius: 10, background: COLORS.red, color: "#fff",
  fontSize: 15, fontWeight: 600, textDecoration: "none",
  boxShadow: "0 6px 20px rgba(185,48,42,.25)",
};
const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "14px 22px",
  borderRadius: 10, background: "#fff", color: COLORS.ink,
  fontSize: 15, fontWeight: 600, textDecoration: "none",
  border: `1px solid #e5e7eb`,
};

function HeroVisual() {
  return (
    <div style={{ position: "relative", padding: 18 }}>
      <div style={{
        background: "#fff",
        border: "1px solid #e5e7eb", borderRadius: 14,
        boxShadow: "0 20px 60px rgba(15,23,42,.08)",
        padding: 22, overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Logo />
          <strong style={{ fontSize: 15 }}>Sample Trading Ltd</strong>
          <span style={{ marginLeft: "auto", fontSize: 12, color: COLORS.muted }}>Pay date 18 / May / 2026</span>
        </div>
        <h3 style={{ margin: "6px 0 14px", fontSize: 16 }}>New pay period</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#fafbfc", color: COLORS.muted, textAlign: "left" }}>
              <th style={hcell}>Employee</th><th style={hcell}>Dept</th><th style={hcellR}>Default</th><th style={hcellR}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {[
              { n: "Employee A", d: "Admin",    h: 80 },
              { n: "Employee B", d: "Ops",      h: 80 },
              { n: "Employee C", d: "Drivers",  h: 80 },
              { n: "Employee D", d: "Admin",    h: 80 },
              { n: "Employee E", d: "Security", h: 0 },
            ].map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={cell}>{r.n}</td>
                <td style={{ ...cell, color: COLORS.muted }}>{r.d}</td>
                <td style={cellR}>80</td>
                <td style={cellR}>
                  <span style={{
                    display: "inline-block", padding: "3px 10px", borderRadius: 6,
                    background: r.h === 80 ? "#fff7e0" : "#fee2e2",
                    color: r.h === 80 ? COLORS.goldDeep : "#991b1b", fontWeight: 600,
                  }}>{r.h}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16, fontSize: 12, color: COLORS.muted, fontStyle: "italic" }}>
          Double-click an hours cell to fill the default. Double-click again to zero it.
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <span style={{ ...pill, background: COLORS.red, color: "#fff" }}>Process payroll</span>
          <span style={{ ...pill, background: "#fff", border: "1px solid #e5e7eb" }}>Save draft</span>
        </div>
      </div>
      <div style={{
        position: "absolute", right: -16, bottom: -18, padding: "10px 14px",
        background: COLORS.gold, color: COLORS.ink, borderRadius: 999, fontSize: 12, fontWeight: 700,
        boxShadow: "0 8px 24px rgba(244,180,0,.45)",
      }}>
        ⏱ 12-min fortnightly run
      </div>
    </div>
  );
}
const hcell: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.04 };
const hcellR: React.CSSProperties = { ...hcell, textAlign: "right" };
const cell: React.CSSProperties = { padding: "10px" };
const cellR: React.CSSProperties = { ...cell, textAlign: "right" as const };
const pill: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600 };

/* ─────────────────────────────────────────────────────────────────── */

function TrustBar() {
  return (
    <section style={{ background: "#fff", borderTop: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px", display: "flex",
        alignItems: "center", gap: 36, flexWrap: "wrap", justifyContent: "center", color: COLORS.muted, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>Trusted by PNG bureaus running:</span>
        <span style={badge}>BSP Batch Manager uploads</span>
        <span style={badge}>NASFund / NCSL filings</span>
        <span style={badge}>IRC SWT remittance</span>
        <span style={badge}>QuickBooks IIF imports</span>
      </div>
    </section>
  );
}
const badge: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 999, background: "#f8fafc",
  border: "1px solid #e5e7eb", color: COLORS.inkSoft, fontWeight: 500,
};

/* ─────────────────────────────────────────────────────────────────── */

function ForOwners() {
  return (
    <section id="owners" style={{ padding: "72px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <SectionEyebrow>For business owners shopping for payroll</SectionEyebrow>
        <h2 style={h2}>Stop dreading the fortnight.</h2>
        <p style={lead}>
          We give you a single web page where the site supervisor enters hours, the office reviews,
          and TeebeePay handles every downstream file: pay stubs to employees, BSP batch to the bank,
          NASFund return to the fund, IRC summary to the Commissioner. Compliance baked in.
        </p>
        <div style={threeCol}>
          <ValueCard icon={<Clock3 size={24} />} title="12 minutes a fortnight">
            Field manager enters hours, office clicks Approve. We email stubs and produce every file.
          </ValueCard>
          <ValueCard icon={<ShieldCheck size={24} />} title="No more K5,000 fines">
            SWT brackets stay current. NASFund returns formatted to spec. Late-payment penalties
            disappear because nothing ever waits on a person.
          </ValueCard>
          <ValueCard icon={<Banknote size={24} />} title="Real BSP batches">
            Not a guess: the 12-column BSP format your bank actually accepts, with the meta-header
            row and your client number pre-filled.
          </ValueCard>
        </div>
      </div>
    </section>
  );
}

function ForExistingClients() {
  return (
    <section style={{ padding: "72px 24px", background: COLORS.cream }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 56, alignItems: "center" }} className="tp-hero-grid">
        <div>
          <SectionEyebrow>For existing TeebeePay clients</SectionEyebrow>
          <h2 style={h2}>Your pay stubs and reports — all in one place.</h2>
          <p style={lead}>
            Employees, principals, and approvers each sign in to the same address. Stubs are emailed
            automatically and also live in your account if anyone needs to re-download. Historical
            BSP batches, GL summaries, and NASFund returns going back to 2019 are searchable in seconds.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            <FeatureLine icon={<KeyRound size={18} />}>Passwordless email sign-in. No password to forget.</FeatureLine>
            <FeatureLine icon={<Mail size={18} />}>Re-send any pay stub to any employee in one click.</FeatureLine>
            <FeatureLine icon={<FileSpreadsheet size={18} />}>Every historical period's files available for download.</FeatureLine>
            <FeatureLine icon={<Bell size={18} />}>Slack/email alerts when payroll is awaiting approval.</FeatureLine>
          </ul>
          <Link href="/teebeepay/app" style={{ ...primaryBtn, marginTop: 28 }}>
            Sign in to your account <ArrowRight size={17} style={{ marginLeft: 6 }} />
          </Link>
        </div>
        <PeriodHistoryVisual />
      </div>
    </section>
  );
}

function PeriodHistoryVisual() {
  const rows = [
    { d: "16 May 26", c: "Sample",  n: 19, k: 12_481 },
    { d: "2 May 26",  c: "Sample",  n: 18, k: 12_220 },
    { d: "18 Apr 26", c: "Sample",  n: 19, k: 13_001 },
    { d: "4 Apr 26",  c: "Sample",  n: 21, k: 13_660 },
    { d: "21 Mar 26", c: "Sample",  n: 18, k: 12_077 },
  ];
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 22, boxShadow: "0 10px 30px rgba(15,23,42,.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <FileSpreadsheet size={18} color={COLORS.red} />
        <strong>Pay-period history</strong>
        <span style={{ marginLeft: "auto", fontSize: 12, color: COLORS.muted }}>Most recent first</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead style={{ background: "#fafbfc", color: COLORS.muted }}>
          <tr>
            <th style={hcell}>Date</th><th style={hcell}>Co</th><th style={hcellR}># emp</th><th style={hcellR}>Net (K)</th><th style={hcellR}>Files</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
              <td style={cell}>{r.d}</td>
              <td style={cell}>{r.c}</td>
              <td style={cellR}>{r.n}</td>
              <td style={cellR}>{r.k.toLocaleString()}</td>
              <td style={cellR}><span style={{ color: COLORS.red, fontWeight: 600 }}>4</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14, fontSize: 12, color: COLORS.muted }}>
        BSP CSV · GL PDF · Pay Slips PDF · QB IIF — every period
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    { i: 1, t: "Site supervisor enters hours",
      d: "On Tuesday afternoon, the field/site manager opens TeebeePay, sees their employees pre-populated, double-clicks to fill default hours, adjusts if needed, and submits." },
    { i: 2, t: "Office reviews & approves",
      d: "The approver (principal or office admin) sees the run flagged 'awaiting approval', checks the totals, and clicks Approve & Send. That's the moment files are generated and stubs go out." },
    { i: 3, t: "Files appear, money moves",
      d: "Pay stubs land in employee inboxes. The BSP batch file is ready to upload (or auto-upload if your bank supports it). NASFund return + IRC summary stored for monthly filing." },
  ];
  return (
    <section id="how" style={{ padding: "80px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>How it works</SectionEyebrow>
        <h2 style={{ ...h2, textAlign: "center", maxWidth: 760, margin: "0 auto 12px" }}>
          A fortnight in three clicks.
        </h2>
        <p style={{ ...lead, textAlign: "center", margin: "0 auto 48px", maxWidth: 720 }}>
          Designed around the workflow you actually use: a site person enters, an office person approves, the system does the rest.
        </p>
        <div style={threeCol}>
          {steps.map((s) => (
            <div key={s.i} style={{ textAlign: "left" }}>
              <div style={{
                width: 44, height: 44, borderRadius: 999, background: COLORS.red, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18,
                marginBottom: 16,
              }}>{s.i}</div>
              <h3 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 10px" }}>{s.t}</h3>
              <p style={{ color: COLORS.inkSoft, lineHeight: 1.55, margin: 0 }}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function FeatureGrid() {
  const features = [
    { icon: <Receipt size={22} />, t: "Pay-stub emails", d: "Branded PDF for every employee — manager note, allowances, deductions, net pay. One click after approval." },
    { icon: <UploadCloud size={22} />, t: "BSP batch file", d: "12-column, meta-header CSV in the exact shape BSP Batch Manager expects. No reformatting." },
    { icon: <FileSpreadsheet size={22} />, t: "NASFund / NCSL", d: "Monthly contribution returns formatted to fund spec, with AP name, title and signature image embedded." },
    { icon: <Building2 size={22} />, t: "Multi-company", d: "Run payroll for several entities side-by-side. Strict isolation between client books and users." },
    { icon: <Layers size={22} />, t: "Divisions, supervisors & hours-in tracking", d: "Group employees by division (HQ, Field, Lae Branch). Each division has a supervisor who enters their own team's hours via a dedicated \"My team\" page; bookkeepers see a live status panel showing who's in, who's pending, and when each submission landed. Set a deadline per company and TeebeePay reminds laggards by email." },
    { icon: <Users size={22} />, t: "Five-role hierarchy", d: "Owner, principal, bookkeeper, site key person, employee. Each sees only what they should." },
    { icon: <ShieldCheck size={22} />, t: "PNG compliance built in", d: "SWT brackets, dependent rebates, non-resident and no-declaration tables — all current with the 2026 IRC rules." },
    { icon: <Banknote size={22} />, t: "Multi-bank splits", d: "Split each employee's net pay across multiple accounts by percentage. Remainder reconciliation handled for you." },
    { icon: <MailCheck size={22} />, t: "Approve via email", d: "Magic-link approval so a remote AP can sign off a pay run from their phone without logging in." },
    { icon: <KeyRound size={22} />, t: "Two-factor auth", d: "TOTP (Google Authenticator / 1Password / Authy) on top of the email-PIN sign-in. Strongly recommended for owners." },
    { icon: <NotebookPen size={22} />, t: "Per-period notes", d: "A notepad on every pay period for the bookkeeper. \"Manager away, hours estimated\" — captured with author + timestamp." },
    { icon: <AlertTriangle size={22} />, t: "Anomaly alerts", d: "Banner warns when a period's gross or headcount deviates from the 6-period median. Catch data-entry mistakes before they hit the bank." },
    { icon: <Archive size={22} />, t: "Period archive ZIP", d: "One click downloads BSP batch + NASFund return + IIF + all pay-slip PDFs as a single ZIP. Hand-off in seconds." },
    { icon: <History size={22} />, t: "Audit log", d: "Every approval, rejection, edit, invite and re-send recorded with actor, timestamp, and before/after values. Bureau-grade evidence." },
    { icon: <UserCircle2 size={22} />, t: "Employee self-serve", d: "Each employee can sign in by email-PIN and download their own historical pay stubs. Zero \"resend please\" emails to your team." },
    { icon: <Network size={22} />, t: "QuickBooks IIF", d: "General-journal IIF export per period drops straight into your existing books." },
    { icon: <Mail size={22} />, t: "Manager notes on stubs", d: "Short note per employee — \"hours reduced this fortnight because…\" — appears on their pay-stub PDF." },
    { icon: <Smartphone size={22} />, t: "Mobile-friendly", d: "Web-based, works on phone and tablet. Run a payroll from a remote site if you need to." },
  ];
  return (
    <section id="features" style={{ padding: "80px 24px", background: COLORS.cream }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <SectionEyebrow>Everything you'd expect — plus what PNG actually needs</SectionEyebrow>
        <h2 style={h2}>Features</h2>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 18, marginTop: 36,
        }}>
          {features.map((f, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 22 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: "#fff7e0",
                color: COLORS.goldDeep, display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12,
              }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{f.t}</h3>
              <p style={{ color: COLORS.inkSoft, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Roadmap() {
  const items = [
    {
      icon: <ScanLine size={22} />,
      t: "Supervisor daily timesheet",
      d: "A foreman opens \"My team\" on their phone each morning and taps each employee to start their shift, then taps again at knock-off. Late starts, early finishes, and absences captured to the minute — no end-of-fortnight memory game. The daily timesheet rolls up into the fortnight's hours automatically when the pay run is cut. No employee-phone dependency: only the supervisor needs the app.",
    },
    {
      icon: <QrCode size={22} />,
      t: "QR-code self-attendance",
      d: "A rotating-QR signboard at each worksite (refreshes hourly). Employees scan from the TeebeePay app to clock in and again to clock out. Auto-clock-out at the regular end-of-shift; a later scan overrides that as the real time. No clock-in = marked absent and the supervisor is notified — so disputes get caught the same day. Hours flow straight into the pay run, no foreman memory required.",
    },
  ];
  return (
    <section id="roadmap" style={{ padding: "60px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <SectionEyebrow>Roadmap</SectionEyebrow>
        <h2 style={{ ...h2, marginBottom: 6 }}>Coming next</h2>
        <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 32px", maxWidth: 720 }}>
          Ideas we're actively scoping. Tell us which would matter most for your business — we prioritise by what
          customers actually need.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 18 }}>
          {items.map((it, i) => (
            <div key={i} style={{
              position: "relative",
              background: "linear-gradient(135deg, #fffaf0 0%, #fff7e0 100%)",
              border: "1px dashed #e9c46a", borderRadius: 12, padding: 22,
            }}>
              <span style={{
                position: "absolute", top: 14, right: 14,
                background: "#0f172a", color: "#f4b400",
                padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.04,
              }}>
                COMING SOON
              </span>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: "#fff",
                color: COLORS.goldDeep, display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12, border: "1px solid #e9c46a",
              }}>
                {it.icon}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", paddingRight: 90 }}>{it.t}</h3>
              <p style={{ color: COLORS.inkSoft, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{it.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function InterestForm() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", company: "", role: "",
    employees: "", country: "Papua New Guinea", payInterval: "fortnightly",
    currentTool: "", painPoint: "", timing: "",
    hp: "", // honeypot
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/teebeepay/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Submission failed");
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please email hello@teebeeaccountants.com.pg.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="interest" style={{ padding: "80px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 48, alignItems: "start" }} className="tp-hero-grid">
        <div>
          <SectionEyebrow>Get started</SectionEyebrow>
          <h2 style={{ ...h2, fontSize: 34 }}>Tell us about your payroll.</h2>
          <p style={lead}>
            Three quick steps. We'll reply within one business day with a tailored quote and a plan
            for your first fortnight on TeebeePay (which is free, so you can see the actual output).
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 10 }}>
            <FeatureLine icon={<CheckCircle2 size={18} />}>No credit card needed</FeatureLine>
            <FeatureLine icon={<CheckCircle2 size={18} />}>1-business-day reply, in PNG hours</FeatureLine>
            <FeatureLine icon={<CheckCircle2 size={18} />}>First fortnight free — see real BSP batch + stubs before committing</FeatureLine>
          </ul>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 28, boxShadow: "0 12px 36px rgba(15,23,42,.06)" }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: "#dcfce7", color: "#166534",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={32} />
              </div>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Thanks — we'll be in touch!</h3>
              <p style={{ color: COLORS.inkSoft, marginTop: 10 }}>
                Look out for an email from hello@teebeeaccountants.com.pg within one business day.
                In the meantime, dig out a CSV of your current employee list — having it ready
                lets us show you actual stubs on our first call.
              </p>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
                {[1, 2, 3].map(n => (
                  <div key={n} style={{
                    flex: 1, height: 4, borderRadius: 4,
                    background: n <= step ? COLORS.red : "#e5e7eb",
                  }} />
                ))}
              </div>

              {/* Honeypot (invisible) */}
              <input
                type="text" name="company-url" tabIndex={-1} autoComplete="off"
                value={form.hp} onChange={e => set("hp", e.target.value)}
                style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }}
                aria-hidden="true"
              />

              {step === 1 && (
                <>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>About you</h3>
                  <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 0 }}>Just so we know who we're talking to.</p>
                  <FormField label="Your name *">
                    <input style={input} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Your full name" />
                  </FormField>
                  <FormField label="Work email *">
                    <input style={input} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@company.com" />
                  </FormField>
                  <FormField label="Your role">
                    <input style={input} value={form.role} onChange={e => set("role", e.target.value)} placeholder="Owner / Principal / Finance / Office admin" />
                  </FormField>
                  <FormField label="Company name *">
                    <input style={input} value={form.company} onChange={e => set("company", e.target.value)} placeholder="Your business name" />
                  </FormField>
                  <FormActions
                    onNext={() => {
                      if (!form.name || !form.email || !form.company) { setError("Please fill name, email, and company."); return; }
                      setError(null); setStep(2);
                    }}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>About your payroll</h3>
                  <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 0 }}>Helps us size the right plan for you.</p>
                  <FormField label="How many employees do you pay?">
                    <select style={input} value={form.employees} onChange={e => set("employees", e.target.value)}>
                      <option value="">— Select —</option>
                      <option>1–5</option>
                      <option>6–15</option>
                      <option>16–30</option>
                      <option>31–50</option>
                      <option>51–100</option>
                      <option>100+</option>
                    </select>
                  </FormField>
                  <FormField label="Country">
                    <select style={input} value={form.country} onChange={e => set("country", e.target.value)}>
                      <option>Papua New Guinea</option>
                      <option>Other</option>
                    </select>
                  </FormField>
                  <FormField label="Pay interval">
                    <select style={input} value={form.payInterval} onChange={e => set("payInterval", e.target.value)}>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </FormField>
                  <FormField label="What do you use today?">
                    <input style={input} value={form.currentTool} onChange={e => set("currentTool", e.target.value)} placeholder="MYOB / Sage / Excel / external bookkeeper / nothing yet" />
                  </FormField>
                  <FormActions onBack={() => setStep(1)} onNext={() => { setError(null); setStep(3); }} />
                </>
              )}

              {step === 3 && (
                <>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>What's the goal?</h3>
                  <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 0 }}>One or two sentences is fine — we'll go deeper on the call.</p>
                  <FormField label="What would success look like? Any pain points today?">
                    <textarea style={{ ...input, minHeight: 110, resize: "vertical" }} value={form.painPoint}
                      onChange={e => set("painPoint", e.target.value)}
                      placeholder="e.g. We're spending half a day every fortnight reconciling BSP uploads and our NASFund returns are always late." />
                  </FormField>
                  <FormField label="When would you ideally start?">
                    <select style={input} value={form.timing} onChange={e => set("timing", e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Next fortnight</option>
                      <option>This month</option>
                      <option>Within 3 months</option>
                      <option>Just exploring</option>
                    </select>
                  </FormField>

                  {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

                  <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                    <button type="button" onClick={() => setStep(2)} style={btnGhost} disabled={submitting}>Back</button>
                    <button type="button" onClick={submit} style={{ ...btnPrimary, flex: 1 }} disabled={submitting}>
                      {submitting
                        ? <><Loader2 size={16} className="tp-spin" style={{ marginRight: 8 }} /> Sending…</>
                        : <>Send to TeebeePay <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
                    </button>
                  </div>
                </>
              )}

              {step < 3 && error && (
                <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 12 }}>{error}</div>
              )}
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes tp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tp-spin { animation: tp-spin .9s linear infinite; }`}</style>
    </section>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.inkSoft, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
function FormActions({ onBack, onNext }: { onBack?: () => void; onNext: () => void }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
      {onBack && <button type="button" onClick={onBack} style={btnGhost}>Back</button>}
      <button type="button" onClick={onNext} style={{ ...btnPrimary, flex: 1 }}>
        Continue <ArrowRight size={16} style={{ marginLeft: 6 }} />
      </button>
    </div>
  );
}
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 13px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 14, background: "#fff", color: COLORS.ink,
  outline: "none",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "11px 18px", borderRadius: 8,
  background: COLORS.red, color: "#fff", fontWeight: 600, fontSize: 14,
  border: "none", cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "11px 18px", borderRadius: 8,
  background: "#fff", color: COLORS.ink, fontWeight: 600, fontSize: 14,
  border: "1px solid #d1d5db", cursor: "pointer",
};

function PricingTeaser() {
  return (
    <section id="pricing" style={{ padding: "80px 24px", background: "#fff" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>Pricing</SectionEyebrow>
        <h2 style={{ ...h2, textAlign: "center" }}>Simple, per-employee, no surprises.</h2>
        <p style={{ ...lead, textAlign: "center", margin: "0 auto 40px", maxWidth: 640 }}>
          One flat fee per fortnight. Includes everything: stubs, BSP batch, NASFund returns, IRC summary, change log, history.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <PriceCard tier="Small" pricePer="K 12" desc="per employee, per fortnight" features={["Up to 15 employees", "All compliance files", "Email pay stubs"]} />
          <PriceCard featured tier="Standard" pricePer="K 9" desc="per employee, per fortnight" features={["Up to 50 employees", "All compliance files", "Multi-bank splits", "Approval workflow"]} />
          <PriceCard tier="Bureau" pricePer="Custom" desc="for payroll service providers" features={["Multi-company isolation", "Bookkeeper logins", "Service-fee disbursements", "White-glove onboarding"]} />
        </div>
        <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 24 }}>
          Final pricing confirmed during onboarding. First fortnight is on us — bring a CSV of your employees and we'll show you the output before you commit.
        </p>
      </div>
    </section>
  );
}

function PriceCard({ tier, pricePer, desc, features, featured }: { tier: string; pricePer: string; desc: string; features: string[]; featured?: boolean; }) {
  return (
    <div style={{
      background: "#fff",
      border: featured ? `2px solid ${COLORS.red}` : "1px solid #e5e7eb",
      borderRadius: 14, padding: 28, textAlign: "left",
      boxShadow: featured ? "0 12px 36px rgba(185,48,42,.12)" : "none",
      position: "relative",
    }}>
      {featured && (
        <span style={{
          position: "absolute", top: -12, left: 20, padding: "4px 10px",
          background: COLORS.red, color: "#fff", fontSize: 11, fontWeight: 700,
          borderRadius: 999, letterSpacing: 0.6, textTransform: "uppercase",
        }}>Most common</span>
      )}
      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.06 }}>{tier}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "10px 0 6px" }}>
        <span style={{ fontSize: 36, fontWeight: 800 }}>{pricePer}</span>
      </div>
      <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 18 }}>{desc}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, color: COLORS.inkSoft }}>
            <CheckCircle2 size={16} color={COLORS.red} style={{ marginTop: 2, flexShrink: 0 }} />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function FaqSection() {
  const faqs = [
    { q: "Where is my data stored?", a: "On a managed MongoDB cluster (Atlas) with daily backups. No data leaves the database except the file outputs you generate (BSP CSV, payslip PDFs)." },
    { q: "What banks do you support?", a: "Primary support is BSP Batch Manager (the 12-column CSV format). Kina, Westpac, ANZ — we generate a generic disbursement CSV that imports to most banks. Tell us the bank during onboarding." },
    { q: "Can my field manager work remotely?", a: "Yes — field managers (site key persons) log in from any browser. They can enter hours and notes, but can't approve a payroll run. That stays with your principal or bookkeeper." },
    { q: "What if PNG tax rates change?", a: "Tax brackets are editable in the app's Tax Rules tab — no code change required when the IRC publishes new tables. Updated brackets apply to new pay periods only; confirmed historical runs keep their original numbers." },
    { q: "Can I import from my old payroll?", a: "Yes. CSV import matched to common payroll-export formats (we also have a specific importer for the legacy MS Access PNGPay export). Historical pay periods can be re-attached so reports show the full history." },
  ];
  return (
    <section id="faq" style={{ padding: "80px 24px", background: COLORS.cream }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <SectionEyebrow>Common questions</SectionEyebrow>
        <h2 style={{ ...h2, marginBottom: 36 }}>FAQ</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {faqs.map((f, i) => (
            <details key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 22px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 16, color: COLORS.ink }}>{f.q}</summary>
              <p style={{ color: COLORS.inkSoft, marginTop: 10, lineHeight: 1.55, fontSize: 14 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function CtaFooter() {
  return (
    <section style={{
      padding: "72px 24px",
      background: `linear-gradient(135deg, ${COLORS.red} 0%, ${COLORS.redDeep} 100%)`,
      color: "#fff",
    }}>
      <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: -0.8 }}>
          Run your next payroll on TeebeePay.
        </h2>
        <p style={{ fontSize: 17, opacity: .92, margin: "16px auto 28px", maxWidth: 600 }}>
          First fortnight is free — drop us a CSV of your employees and you'll have stubs and BSP batch in your inbox within a day.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="mailto:hello@teebeepay.com?subject=TeebeePay demo" style={{
            display: "inline-flex", alignItems: "center", padding: "14px 26px",
            borderRadius: 10, background: "#fff", color: COLORS.red,
            fontSize: 15, fontWeight: 700, textDecoration: "none",
          }}>
            Book a demo <ArrowRight size={17} style={{ marginLeft: 6 }} />
          </a>
          <Link href="/teebeepay/app" style={{
            display: "inline-flex", alignItems: "center", padding: "14px 26px",
            borderRadius: 10, background: "transparent", color: "#fff",
            fontSize: 15, fontWeight: 600, textDecoration: "none",
            border: "1.5px solid rgba(255,255,255,.5)",
          }}>
            I already have an account
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer style={{ padding: "40px 24px", background: COLORS.ink, color: "#94a3b8" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <strong style={{ color: "#fff", fontSize: 16 }}>TeebeePay</strong>
          <span style={{ fontSize: 13 }}>— Payroll for PNG SMEs.</span>
        </div>
        <div style={{ fontSize: 13 }}>
          © {new Date().getFullYear()} TeebeePay · <a href="mailto:hello@teebeepay.com" style={{ color: "#cbd5e1" }}>hello@teebeepay.com</a>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "inline-block", fontSize: 12, fontWeight: 700,
      color: COLORS.red, textTransform: "uppercase", letterSpacing: 0.12, marginBottom: 12,
    }}>{children}</div>
  );
}

function ValueCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 26 }}>
      <div style={{
        width: 50, height: 50, borderRadius: 12, background: "#fff7e0",
        color: COLORS.goldDeep, display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 16,
      }}>{icon}</div>
      <h3 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 10px" }}>{title}</h3>
      <p style={{ color: COLORS.inkSoft, lineHeight: 1.55, margin: 0 }}>{children}</p>
    </div>
  );
}

function FeatureLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 15, color: COLORS.inkSoft, lineHeight: 1.5 }}>
      <span style={{ color: COLORS.red, marginTop: 2 }}>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

const h2: React.CSSProperties = {
  fontSize: 40, fontWeight: 800, letterSpacing: -0.8,
  margin: "0 0 14px", color: COLORS.ink, lineHeight: 1.1,
};
const lead: React.CSSProperties = {
  fontSize: 18, color: COLORS.inkSoft, lineHeight: 1.55, margin: "0 0 32px", maxWidth: 720,
};
const threeCol: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 22,
};
