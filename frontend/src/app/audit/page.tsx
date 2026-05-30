// /audit — Tee Bee Accountants audit-readiness platform landing + intake form.
"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, ShieldCheck, FileSpreadsheet, ClipboardList,
  Sparkles, Loader2, AlertCircle, Building2, Mail, Phone,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  red: "#b9302a",
};

export default function AuditLanding() {
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
      <PricingHint />
      <IntakeForm />
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
      <Link href="/audit" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, letterSpacing: -0.5,
        }}>TBA</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>Tee Bee Audit</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1, marginTop: 3 }}>Tee Bee Accountants Ltd</div>
        </div>
      </Link>
      <nav style={{ marginLeft: "auto", display: "flex", gap: 22, fontSize: 14, color: C.inkSoft }}>
        <a href="#how" style={navLink}>How it works</a>
        <a href="#pricing" style={navLink}>Pricing</a>
        <a href="#start" style={{ ...navLink, background: C.navy, color: "#fff", padding: "8px 16px", borderRadius: 8, fontWeight: 600 }}>
          Start an inquiry
        </a>
      </nav>
    </header>
  );
}
const navLink: React.CSSProperties = { color: "inherit", textDecoration: "none" };

function Hero() {
  return (
    <section style={{
      padding: "84px 28px 64px", background: `linear-gradient(180deg, ${C.cream} 0%, #fff 100%)`,
    }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px",
          borderRadius: 999, background: C.goldSoft, color: C.navy, fontSize: 12, fontWeight: 600,
          letterSpacing: 0.04, marginBottom: 18,
        }}>
          <Sparkles size={14} /> AI-assisted · CPA-signed · IFRS-compliant
        </div>
        <h1 style={{
          margin: "0 0 18px", fontSize: 56, fontWeight: 800, lineHeight: 1.05,
          letterSpacing: -1.5, maxWidth: 880, marginInline: "auto",
        }}>
          Faster, cheaper, cleaner audits for{" "}
          <span style={{ color: C.gold }}>Papua New Guinea businesses</span>.
        </h1>
        <p style={{
          margin: "0 auto 30px", fontSize: 18, lineHeight: 1.55, color: C.inkSoft,
          maxWidth: 720,
        }}>
          Upload your trial balance, GL, bank statements and supporting files.
          Our software runs reconciliations, anomaly checks, and compliance scans.
          A registered CPA reviews every finding before the audit opinion goes out.
          You get a real audit, in a fraction of the time.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="#start" style={primaryBtn}>
            <ClipboardList size={16} /> Start an inquiry
          </a>
          <a href="#how" style={secondaryBtn}>
            See how it works <ArrowRight size={16} />
          </a>
        </div>
        <div style={{ marginTop: 28, fontSize: 12, color: C.muted }}>
          Registered with the PNG Accountants Registration Board · Tax Agent · 10+ years serving PNG SMEs
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
    { icon: <FileSpreadsheet size={22} />, t: "Automated reconciliation", d: "TB ↔ GL ↔ bank statements ↔ payroll. Discrepancies surfaced for your CPA to review, not for you to chase." },
    { icon: <ShieldCheck size={22} />, t: "Compliance scanned", d: "IRC SWT, NASFund/NCSL, IPA annual returns — late penalties and gaps flagged before they bite." },
    { icon: <Sparkles size={22} />, t: "Anomaly detection", d: "Round-number transactions, weekend journal entries, duplicate invoices, related-party patterns. Machine-fast, human-reviewed." },
    { icon: <CheckCircle2 size={22} />, t: "CPA-signed opinion", d: "Every audit is reviewed and signed by Theresia Bob (CPA, registered tax agent). The software speeds the work, never replaces the judgement." },
  ];
  return (
    <section style={{ padding: "72px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>Why Tee Bee Audit</SectionEyebrow>
        <h2 style={h2}>An audit, but you spend a tenth of the time on it.</h2>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 18, marginTop: 36,
        }}>
          {items.map((it, i) => (
            <div key={i} style={{
              padding: 22, background: C.cream, borderRadius: 12, border: "1px solid #fde68a",
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, background: "#fff",
                color: C.navy, display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12, border: `1px solid ${C.goldSoft}`,
              }}>
                {it.icon}
              </div>
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
    { n: "01", t: "Submit an inquiry", d: "Tell us about your business — entity type, prior-year revenue, audit type, fiscal year end. We respond within 2 business days with a price estimate and a formal engagement letter." },
    { n: "02", t: "Sign the engagement letter", d: "E-sign in-app. Scope, fee and timeline are agreed before any work begins. No surprises." },
    { n: "03", t: "Upload your files", d: "A personalised checklist lists exactly what we need — trial balance, GL export, bank statements, payroll registers, fixed-asset register, board minutes, etc. Drag and drop." },
    { n: "04", t: "Software runs the analysis", d: "Reconciliations, anomaly scans, compliance checks, ratio analysis vs prior year. Findings are surfaced as a draft working-paper file." },
    { n: "05", t: "Theresia reviews and signs", d: "A registered CPA reviews every machine-generated finding, runs the substantive testing samples, drafts the management letter, and signs the audit opinion personally." },
    { n: "06", t: "Receive your final report", d: "Branded PDF audit report, management letter and invoice. Working papers retained 7 years per ARB rules." },
  ];
  return (
    <section id="how" style={{ padding: "80px 28px", background: C.cream }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SectionEyebrow>How it works</SectionEyebrow>
        <h2 style={h2}>Six steps, weeks instead of months.</h2>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18, marginTop: 36,
        }}>
          {steps.map((s) => (
            <div key={s.n} style={{
              padding: 22, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: 0.08 }}>{s.n}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "6px 0 8px" }}>{s.t}</h3>
              <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingHint() {
  return (
    <section id="pricing" style={{ padding: "72px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
        <SectionEyebrow>Pricing</SectionEyebrow>
        <h2 style={h2}>Fees scale with complexity, never with how long it took us.</h2>
        <p style={{ ...lead, margin: "12px auto 28px", maxWidth: 680 }}>
          We quote each audit individually based on the data we see — transaction volume, number of accounts,
          number of findings, complexity. No hourly clock-watching, no scope-creep invoices.
        </p>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginTop: 24,
        }}>
          <PriceCard tier="Small entity"  range="from K 5,000" desc="< K 2M revenue · audit-readiness review · IRC compliance check" />
          <PriceCard tier="Mid-size"      range="from K 12,000" desc="K 2M–10M revenue · external statutory audit · IFRS for SMEs" featured />
          <PriceCard tier="Large / SPV"   range="Custom" desc="Multi-entity · landowner companies · project SPVs · donor-fund audits" />
        </div>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 28 }}>
          The intake form below produces an indicative quote within 2 business days. Final fee is locked in the engagement letter — no scope creep, ever.
        </p>
      </div>
    </section>
  );
}

function PriceCard({ tier, range, desc, featured }: { tier: string; range: string; desc: string; featured?: boolean }) {
  return (
    <div style={{
      padding: 28, borderRadius: 14, textAlign: "left",
      background: "#fff",
      border: featured ? `2px solid ${C.navy}` : "1px solid #e5e7eb",
      boxShadow: featured ? "0 16px 40px rgba(15, 44, 82, 0.12)" : "none",
      position: "relative",
    }}>
      {featured && (
        <span style={{
          position: "absolute", top: -12, left: 20, padding: "4px 10px",
          background: C.gold, color: C.navyDeep, fontSize: 11, fontWeight: 800,
          borderRadius: 999, letterSpacing: 0.6, textTransform: "uppercase",
        }}>Most common</span>
      )}
      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, letterSpacing: 0.06, textTransform: "uppercase" }}>{tier}</div>
      <div style={{ fontSize: 30, fontWeight: 800, margin: "8px 0 6px" }}>{range}</div>
      <p style={{ color: C.inkSoft, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{desc}</p>
    </div>
  );
}

/* ───────────── Intake form ───────────── */

const AUDIT_TYPES = [
  { v: "statutory",        l: "External statutory audit (IFRS / IFRS-SME)" },
  { v: "readiness",        l: "Audit-readiness review (before next year's statutory audit)" },
  { v: "tax",              l: "Tax / IRC due diligence audit" },
  { v: "compliance",       l: "Compliance audit (NASFund, IRC, IPA)" },
  { v: "donor_fund",       l: "Donor-funded / project SPV audit" },
  { v: "landowner",        l: "Landowner company audit" },
  { v: "other",            l: "Other / not sure" },
];

const REVENUE_BANDS = [
  { v: "lt_500k",   l: "Under K 500,000" },
  { v: "500k_2m",   l: "K 500,000 – K 2 million" },
  { v: "2m_10m",    l: "K 2 million – K 10 million" },
  { v: "10m_50m",   l: "K 10 million – K 50 million" },
  { v: "gt_50m",    l: "Over K 50 million" },
  { v: "unknown",   l: "Not sure / prefer not to say" },
];

function IntakeForm() {
  const [f, setF] = useState({
    company_name: "", contact_name: "", contact_email: "", contact_phone: "",
    entity_type: "", audit_type: "", revenue_band: "", fy_end: "",
    employee_count: "", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const canSubmit = f.company_name.trim() && f.contact_name.trim() && f.contact_email.trim()
                 && f.audit_type && f.revenue_band;
  async function submit() {
    setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/audit/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setSubmitted(true);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <section id="start" style={{ padding: "84px 28px", background: C.cream }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <SectionEyebrow>Start here</SectionEyebrow>
        <h2 style={h2}>Tell us about your audit needs.</h2>
        <p style={{ ...lead, marginTop: 8 }}>
          A registered CPA reviews every inquiry. You'll get a response within 2 business days with an
          indicative price and the next steps.
        </p>

        {submitted ? (
          <div style={{
            marginTop: 26, padding: 28, borderRadius: 14, background: "#fff",
            border: `1px solid ${C.gold}`, textAlign: "center",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 999, background: C.goldSoft,
              color: C.navy, display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
            }}>
              <CheckCircle2 size={26} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800 }}>Inquiry received.</h3>
            <p style={{ color: C.inkSoft, fontSize: 15, margin: 0 }}>
              Theresia will personally review your details and respond within 2 business days from
              <strong> info@teebeeaccountants.com.pg</strong>. If your matter is urgent, call <strong>+675 300 0000</strong>.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 26, padding: 28, borderRadius: 14, background: "#fff", border: "1px solid #e5e7eb" }}>
            {error && (
              <div style={{
                background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d",
                padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <AlertCircle size={16} /> {error}
              </div>
            )}
            <Row>
              <FormField label="Company / entity name *">
                <input style={input} value={f.company_name} onChange={(e) => set("company_name", e.target.value)} />
              </FormField>
              <FormField label="Fiscal year end">
                <input style={input} type="date" value={f.fy_end} onChange={(e) => set("fy_end", e.target.value)} />
              </FormField>
            </Row>
            <Row>
              <FormField label="Your name *">
                <input style={input} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
              </FormField>
              <FormField label="Your role">
                <input style={input} value={f.entity_type} placeholder="e.g. Director, CFO, Manager" onChange={(e) => set("entity_type", e.target.value)} />
              </FormField>
            </Row>
            <Row>
              <FormField label="Email *">
                <input style={input} type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
              </FormField>
              <FormField label="Phone (PNG)">
                <input style={input} value={f.contact_phone} placeholder="+675 …" onChange={(e) => set("contact_phone", e.target.value)} />
              </FormField>
            </Row>
            <FormField label="Type of audit needed *">
              <select style={input} value={f.audit_type} onChange={(e) => set("audit_type", e.target.value)}>
                <option value="">— choose —</option>
                {AUDIT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </FormField>
            <Row>
              <FormField label="Prior-year revenue (PGK) *">
                <select style={input} value={f.revenue_band} onChange={(e) => set("revenue_band", e.target.value)}>
                  <option value="">— choose —</option>
                  {REVENUE_BANDS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </FormField>
              <FormField label="Number of employees">
                <input style={input} type="number" min="0" value={f.employee_count} onChange={(e) => set("employee_count", e.target.value)} />
              </FormField>
            </Row>
            <FormField label="Anything else we should know? (optional)">
              <textarea style={{ ...input, minHeight: 92 }} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. multi-entity group, last audit was 2023, expecting first-time IFRS adoption, etc." />
            </FormField>
            <button onClick={submit} disabled={!canSubmit || submitting} style={{
              ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 8,
              opacity: !canSubmit || submitting ? 0.5 : 1, cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
            }}>
              {submitting
                ? <><Loader2 size={16} className="tp-spin" style={{ marginRight: 6 }} /> Sending inquiry…</>
                : <>Send inquiry to Tee Bee Accountants <ArrowRight size={16} /></>}
            </button>
            <style>{`@keyframes tp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tp-spin { animation: tp-spin .9s linear infinite; }`}</style>
            <p style={{ fontSize: 11, color: C.muted, margin: "16px 0 0", lineHeight: 1.5 }}>
              By submitting this form you consent to Tee Bee Accountants Ltd contacting you to discuss your audit.
              Your information is held confidentially under our professional obligations as a registered CPA firm.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section style={{ padding: "60px 28px", background: "#fff" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: 0.08, textTransform: "uppercase", marginBottom: 14 }}>
          Tee Bee Accountants Ltd · CPA · 10+ years · 500+ clients
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
        Tee Bee Accountants Ltd · Registered with the PNG Accountants Registration Board ·
        IRC-registered Tax Agent
      </div>
      <div>
        <Link href="/teebee" style={{ color: C.gold, textDecoration: "none" }}>Main site</Link>
        {"  ·  "}
        <Link href="/teebeepay" style={{ color: C.gold, textDecoration: "none" }}>TeebeePay</Link>
        {"  ·  "}
        <Link href="/audit/admin" style={{ color: "#94a3b8", textDecoration: "none" }}>Audit admin</Link>
      </div>
    </footer>
  );
}

/* ─────── reusables ─────── */
const h2: React.CSSProperties = {
  fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.8,
  margin: "12px 0 8px", color: C.ink,
};
const lead: React.CSSProperties = {
  color: C.inkSoft, fontSize: 17, lineHeight: 1.55,
};
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 13px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 14, background: "#fff", color: C.ink, outline: "none",
};

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: 0.08, textTransform: "uppercase" }}>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

/* ─────── structured data ─────── */
function SeoStructuredData() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "Tee Bee Audit — Tee Bee Accountants Ltd",
    description:
      "AI-assisted audit-readiness platform from Tee Bee Accountants. Statutory audits, tax due diligence, audit-readiness reviews, NGO/donor-fund audits, landowner company audits. CPA-signed opinion every time. PNG IRC and ARB compliant.",
    address: { "@type": "PostalAddress", addressLocality: "Port Moresby", addressRegion: "NCD", addressCountry: "PG" },
    areaServed: "PG",
    url: "https://www.curriculate.net/audit",
    provider: { "@type": "Organization", name: "Tee Bee Accountants Ltd" },
    serviceType: ["Audit and assurance", "IFRS compliance audit", "Tax compliance audit", "Audit-readiness review"],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
