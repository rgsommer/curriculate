"use client";

import React, { useEffect, useState } from "react";

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

async function startCheckout(priceId: string) {
  const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ priceId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Checkout failed (${res.status})`);
  if (!data?.url) throw new Error("Stripe did not return a checkout URL");
  window.location.href = data.url;
}

async function openPortal(returnUrl?: string) {
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

  useEffect(() => {
    const url = new URL(window.location.href);
    const handoff = url.searchParams.get("handoff");
    if (!handoff) return;

    setLoading(true);
    setNotice("Signing you in for billing…");

    consumeHandoff(handoff)
      .then(() => {
        url.searchParams.delete("handoff");
        window.history.replaceState({}, "", url.toString());
        setNotice(null);
      })
      .catch((e) => setNotice(e?.message || "Failed to start billing session."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 10px 0" }}>Pricing</h1>

      {notice && (
        <div style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 14, padding: 12, marginBottom: 12 }}>
          {notice}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <PlanCard
          title="Teacher Plus"
          price="$6.99 CAD / month"
          bullets={["Student-level reporting", "PDF exports"]}
          disabled={loading}
          onSelect={async () => {
            try { setLoading(true); await startCheckout(PRICES.TEACHER_PLUS_MONTHLY); }
            catch (e: any) { setNotice(e?.message || "Checkout failed."); }
            finally { setLoading(false); }
          }}
        />
        <PlanCard
          title="Teacher Pro"
          price="$12.99 CAD / month"
          bullets={[
            "Higher student limits than Plus",
            "Expanded AI task generation",
            "Advanced student and session reports",
            "Designed for full classrooms and multiple classes",
          ]}
          featured
          disabled={loading}
          onSelect={async () => {
            try { setLoading(true); await startCheckout(PRICES.TEACHER_PRO_MONTHLY); }
            catch (e: any) { setNotice(e?.message || "Checkout failed."); }
            finally { setLoading(false); }
          }}
        />
      </div>

      <div style={{ height: 12 }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <PlanCard
          title="School Plus"
          price="$399 CAD / year"
          bullets={["School-wide deployment", "Student-level reporting", "PDF exports"]}
          disabled={loading}
          onSelect={async () => {
            try { setLoading(true); await startCheckout(PRICES.SCHOOL_PLUS_YEARLY); }
            catch (e: any) { setNotice(e?.message || "Checkout failed."); }
            finally { setLoading(false); }
          }}
        />
        <PlanCard
          title="School Pro"
          price="$599 CAD / year"
          bullets={["Higher capacity than School Plus", "Expanded AI task generation", "Advanced reporting & analytics"]}
          disabled={loading}
          onSelect={async () => {
            try { setLoading(true); await startCheckout(PRICES.SCHOOL_PRO_YEARLY); }
            catch (e: any) { setNotice(e?.message || "Checkout failed."); }
            finally { setLoading(false); }
          }}
        />
      </div>

      <div style={{ height: 18 }} />

      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          try { setLoading(true); await openPortal(window.location.href); }
          catch (e: any) { setNotice(e?.message || "Could not open billing portal."); }
          finally { setLoading(false); }
        }}
        style={{ padding: "10px 14px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 800 }}
      >
        Manage billing (cancel/downgrade)
      </button>
    </main>
  );
}

function PlanCard({
  title, price, bullets, onSelect, featured, disabled,
}: {
  title: string;
  price: string;
  bullets: string[];
  onSelect: () => void;
  featured?: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ border: featured ? "2px solid #0ea5e9" : "1px solid #e5e7eb", borderRadius: 18, padding: 14, background: "#fff" }}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
      <div style={{ opacity: 0.8, marginTop: 4 }}>{price}</div>
      <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
        {bullets.map((b) => (<li key={b} style={{ marginBottom: 6 }}>{b}</li>))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        style={{
          marginTop: 12,
          width: "100%",
          padding: "10px 12px",
          borderRadius: 999,
          border: featured ? "1px solid #0ea5e9" : "1px solid #e5e7eb",
          background: featured ? "#0ea5e9" : "#fff",
          color: featured ? "#fff" : "#111",
          cursor: "pointer",
          fontWeight: 900,
        }}
      >
        Start checkout
      </button>
    </div>
  );
}
