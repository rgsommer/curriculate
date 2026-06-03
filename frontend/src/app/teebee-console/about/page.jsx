// /teebee-console/about — a Principal-facing reference of everything the TeeBee
// suite can do, one section per app plus the cross-app console. Static content
// (no data fetch); linked from the console header.
"use client";

import React from "react";
import Link from "next/link";
import { ClipboardCheck, Calculator, Landmark, FileText, Gauge, CheckCircle2, ArrowLeft } from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", navy: "#0f2c52", gold: "#c9a227", goldSoft: "#fef6d8",
  line: "#e5e7eb", green: "#16a34a",
};

const APPS = [
  {
    key: "audit", Icon: ClipboardCheck, name: "TeeBee Audit", href: "/audit/admin",
    tagline: "Run an audit engagement end to end, with the document grind automated.",
    features: [
      "Full engagement lifecycle: inquiry → engaged → active → review → delivered",
      "Public intake form feeding an admin queue — or add a client directly in one click",
      "Invite clients to a secure, passwordless portal to upload their documents",
      "Document checklist tailored to the audit type (statutory, readiness, donor-funded, landowner, compliance)",
      "Drop a whole folder — each file auto-files into the right checklist slot by its name",
      "Analysis runs automatically once the trial balance and general ledger are in",
      "Automated checks: TB balances, TB-vs-GL reconciliation, round-number & weekend-posting flags, duplicate amounts",
      "Findings graded by severity, reviewed and signed off by a CPA",
      "Planning workspace: materiality (expenditure basis for NFPs), risk register, working papers",
      "Drafts an executive summary and a client cover letter from the engagement — yours to edit and sign off",
      "One-click audit report PDF — checklist status, findings, summary, sign-off block",
    ],
  },
  {
    key: "tax", Icon: Calculator, name: "TeeBee Tax", href: "/teebee-tax/app",
    tagline: "Prepare, review and file PNG tax returns with the figures computed for you.",
    features: [
      "Three return types: Company Income Tax, Individual Income Tax, GST",
      "Built-in tax engine at IRC statutory rates — CIT reconciliation, individual marginal brackets, GST output/input",
      "Sign-off ladder: draft → prepared → reviewed → filed, with separate preparer & reviewer and an IRC reference on filing",
      "Supporting-document upload with auto-filing (financials, schedules, workings)",
      "Drafts a plain-English return summary and a client cover letter, ready to review and send",
      "One-click tax return PDF",
    ],
  },
  {
    key: "loans", Icon: Landmark, name: "TeeBee Loans", href: "/teebee-loans/app",
    tagline: "Score a client's loan readiness and assemble a lender-ready package.",
    features: [
      "Readiness scoring on the ratios a PNG lender underwrites: current & quick ratio, debt-to-equity, margin, ROA, DSCR, LTV",
      "A 0–100 readiness score with concrete strengths and gaps",
      "Pipeline: intake → assessed → package-ready → submitted",
      "Lender package-document checklist",
      "Drafts a narrative credit summary and a lender cover letter for the package",
      "One-click financing-package PDF",
    ],
  },
  {
    key: "payroll", Icon: FileText, name: "TeebeePay — Accounting & Payroll", href: "/teebeepay/app",
    tagline: "Fortnightly payroll and a real set of books behind it.",
    features: [
      "Fortnightly payroll: pay stubs, BSP batch file, NASFund/NCSL, IRC SWT",
      "Real double-entry General Ledger: chart of accounts, journal entries, trial balance, income statement, balance sheet",
      "Accounts Receivable / invoicing: draft → issue → pay → aging, GST-aware",
      "Payroll posts straight into the ledger; AR posts its own journal entries",
      "Approvals including approve-via-email magic link, with a full audit log",
    ],
  },
];

const CONSOLE_FEATURES = [
  "One dashboard across every product — activity per app and progress per company through its stages",
  "Post progress updates and request outstanding documents from clients, on any process",
  "Upload a client's required documents and watch the requirement tick off automatically",
  "Superuser sees all activity; a Principal sees the firm's client work plus their own books",
];

export default function TeeBeeAboutPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f7f8fa", color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/teebee-console" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#cbd5e1", textDecoration: "none", fontSize: 13 }}>
          <ArrowLeft size={14} /> Console
        </Link>
        <div style={{ width: 1, height: 22, background: "#3a526b" }} />
        <strong style={{ fontSize: 16 }}>What these apps do</strong>
      </header>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px 64px" }}>
        <p style={{ fontSize: 15, color: C.inkSoft, lineHeight: 1.6, margin: "0 0 28px", maxWidth: 720 }}>
          The TeeBee suite is four connected products plus a console that ties them together. Everything below is live.
          Click any title to open it.
        </p>

        <div style={{ display: "grid", gap: 18 }}>
          {APPS.map((a) => (
            <section key={a.key} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", background: C.goldSoft, borderBottom: `1px solid #f1e7c4` }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: C.navy, color: C.gold,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <a.Icon size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={a.href} style={{ fontSize: 18, fontWeight: 800, color: C.navy, textDecoration: "none" }}>{a.name} →</Link>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 2 }}>{a.tagline}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.05,
                  padding: "3px 9px", borderRadius: 99, background: "#dcfce7", color: "#14532d", flexShrink: 0 }}>Live</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: "16px 22px", display: "grid", gap: 9 }}>
                {a.features.map((f, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5 }}>
                    <CheckCircle2 size={15} color={C.green} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/* Cross-app console */}
          <section style={{ background: C.navy, color: "#fff", border: "none", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: C.gold, color: C.navy,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Gauge size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <Link href="/teebee-console" style={{ fontSize: 18, fontWeight: 800, color: "#fff", textDecoration: "none" }}>TeeBee Console →</Link>
                <div style={{ fontSize: 13, color: "#9fb3cc", marginTop: 2 }}>Your command centre across all four products.</div>
              </div>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: "0 22px 18px", display: "grid", gap: 9 }}>
              {CONSOLE_FEATURES.map((f, i) => (
                <li key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, color: "#cdd9e8", lineHeight: 1.5 }}>
                  <CheckCircle2 size={15} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p style={{ fontSize: 12, color: C.muted, marginTop: 28, textAlign: "center" }}>
          TeeBee Accountants Ltd · internal reference for firm staff
        </p>
      </div>
    </main>
  );
}
