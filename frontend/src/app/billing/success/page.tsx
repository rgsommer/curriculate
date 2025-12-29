"use client";

import React from "react";

export default function BillingSuccessPage() {
  return (
    <main style={{ padding: 20 }}>
      <h1>Payment successful</h1>
      <p>Your plan will update shortly.</p>
      <a href="/my-plan" style={{ fontWeight: 800 }}>
        Go to My Plan
      </a>
    </main>
  );
}
