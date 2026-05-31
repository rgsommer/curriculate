// Shared visual shell for /teebee/blog posts — keeps the firm branding
// without duplicating the full nav for every post.
"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

const C = {
  ink: "#0a1a2e", inkSoft: "#475569", muted: "#64748b",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6dc", cream: "#fbfaf6",
};

export function BlogPost({
  title, lead, dateLabel, readMin, children,
}: {
  title: string; lead?: string; dateLabel: string; readMin: number; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: "#fff", color: C.ink,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    }}>
      <BlogTopBar />
      <article style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px 80px" }}>
        <Link href="/teebee/blog" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: C.navy, fontSize: 14, fontWeight: 600, textDecoration: "none", marginBottom: 28,
        }}>
          <ArrowLeft size={14} /> Back to all articles
        </Link>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.gold,
          textTransform: "uppercase", letterSpacing: 0.1, marginBottom: 12 }}>
          {dateLabel} · {readMin} min read
        </div>
        <h1 style={{
          fontSize: 42, fontWeight: 800, fontFamily: "Georgia, serif",
          letterSpacing: -0.8, lineHeight: 1.1, margin: "0 0 18px", color: C.ink,
        }}>
          {title}
        </h1>
        {lead && (
          <p style={{ fontSize: 19, color: C.inkSoft, lineHeight: 1.55, margin: "0 0 32px" }}>
            {lead}
          </p>
        )}
        <div style={{ borderTop: `1px solid ${C.goldSoft}`, paddingTop: 26 }} className="tba-prose">
          {children}
        </div>
        <CtaCard />
      </article>
      <style>{`
        .tba-prose h2 { font-family: Georgia, serif; font-size: 26px; font-weight: 700; letter-spacing: -0.4px;
                        margin: 38px 0 12px; color: ${C.ink}; line-height: 1.2; }
        .tba-prose h3 { font-size: 18px; font-weight: 700; margin: 26px 0 8px; color: ${C.ink}; }
        .tba-prose p  { font-size: 16px; line-height: 1.7; color: ${C.inkSoft}; margin: 0 0 16px; }
        .tba-prose ul, .tba-prose ol { font-size: 16px; line-height: 1.7; color: ${C.inkSoft};
                                         margin: 0 0 16px; padding-left: 22px; }
        .tba-prose li { margin-bottom: 6px; }
        .tba-prose strong { color: ${C.ink}; font-weight: 700; }
        .tba-prose table { width: 100%; border-collapse: collapse; margin: 18px 0 22px; font-size: 14px; }
        .tba-prose th, .tba-prose td { padding: 9px 12px; border-bottom: 1px solid #eee; text-align: left; }
        .tba-prose th { background: ${C.cream}; font-weight: 700; color: ${C.ink}; }
        .tba-prose code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
        .tba-prose blockquote { border-left: 4px solid ${C.gold}; padding: 8px 16px; margin: 18px 0;
                                  color: ${C.ink}; background: ${C.cream}; border-radius: 0 8px 8px 0; }
      `}</style>
    </div>
  );
}

function BlogTopBar() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)",
      borderBottom: "1px solid #eaeaea",
    }}>
      <nav style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 28 }}>
        <Link href="/teebee" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
          <svg width="32" height="32" viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill={C.navy} />
            <text x="24" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill={C.gold}>TBA</text>
          </svg>
          <strong style={{ fontSize: 16 }}>TeeBee Accountants</strong>
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
  );
}

function CtaCard() {
  return (
    <div style={{
      marginTop: 48, padding: 26, borderRadius: 14,
      background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`,
      color: "#fff",
    }}>
      <div style={{ fontSize: 12, color: C.gold, fontWeight: 700, letterSpacing: 0.08, textTransform: "uppercase", marginBottom: 8 }}>
        Help with this?
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "Georgia, serif" }}>
        TeeBee Accountants does this every fortnight for SMEs across PNG.
      </h3>
      <p style={{ fontSize: 14, color: "rgba(255,255,255,.85)", lineHeight: 1.55, margin: "0 0 16px" }}>
        We are CPA-certified and registered tax agents with the IRC. Payroll, NASFund returns, audit, year-end —
        all under one roof.
      </p>
      <Link href="/teebee#contact" style={{
        display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: 8,
        background: C.gold, color: C.navy, fontWeight: 700, fontSize: 14, textDecoration: "none",
      }}>
        Book a free consultation <ArrowRight size={16} style={{ marginLeft: 6 }} />
      </Link>
    </div>
  );
}
