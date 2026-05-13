"use client";

import React, { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }

    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body: Record<string, string> = { email: email.trim(), password };
      if (mode === "signup" && name.trim()) body.name = name.trim();

      // Blast-campaign attribution: utm_* params from the landing URL are
      // stashed in localStorage on first visit; replay them with the signup
      // payload so the backend can record "principal X's email -> teacher
      // Y signed up". Captured by an inline script on the root layout.
      if (mode === "signup" && typeof window !== "undefined") {
        try {
          const utm = JSON.parse(localStorage.getItem("curriculate_utm") || "{}");
          if (utm.utm_content)  body.utm_content  = String(utm.utm_content);
          if (utm.utm_campaign) body.utm_campaign = String(utm.utm_campaign);
          if (utm.utm_source)   body.utm_source   = String(utm.utm_source);
        } catch { /* no-op */ }
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error || `${mode === "login" ? "Login" : "Sign up"} failed (${res.status}).`);
        return;
      }

      // Store JWT token
      if (data?.token) {
        try { localStorage.setItem("curriculate_auth_token", data.token); } catch {}
        // Also set as cookie for API calls that check cookies
        document.cookie = `token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
      }

      setSuccess(mode === "login" ? "Logged in! Redirecting..." : "Account created! Redirecting...");

      // Check if there's a returnTo URL
      const url = new URL(window.location.href);
      const returnTo = url.searchParams.get("returnTo");

      setTimeout(() => {
        window.location.href = returnTo || "/grading";
      }, 800);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 20, boxShadow: "0 12px 40px rgba(15,23,42,0.1)", padding: 28 }}>
        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 950, letterSpacing: -0.5 }}>Curriculate</div>
          <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </div>
        </div>

        {/* Toggle login / signup */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); setSuccess(null); }}
              style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                background: mode === m ? "#2563eb" : "#fff",
                color: mode === m ? "#fff" : "#374151",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, display: "block", marginBottom: 4 }}>Name (optional)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                style={inputStyle}
              />
            </label>
          )}

          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, display: "block", marginBottom: 4 }}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.ca"
              autoComplete="email"
              required
              style={inputStyle}
            />
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, display: "block", marginBottom: 4 }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              style={inputStyle}
            />
          </label>

          {error && (
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "#fef2f2", color: "#dc2626", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "#f0fdf4", color: "#16a34a", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 999,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        {mode === "login" && (
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, opacity: 0.7 }}>
            <a href="/forgot-password" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
              Forgot password?
            </a>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 12, opacity: 0.55 }}>
          By continuing, you agree to our{" "}
          <a href="/terms" style={{ color: "#2563eb", textDecoration: "none" }}>Terms</a>{" "}
          and{" "}
          <a href="/privacy" style={{ color: "#2563eb", textDecoration: "none" }}>Privacy Policy</a>.
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",
};
