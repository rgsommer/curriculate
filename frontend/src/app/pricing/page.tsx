"use client";

import React, { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "https://api.curriculate.net";

async function consumeHandoff(handoffCode: string) {
  const res = await fetch(`${API_BASE}/api/billing/handoff/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ handoffCode }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Handoff failed");
}

async function startCheckout(priceId: string) {
  const res = await fetch(
    `${API_BASE}/api/stripe/create-checkout-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ priceId }),
    }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || "Checkout failed");
  }

  window.location.href = data.url;
}

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const handoff = url.searchParams.get("handoff");
    if (!handoff) return;

    setNotice("Signing you in for billing…");
    setLoading(true);

    consumeHandoff(handoff)
      .then(() => {
        url.searchParams.delete("handoff");
        window.history.replaceState({}, "", url.toString());
        setNotice(null);
      })
      .catch((e) =>
        setNotice(e?.message || "Failed to start billing session.")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>Pricing</h1>

      {notice && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            padding: 12,
            borderRadius: 12,
            marginBottom: 12,
          }}
        >
          {notice}
        </div>
      )}

      <button
        disabled={loading}
        onClick={() =>
          startCheckout("price_XXXXXXXXXXXX") // ← replace with real price ID
        }
        style={{
          padding: "12px 16px",
          borderRadius: 999,
          fontWeight: 900,
        }}
      >
        Start checkout
      </button>
    </main>
  );
}
