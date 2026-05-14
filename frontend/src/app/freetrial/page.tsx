"use client";

import React from "react";

const PRICES = {
  TEACHER_PLUS_MONTHLY: "price_1SjgbNLduAaZuYj5Y8h138iq",
  TEACHER_PRO_MONTHLY: "price_1SjganLduAaZuYj5e0YozeDy",
  SCHOOL_PLUS_YEARLY: "price_1SjgbuLduAaZuYj5qy8o6OSR",
  SCHOOL_PRO_YEARLY: "price_1SjgcTLduAaZuYj5LlaHf5M9",
};

export default function FreeTrialPage() {
  const [status, setStatus] = React.useState<"idle" | "loading" | "error" | "used">("idle");

  const [billingEmail, setBillingEmail] = React.useState("");

  async function startTrial() {
    try {
      setStatus("loading");

      // Prefer NEXT_PUBLIC_API_BASE, fallback to production API.
      const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api.curriculate.net";

      if (!billingEmail.trim()) {
        setStatus("error");
        return;
      }

      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          plan: "TEACHER_PRO_TRIAL", // ✅ this is the key
          priceId: PRICES.TEACHER_PRO_MONTHLY,
          email: billingEmail.trim(),
          successUrl: `${window.location.origin}/billing/success`,
          // Cancel routes back to this same page.  Previously typoed
          // as /free-trial (with hyphen) which 404s — Next.js route
          // lives at /freetrial.
          cancelUrl: `${window.location.origin}/freetrial`,
        }),
      });

      if (res.status === 409) {
        setStatus("used");
        return;
      }

      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}

      if (!res.ok || !data?.url) {
        console.error("Stripe checkout error:", {
          status: res.status,
          raw,
          data,
          apiBase: API_BASE,
        });
        throw new Error(data?.error || raw || `Checkout failed (${res.status})`);
      }

      window.location.href = data.url;
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px 16px",
        background: "radial-gradient(circle at top, #0f172a, #020617)",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 900, marginBottom: 12, color: "#ffffff" }}>
          Start Your Free Trial
        </h1>

        <p style={{ opacity: 0.9, fontSize: "1.05rem", marginBottom: 28 }}>
          Experience <strong>Curriculate</strong> exactly as your students will — interactive tasks, live teamwork, and
          zero prep headaches.
        </p>

        <ul style={{ lineHeight: 1.6, marginBottom: 18, paddingLeft: 18 }}>
          <li>✔ Full Pro features for 30 days</li>
          <li>✔ $0 today</li>
          <li>✔ After 30 days, automatically reverts to Free (upgrade anytime)</li>
          <li>✔ Works instantly — no install</li>
        </ul>

        <div style={{ marginBottom: 12 }}>
          <input
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="you@school.ca"
            type="email"
            autoComplete="email"
            style={{
              width: "100%",
              maxWidth: 420,
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "rgba(2,6,23,0.2)",
              color: "#e5e7eb",
              outline: "none",
            }}
          />
        </div>

        <button
          onClick={startTrial}
          disabled={status === "loading"}
          style={{
            display: "inline-block",
            padding: "14px 22px",
            borderRadius: 999,
            background:
              status === "loading"
                ? "rgba(148,163,184,0.35)"
                : "linear-gradient(135deg, rgba(34,197,94,0.85), rgba(14,165,233,0.85))",
            color: "#fff",
            fontWeight: 900,
            border: "none",
            cursor: status === "loading" ? "not-allowed" : "pointer",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          {status === "loading" ? "Starting…" : "Start Free Trial →"}
        </button>

        {status === "used" && (
          <p style={{ marginTop: 14, color: "#fbbf24", fontWeight: 800 }}>
            This account has already used its free trial. You can still start on the Free plan and upgrade anytime.
          </p>
        )}

        {status === "error" && (
          <p style={{ marginTop: 14, color: "#fb7185", fontWeight: 800 }}>
            Load failed. Please try again — or go to Pricing to start checkout.
          </p>
        )}

        <div style={{ marginTop: 14 }}>
          <a href="/pricing" style={{ color: "#93c5fd", fontWeight: 800, textDecoration: "none" }}>
            View plans instead →
          </a>
        </div>
      </div>
    </main>
  );
}
