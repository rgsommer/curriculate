// frontend/src/app/teebee/principal/page.tsx
//
// Principal overview — an UNLISTED internal page for Theresia to open before
// client meetings. Not in the public nav, not in the sitemap, noindex. The URL
// is the only gate (no auth yet — to be layered on later if needed).
//
// Server component so it can carry its own noindex metadata. Designed to print
// to ONE A4 page at "fit width". Navy + gold to match /teebee and /audit.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Principal overview",
  description: "Internal platform and pricing overview for Tee Bee Accountants. Unlisted.",
  robots: { index: false, follow: false, nocache: true },
  alternates: {},
};

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
  line: "#e8e6df",
};

type Platform = {
  name: string;
  status: "live" | "soon";
  desc: string;
  target: string;
  fees: string;
  href?: string;
  hrefLabel?: string;
};

const PLATFORMS: Platform[] = [
  {
    name: "TeebeePay",
    status: "live",
    desc: "Web-based fortnightly payroll — pay stubs, BSP batch, NASFund returns, IRC SWT.",
    target: "SMEs running PNG payroll, 5–200 staff.",
    fees: "K9 / employee / fortnight self-service · K14 / employee / fortnight fully managed.",
    href: "/teebeepay",
    hrefLabel: "teebeepay",
  },
  {
    name: "Tee Bee Audit",
    status: "live",
    desc: "AI-assisted audit — reconciliations and anomaly checks, CPA reviews and signs the opinion.",
    target: "Companies needing statutory audits, audit-readiness, or IRC due diligence.",
    fees: "From K5,000 per engagement, scaled to size and complexity.",
    href: "/audit",
    hrefLabel: "audit",
  },
  {
    name: "Taxation",
    status: "soon",
    desc: "Return preparation and lodgement, tax planning, and IRC compliance workflow.",
    target: "Businesses and individuals needing IRC returns and planning.",
    fees: "Pricing to be confirmed.",
  },
  {
    name: "Loan Preparation",
    status: "soon",
    desc: "Assemble lender-ready financial packs from a client's books.",
    target: "SMEs applying for bank or development finance.",
    fees: "Pricing to be confirmed.",
  },
];

type Walk = { name: string; status: "live" | "soon"; href?: string; steps: string };

const WALKTHROUGH: Walk[] = [
  {
    name: "TeebeePay",
    status: "live",
    href: "/teebeepay",
    steps:
      "Sign in with the 6-digit PIN emailed to you, pick a company, then use the tabs along the top: " +
      "Pay periods, Employees, Divisions, Reports — and the new General Ledger (chart of accounts, " +
      "journal entries, trial balance, income statement, balance sheet).",
  },
  {
    name: "Tee Bee Audit",
    status: "live",
    href: "/audit",
    steps:
      "Open the landing page for the pitch, then the working console at /audit/app to run an " +
      "engagement. Manage engagements and review findings at /audit/admin.",
  },
  {
    name: "Taxation · Loan Preparation",
    status: "soon",
    steps:
      "In design — not yet clickable. The accounting data that feeds them already lives in the " +
      "General Ledger, so these slot on top once their workflows are built.",
  },
];

const SETUP_FEES = [
  { size: "Small", note: "sole trader · simple books", fee: "K500" },
  { size: "Medium", note: "multi-staff · several accounts", fee: "K1,000" },
  { size: "Large", note: "complex · multi-entity", fee: "K2,000" },
];

const PRINCIPLES = [
  "No hourly billing.",
  "Fees scale with complexity, not time.",
  "Indicative quotes inside 2 business days.",
  "First conversation is free.",
  "First fortnight free for new TeebeePay clients.",
];

export default function PrincipalOverview() {
  return (
    <div
      style={{
        background: C.cream,
        color: C.ink,
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
        padding: "28px 20px 40px",
      }}
    >
      <PrintStyles />
      <div className="sheet" style={{ maxWidth: 860, margin: "0 auto", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 30px rgba(8,29,58,.06)" }}>
        {/* Header */}
        <header style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`, color: "#fff", padding: "22px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Logo />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "Georgia, serif", letterSpacing: -0.3, lineHeight: 1.1 }}>
                Tee Bee — Principal overview
              </div>
              <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.08, marginTop: 2 }}>
                Platforms · pricing · strategy
              </div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: C.navy, background: C.gold, padding: "5px 11px", borderRadius: 999, whiteSpace: "nowrap" }}>
              Unlisted · internal
            </span>
          </div>
        </header>

        <div style={{ padding: "22px 28px 26px" }}>
          {/* Platforms */}
          <SectionTitle>Our platforms</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="grid-2">
            {PLATFORMS.map((p) => (
              <PlatformCard key={p.name} p={p} />
            ))}
          </div>

          {/* See it for yourself */}
          <SectionTitle>See it for yourself</SectionTitle>
          <p style={subtle}>Open these on any browser — sign in is by emailed PIN, nothing to install.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {WALKTHROUGH.map((w) => (
              <WalkRow key={w.name} w={w} />
            ))}
          </div>

          {/* Setup fees */}
          <SectionTitle>Setup fees</SectionTitle>
          <p style={subtle}>One-time onboarding charge per client, by size.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }} className="grid-3">
            {SETUP_FEES.map((s) => (
              <div key={s.size} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", background: C.cream }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{s.size}</span>
                  <span style={{ fontWeight: 800, fontSize: 18, color: C.navy, fontFamily: "Georgia, serif" }}>{s.fee}</span>
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.note}</div>
              </div>
            ))}
          </div>

          {/* Implementation strategy */}
          <SectionTitle>Implementation strategy</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            <Strategy step="Start" body="Put one client on each platform to prove the workflow end-to-end before scaling. Keep the first engagements close and hands-on." />
            <Strategy step="Grow" body="Cross-sell existing TBA clients into the platforms they don't yet use — an audit client onto TeebeePay, a payroll client into taxation — so each relationship deepens." />
            <Strategy step="Scale" body="Once steady-state reaches roughly ten platform clients, hire one additional bookkeeper to absorb the recurring work and protect service quality." />
          </div>

          {/* Pricing principles */}
          <SectionTitle>Pricing principles</SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {PRINCIPLES.map((p) => (
              <li key={p} style={{ fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5 }}>{p}</li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <footer style={{ borderTop: `1px solid ${C.line}`, background: C.cream, padding: "16px 28px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Theresia Bob</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Principal (CPA) · Tee Bee Accountants Ltd</div>
          <div style={{ fontSize: 12, color: C.navy, background: C.goldSoft, border: `1px solid ${C.gold}`, borderRadius: 8, padding: "8px 12px", display: "inline-block" }}>
            This page is unlisted. Share the URL only with people you trust.
          </div>
        </footer>
      </div>
    </div>
  );
}

function PlatformCard({ p }: { p: Platform }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", background: p.status === "soon" ? C.cream : C.paper, opacity: p.status === "soon" ? 0.92 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{p.name}</span>
        {p.status === "soon" ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, background: "#eef0f3", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase", letterSpacing: 0.06 }}>Coming soon</span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", background: "#dcfce7", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase", letterSpacing: 0.06 }}>Live</span>
        )}
      </div>
      <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>{p.desc}</div>
      <Row label="Client">{p.target}</Row>
      <Row label="Fees">{p.fees}</Row>
      {p.href && (
        <Link href={p.href} style={{ fontSize: 12, fontWeight: 700, color: C.navy, textDecoration: "none", display: "inline-block", marginTop: 8 }}>
          curriculate.net/{p.hrefLabel} →
        </Link>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 0.06, minWidth: 44, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

function WalkRow({ w }: { w: Walk }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px", background: w.status === "soon" ? C.cream : C.paper }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: w.status === "soon" ? C.muted : "#fff", background: w.status === "soon" ? "#eef0f3" : C.navy, borderRadius: 7, padding: "4px 10px", minWidth: 110, textAlign: "center", flexShrink: 0 }}>
        {w.name}
      </span>
      <span style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>
        {w.href && (
          <Link href={w.href} style={{ fontWeight: 700, color: C.navy, textDecoration: "none", marginRight: 6 }}>
            curriculate.net{w.href}
          </Link>
        )}
        {w.steps}
      </span>
    </div>
  );
}

function Strategy({ step, body }: { step: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: C.navy, borderRadius: 7, padding: "4px 10px", minWidth: 54, textAlign: "center", flexShrink: 0 }}>{step}</span>
      <span style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>{body}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 13, fontWeight: 800, color: C.gold, textTransform: "uppercase", letterSpacing: 0.12, margin: "20px 0 10px", borderBottom: `1px solid ${C.line}`, paddingBottom: 6 }}>
      {children}
    </h2>
  );
}

const subtle: React.CSSProperties = { fontSize: 12.5, color: C.muted, margin: "0 0 10px" };

function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="#fff" />
      <text x="24" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill={C.navy}>TBA</text>
    </svg>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media (max-width: 720px) {
        .grid-2 { grid-template-columns: 1fr !important; }
        .grid-3 { grid-template-columns: 1fr !important; }
      }
      @media print {
        body { background: #fff !important; }
        .sheet { box-shadow: none !important; border: none !important; }
        @page { size: A4 portrait; margin: 12mm; }
      }
    `}</style>
  );
}
