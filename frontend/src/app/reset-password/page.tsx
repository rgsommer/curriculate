"use client";

import React, { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://api.curriculate.net";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read token + email from the URL on mount (avoids needing a Suspense
  // boundary around useSearchParams).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      setToken(q.get("token") || "");
      setEmail(q.get("email") || "");
    } catch {
      /* ignore */
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token || !email) {
      setError("This reset link is missing or invalid. Request a new one.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, newPassword: password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(
          data?.error === "Invalid token"
            ? "This reset link is invalid or has expired. Request a new one."
            : data?.error || `Request failed (${res.status}).`
        );
        return;
      }
      setDone(true);
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
            Choose a new password
          </div>
        </div>

        {done ? (
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
              ✓ Your password has been reset. You can sign in now.
            </div>
            <a
              href="/login"
              style={{
                display: "block",
                textAlign: "center",
                padding: "12px 16px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 800,
              }}
            >
              Go to sign in
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
              {email ? (
                <>Resetting the password for <b>{email}</b>.</>
              ) : (
                <>Enter a new password for your account.</>
              )}
            </p>
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                fontSize: 15,
                marginBottom: 10,
                boxSizing: "border-box",
              }}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
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
              {loading ? "Saving…" : "Set new password"}
            </button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <a
                href="/forgot-password"
                style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}
              >
                Need a new link?
              </a>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
