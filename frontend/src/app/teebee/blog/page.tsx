// frontend/src/app/teebee/blog/page.tsx — blog index.
"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Calculator, Calendar, UserPlus } from "lucide-react";

const C = {
  ink: "#0a1a2e", inkSoft: "#475569", muted: "#64748b",
  navy: "#0f2c52", gold: "#c9a227", goldSoft: "#fef6dc", cream: "#fbfaf6",
};

const POSTS = [
  {
    slug: "png-swt-fortnightly-tables-2026",
    title: "PNG Salary & Wages Tax: The Fortnightly Tables, Explained",
    lead: "Where the K20,000 tax-free threshold actually comes from, how to read Tables A/B/C, and the math behind every fortnightly deduction.",
    date: "May 2026", readMin: 7,
    icon: <Calculator size={20} />,
  },
  {
    slug: "nasfund-deadlines-2026",
    title: "NASFund Deadlines 2026: Every Employer's Cheat Sheet",
    lead: "Monthly contribution dates, the 21st-of-the-month rule, what you owe if you miss it, and how to file NCSL the painless way.",
    date: "May 2026", readMin: 5,
    icon: <Calendar size={20} />,
  },
  {
    slug: "onboarding-new-employee-png",
    title: "Onboarding a New Employee in PNG: A Step-by-Step Guide",
    lead: "From IRC declaration form to NASFund membership to first pay stub — everything an SME owner needs to do, in order.",
    date: "May 2026", readMin: 6,
    icon: <UserPlus size={20} />,
  },
];

export default function BlogIndex() {
  return (
    <div style={{
      background: "#fff", color: C.ink,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    }}>
      <header style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(8px)", borderBottom: "1px solid #eaeaea",
      }}>
        <nav style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 24px",
          display: "flex", alignItems: "center", gap: 28 }}>
          <Link href="/teebee" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
            <svg width="32" height="32" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="23" fill={C.navy} />
              <text x="24" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill={C.gold}>TBA</text>
            </svg>
            <strong style={{ fontSize: 16 }}>Tee Bee Accountants</strong>
          </Link>
          <div style={{ marginLeft: "auto", display: "flex", gap: 22 }}>
            <Link href="/teebee#services" style={{ color: C.inkSoft, fontSize: 14, textDecoration: "none", fontWeight: 500 }}>Services</Link>
            <Link href="/teebee/blog"     style={{ color: C.navy, fontSize: 14, textDecoration: "none", fontWeight: 600 }}>Blog</Link>
            <Link href="/teebeepay"       style={{ color: C.inkSoft, fontSize: 14, textDecoration: "none", fontWeight: 500 }}>TeebeePay</Link>
            <Link href="/teebee#contact"  style={{ color: "#fff", background: C.navy, padding: "8px 14px",
              borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Get consultation</Link>
          </div>
        </nav>
      </header>

      <section style={{ padding: "72px 24px 36px", background: C.cream }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 0.1, marginBottom: 10 }}>
            TBA Blog
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1, lineHeight: 1.05, margin: 0, fontFamily: "Georgia, serif", color: C.ink }}>
            Plain-English PNG accounting.
          </h1>
          <p style={{ fontSize: 18, color: C.inkSoft, lineHeight: 1.55, margin: "20px 0 0", maxWidth: 700 }}>
            Practical guides to IRC compliance, NASFund filings, payroll, and SME finance —
            written by CPAs who file this stuff for PNG businesses every fortnight.
          </p>
        </div>
      </section>

      <section style={{ padding: "48px 24px 80px", background: "#fff" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 18 }}>
          {POSTS.map((p) => (
            <Link key={p.slug} href={`/teebee/blog/${p.slug}`} style={{
              display: "block", padding: 24, background: "#fff", border: "1px solid #eaeaea",
              borderRadius: 14, textDecoration: "none", color: C.ink, transition: "all .15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.navy; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eaeaea"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 20, alignItems: "start" }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 10, background: C.goldSoft, color: C.navy,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{p.icon}</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.08, marginBottom: 6 }}>
                    {p.date} · {p.readMin} min read
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, fontFamily: "Georgia, serif", margin: "0 0 8px", lineHeight: 1.2 }}>
                    {p.title}
                  </h2>
                  <p style={{ fontSize: 15, color: C.inkSoft, lineHeight: 1.55, margin: 0 }}>{p.lead}</p>
                </div>
                <ArrowRight size={20} color={C.navy} style={{ marginTop: 12 }} />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
