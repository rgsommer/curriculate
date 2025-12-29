"use client";

import React, { useEffect, useState } from "react";

export default function BillingSuccessPage() {
  const [msg, setMsg] = useState("Payment complete. Finalizing…");

  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    setMsg(sessionId ? "Payment complete. Your plan will update shortly." : "Payment complete.");
  }, []);

  return (
    <main style={{ padding: 18, maxWidth: 820, margin: "0 auto" }}>
      <h1>Success</h1>
      <p>{msg}</p>
      <a href="/my-plan" style={{ fontWeight: 900 }}>Go to My Plan</a>
    </main>
  );
}
