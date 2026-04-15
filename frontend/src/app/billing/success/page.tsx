"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WalkthroughModal, { isWalkthroughDismissed } from "../../../components/WalkthroughModal";

export default function BillingSuccessPage() {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  useEffect(() => {
    const rt =
      typeof window !== "undefined"
        ? localStorage.getItem("billing:returnTo")
        : null;
    setReturnTo(rt);

    // Auto-open once per browser (unless dismissed)
    if (!isWalkthroughDismissed()) setWalkthroughOpen(true);
  }, []);

  const teacherAppLink = useMemo(() => {
    if (!returnTo) return "https://set.curriculate.net";
    try {
      const u = new URL(returnTo);
      if (u.hostname === "set.curriculate.net") return u.toString();
      return "https://set.curriculate.net";
    } catch {
      return "https://set.curriculate.net";
    }
  }, [returnTo]);

  return (
    <main style={{ padding: 18, maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Payment successful</h1>
      <p style={{ opacity: 0.8 }}>
        Thanks! Your Curriculate plan will update shortly. You can now return to
        your Teacher session.
      </p>

      {/* Next steps */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/demo"
          className="flex flex-col items-start rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md"
        >
          <div className="text-sm font-bold text-gray-900">
            Try a Live Demo
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Jump straight into a ready-made session and see it in action.
          </div>
        </Link>

        <button
          type="button"
          onClick={() => setWalkthroughOpen(true)}
          className="flex flex-col items-start rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm transition hover:shadow-md text-left"
        >
          <div className="text-sm font-bold text-gray-900">
            60-second walkthrough
          </div>
          <div className="mt-1 text-sm text-gray-600">
            A guided tour — setup, stations, devices, and reports.
          </div>
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <a
          href={teacherAppLink}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid #0ea5e9",
            background: "#0ea5e9",
            color: "#fff",
            fontWeight: 950,
            textDecoration: "none",
          }}
        >
          Return to TeacherApp
        </a>

        <a
          href="/pricing"
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#111827",
            fontWeight: 900,
            textDecoration: "none",
          }}
        >
          Back to pricing
        </a>
      </div>

      <div style={{ marginTop: 14, opacity: 0.7, fontSize: 13 }}>
        If you opened billing from TeacherApp, the return button should take you
        back to the session you were on.
      </div>

      {/* ✅ The walkthrough modal actually renders here */}
      <WalkthroughModal
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />
    </main>
  );
}
