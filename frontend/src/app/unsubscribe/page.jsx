// frontend/src/app/unsubscribe/page.jsx
//
// Public, no-auth unsubscribe page. Reached from the footer of every blast
// email: <https://www.curriculate.net/unsubscribe?email=<encoded-email>>.
// Confirms the recipient's email, posts to the backend, displays a friendly
// success state.

"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

function UnsubscribeInner() {
  const params = useSearchParams();
  const initialEmail = decodeURIComponent(params?.get("email") || "");
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState("idle"); // idle / sending / done / error
  const [errorMsg, setErrorMsg] = useState("");

  // If the email arrived in the URL, auto-confirm after a short pause so
  // the user sees what they're unsubscribing — then clicks the button.
  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  async function unsubscribe() {
    if (!email || !email.includes("@")) {
      setStatus("error");
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(`${API}/admin/blast/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) { setStatus("done"); }
      else { setStatus("error"); setErrorMsg(j.error || `Request failed (${res.status}).`); }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Network error");
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "60px auto", padding: "0 24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1e293b", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>Unsubscribe</h1>

      {status === "done" ? (
        <div style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Removed</div>
          <div>{email} won't receive any more email from Curriculate. If you had been queued for an upcoming send, that's been cancelled too.</div>
          <div style={{ marginTop: 12, fontSize: 14, color: "#475569" }}>
            Apologies for the noise. If this was a mistake, just reply to any prior email and we'll restore you.
          </div>
        </div>
      ) : (
        <>
          <p style={{ color: "#475569", margin: "0 0 18px" }}>
            We'll stop emailing this address immediately. Any sends already queued for you will be cancelled.
          </p>
          <label style={{ display: "block", fontSize: 13, color: "#64748b", marginBottom: 6 }}>Your email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 16, boxSizing: "border-box" }}
            disabled={status === "sending"}
          />
          <button
            onClick={unsubscribe}
            disabled={status === "sending" || !email}
            style={{
              marginTop: 14, padding: "10px 18px", borderRadius: 8, border: 0,
              background: status === "sending" ? "#94a3b8" : "#dc2626",
              color: "#fff", fontWeight: 700, fontSize: 15,
              cursor: status === "sending" ? "wait" : "pointer",
            }}
          >
            {status === "sending" ? "Removing…" : "Unsubscribe me"}
          </button>
          {status === "error" && (
            <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
              {errorMsg}
            </div>
          )}
          <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
            Want to follow up directly instead? Reply to any prior email — they all reach Richard at richard@curriculate.net.
          </p>
        </>
      )}
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<main style={{ padding: 32 }}>Loading…</main>}>
      <UnsubscribeInner />
    </Suspense>
  );
}
