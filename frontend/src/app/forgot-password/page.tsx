"use client";

import React, { useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://api.curriculate.net";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Please enter the email you signed up with.");
      return;
    }
    setLoading(true);
    try {
      // Backend returns { ok: true } whether or not the email exists
      // (anti-enumeration), so success here means "request submitted",
      // not "your email is on file".  We word the confirmation UI
      // accordingly.
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Request failed (${res.status}).`);
        return;
      }
      setSent(true);
    } catch (err: any) {
      setError(err?.message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 12px 40px rgba(15,23,42,0.1)",
          padding: 28,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 950, letterSpacing: -0.5 }}>
            Curriculate
          </div>
          <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
            Reset your password
          </div>
        </div>

        {sent ? (
          <>
            <div
              style={{
                padding: "14px 16px",
                background: "#dcfce7",
                border: "1px solid #86efac",
                borderRadius: 12,
                color: "#166534",
                fontSize: 14,
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              ✓ If <b>{email}</b> is registered with us, you'll get an
              email with a reset link in the next minute or two.
              Check your inbox (and spam folder, just in case).
            </div>
            <a
              href="/login"
              style={{
                display: "block",
                textAlign: "center",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                color: "#0f172a",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Back to sign in
            </a>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p
              style={{
                fontSize: 13,
                color: "#475569",
                marginTop: 0,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              Enter your email and we'll send you a link to reset your
              password.
            </p>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.org"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                fontSize: 15,
                marginBottom: 12,
                boxSizing: "border-box",
              }}
            />
            {error && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  color: "#991b1b",
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "none",
                background: loading
                  ? "#94a3b8"
                  : "linear-gradient(135deg, #2563eb, #7c3aed)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 15,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <a
                href="/login"
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  textDecoration: "none",
                }}
              >
                ← Back to sign in
              </a>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
