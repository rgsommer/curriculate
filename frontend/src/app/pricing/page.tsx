"use client";

import React, { useEffect, useMemo, useState } from "react";

// Prefer NEXT_PUBLIC_API_BASE, fallback to production API.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api.curriculate.net";

async function consumeHandoff(handoffCode: string) {
  const res = await fetch(`${API_BASE}/api/billing/handoff/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ handoffCode }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Handoff failed (${res.status})`);
  return data;
}

async function startCheckout(args: { plan: string; priceId?: string | null; returnTo: string | null; email?: string | null }) {
  const { plan, priceId, returnTo, email } = args;
  
  // Persist returnTo across the Stripe redirect
  if (typeof window !== "undefined") {
    if (returnTo) localStorage.setItem("billing:returnTo", returnTo);
    else localStorage.removeItem("billing:returnTo");
  }

  const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      plan,
      priceId: priceId || undefined,
      email: email || undefined, // ✅ add
      successUrl: `${window.location.origin}/billing/success`,
      cancelUrl: `${window.location.origin}/pricing`,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Checkout failed (${res.status})`);
  if (!data?.url) throw new Error("Stripe did not return a checkout URL");
  window.location.href = data.url;
}

async function openPortal(returnUrl: string) {
  const res = await fetch(`${API_BASE}/api/stripe/create-portal-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ returnUrl }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Portal failed (${res.status})`);
  if (!data?.url) throw new Error("Stripe did not return a portal URL");
  window.location.href = data.url;
}

const PRICES = {
  TEACHER_PLUS_MONTHLY: "price_1SjgbNLduAaZuYj5Y8h138iq",
  TEACHER_PRO_MONTHLY: "price_1SjganLduAaZuYj5e0YozeDy",
  SCHOOL_PLUS_YEARLY: "price_1SjgbuLduAaZuYj5qy8o6OSR",
  SCHOOL_PRO_YEARLY: "price_1SjgcTLduAaZuYj5LlaHf5M9",
};

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [billingEmail, setBillingEmail] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const handoff = url.searchParams.get("handoff");
    const rt = url.searchParams.get("returnTo");
    setReturnTo(rt);

    if (!handoff) return;

    setLoading(true);
    setNotice("Signing you in for billing…");

    consumeHandoff(handoff)
      .then(() => {
        url.searchParams.delete("handoff");
        window.history.replaceState({}, "", url.toString());
        setNotice(null);
      })
      .catch((e) => {
        setNotice(e?.message || "Failed to start billing session.");
      })
      .finally(() => setLoading(false));
  }, []);

  const plans = useMemo(
    () => [
      {
        key: "teacher_plus",
        title: "Teacher Plus",
        price: "$6.99 CAD / month",
        bullets: ["Student-level reporting", "PDF exports", "Great for small-group or class sessions"],
        priceId: PRICES.TEACHER_PLUS_MONTHLY,
        // IMPORTANT: this is what your backend likely expects
        plan: "TEACHER_PLUS",
      },
      {
        key: "teacher_pro",
        title: "Teacher Pro",
        price: "$12.99 CAD / month",
        featured: true,
        bullets: ["Higher student limits than Plus", "Expanded AI task generation", "Advanced student and session reports", "Built for full classrooms and multiple classes"],
        priceId: PRICES.TEACHER_PRO_MONTHLY,
        plan: "TEACHER_PRO",
      },
      {
        key: "school_plus",
        title: "School Plus",
        price: "$399 CAD / year",
        bullets: ["School-wide deployment", "Student-level reporting", "PDF exports"],
        priceId: PRICES.SCHOOL_PLUS_YEARLY,
        plan: "SCHOOL_PLUS",
      },
      {
        key: "school_pro",
        title: "School Pro",
        price: "$599 CAD / year",
        bullets: ["Higher capacity than School Plus", "Expanded AI task generation", "Advanced reporting & analytics"],
        priceId: PRICES.SCHOOL_PRO_YEARLY,
        plan: "SCHOOL_PRO",
      },
    ],
    []
  );

  const manageReturnUrl = useMemo(() => {
    const u = new URL("https://www.curriculate.net/pricing");
    if (returnTo) u.searchParams.set("returnTo", returnTo);
    return u.toString();
  }, [returnTo]);

  return (
    <main style={{ padding: 18, maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: -0.4 }}>Curriculate Plans</h1>
          <div style={{ opacity: 0.78, marginTop: 6 }}>
            Checkout begins here on <b>www.curriculate.net</b>. Teachers are redirected from <b>set.curriculate.net</b>.
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            try {
              setLoading(true);
              setNotice(null);
              await openPortal(manageReturnUrl);
            } catch (e: any) {
              setNotice(e?.message || "Could not open billing portal.");
            } finally {
              setLoading(false);
            }
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 900,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          }}
        >
          Manage billing
        </button>
      </div>

      {notice && (
        <div style={{ marginTop: 12, border: "1px solid #e5e7eb", background: "#fff", borderRadius: 16, padding: 12 }}>
          {notice}
        </div>
      )}

      <div style={{ marginTop: 14, border: "1px solid #e5e7eb", background: "#fff", borderRadius: 16, padding: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Get started</div>
        <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 10 }}>
          If you’re not signed in yet, enter your email to start checkout.
        </div>
        <input
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          placeholder="you@school.ca"
          type="email"
          autoComplete="email"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            outline: "none",
            fontSize: 14,
          }}
        />
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 12 }}>
        {plans.map((p) => (
          <div
            key={p.key}
            style={{
              border: p.featured ? "2px solid #0ea5e9" : "1px solid #e5e7eb",
              borderRadius: 18,
              padding: 14,
              background: p.featured ? "linear-gradient(180deg, rgba(14,165,233,0.08), rgba(255,255,255,1))" : "#fff",
              boxShadow: p.featured ? "0 18px 44px rgba(14,165,233,0.16)" : "0 10px 28px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>{p.title}</div>
              {p.featured && (
                <div style={{ fontSize: 11, fontWeight: 950, padding: "4px 8px", borderRadius: 999, background: "#0ea5e9", color: "#fff" }}>
                  Best value
                </div>
              )}
            </div>

            <div style={{ opacity: 0.85, marginTop: 6, fontWeight: 800 }}>{p.price}</div>

            <ul style={{ margin: "12px 0 0 18px", padding: 0 }}>
              {p.bullets.map((b) => (
                <li key={b} style={{ marginBottom: 7, opacity: 0.95 }}>
                  {b}
                </li>
              ))}
            </ul>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                try {
                  setLoading(true);
                  setNotice(null);
                  await startCheckout({ plan: p.plan, priceId: p.priceId, returnTo, email: billingEmail.trim() || null });
                } catch (e: any) {
                  setNotice(e?.message || "Checkout failed.");
                } finally {
                  setLoading(false);
                }
              }}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 999,
                border: p.featured ? "1px solid #0ea5e9" : "1px solid #e5e7eb",
                background: p.featured ? "#0ea5e9" : "#fff",
                color: p.featured ? "#fff" : "#111827",
                cursor: "pointer",
                fontWeight: 950,
                opacity: loading ? 0.75 : 1,
              }}
            >
              Start checkout
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, opacity: 0.75, fontSize: 13 }}>
        Need invoices, cancellations, or plan changes? Use <b>Manage billing</b> (Stripe customer portal).
      </div>
    </main>
  );
}
