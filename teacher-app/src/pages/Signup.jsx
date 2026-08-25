// teacher-app/src/pages/Signup.jsx
import React, { useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

function pickApiBase() {
  const envBase = (() => {
    try {
      return import.meta?.env?.VITE_API_BASE;
    } catch {
      return null;
    }
  })();

  if (envBase && String(envBase).trim()) {
    return String(envBase).trim().replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const host = window.location.host;
    if (host === "set.curriculate.net" || host === "set.qrewzi.com") {
      return "https://api.curriculate.net";
    }
  }

  return "";
}

export default function Signup() {
  const { login } = useAuth();

  const initialCode = useMemo(() => {
    return String(getQueryParam("code") || "").trim().toUpperCase();
  }, []);

  const [accessCode, setAccessCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const apiBase = useMemo(() => pickApiBase(), []);

  const ui = useMemo(
    () => ({
      page: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background:
          "radial-gradient(1200px 900px at 20% 0%, rgba(56,189,248,0.18), rgba(0,0,0,0) 60%), radial-gradient(900px 700px at 100% 40%, rgba(34,197,94,0.14), rgba(0,0,0,0) 55%), linear-gradient(180deg, #020617, #0b1220 50%, #020617)",
        color: "#e5e7eb",
      },
      wrap: { width: "100%", maxWidth: 520 },
      card: {
        width: "100%",
        padding: 20,
        borderRadius: 16,
        background: "rgba(2,6,23,0.92)",
        border: "1px solid rgba(148,163,184,0.18)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        boxSizing: "border-box",
      },
      label: { display: "block", marginTop: 12, marginBottom: 6, fontWeight: 800 },
      input: {
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(148,163,184,0.28)",
        backgroundColor: "rgba(255,255,255,0.06)",
        padding: "12px 12px",
        color: "#e5e7eb",
        outline: "none",
        boxSizing: "border-box",
      },
      buttonPrimary: {
        fontSize: "1rem",
        borderRadius: 12,
        border: "none",
        padding: "12px 14px",
        background:
          "linear-gradient(90deg, rgba(14,165,233,1), rgba(34,197,94,1))",
        color: "#06263a",
        cursor: "pointer",
        fontWeight: 900,
        boxShadow: "0 10px 24px rgba(14,165,233,0.25)",
      },
      buttonGhost: {
        fontSize: "0.9rem",
        borderRadius: 12,
        border: "1px solid rgba(148,163,184,0.35)",
        padding: "10px 12px",
        backgroundColor: "rgba(255,255,255,0.06)",
        color: "#e5e7eb",
        cursor: "pointer",
        fontWeight: 800,
      },
      row: { display: "flex", gap: 10, alignItems: "center" },
      hint: { opacity: 0.78, marginTop: 0, marginBottom: 14 },
      warn: {
        marginTop: 10,
        padding: 10,
        borderRadius: 12,
        background: "rgba(251,191,36,0.10)",
        border: "1px solid rgba(251,191,36,0.35)",
        color: "#fde68a",
        fontWeight: 700,
      },
    }),
    []
  );

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setOkMsg("");

    const code = String(accessCode || "").trim().toUpperCase();
    const em = String(email || "").trim().toLowerCase();
    const nm = String(name || "").trim();
    const pw = String(password || "");

    if (!code) return setErr("Please enter your access code.");
    if (!em) return setErr("Please enter your email.");
    if (!pw) return setErr("Please enter a password.");
    if (pw.length < 8) return setErr("Password must be at least 8 characters.");

    setBusy(true);
    try {
      const resp = await fetch(`${apiBase}/api/auth/signup-with-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: em,
          password: pw,
          name: nm,
          accessCode: code,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || "Signup failed.");
      }

      // Use existing auth flow to store token/cookies/etc.
      await login(em, pw);
      setOkMsg("Account created. Signing you in…");
      window.location.href = "/";
    } catch (e2) {
      setErr(e2?.message || "Signup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={ui.page}>
      <div style={ui.wrap}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, opacity: 0.78, fontWeight: 900, letterSpacing: 0.3 }}>
            Curriculate
          </div>
          <div style={{ fontSize: 32, fontWeight: 1000, marginTop: 4 }}>
            Create Account
          </div>
        </div>

        <div style={ui.card}>
          <h2 style={{ margin: 0, marginBottom: 8, fontSize: "1.25rem" }}>
            Join with Access Code
          </h2>
          <p style={ui.hint}>
            Enter your access code, then choose your email and password.
          </p>

          {!initialCode && (
            <div style={ui.warn}>
              Tip: If you came from the login screen, your access code should auto-fill.
            </div>
          )}

          <form onSubmit={onSubmit}>
            <label style={ui.label}>Access Code</label>
            <input
              value={accessCode}
              onChange={(e) => setAccessCode(String(e.target.value || "").toUpperCase())}
              placeholder="ABC123"
              autoComplete="off"
              style={ui.input}
              disabled={busy}
            />

            <label style={ui.label}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              style={ui.input}
              disabled={busy}
            />

            <label style={ui.label}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.ca"
              autoComplete="email"
              style={ui.input}
              disabled={busy}
            />

            <label style={ui.label}>Password</label>
            <div style={ui.row}>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                type={showPw ? "text" : "password"}
                style={{ ...ui.input, flex: 1 }}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                style={{ ...ui.buttonGhost, whiteSpace: "nowrap" }}
                disabled={busy}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{ ...ui.buttonPrimary, marginTop: 14, width: "100%" }}
            >
              {busy ? "Creating…" : "Create account"}
            </button>

            <button
              type="button"
              onClick={() => (window.location.href = "/login")}
              disabled={busy}
              style={{ marginTop: 10, width: "100%", ...ui.buttonGhost }}
            >
              Back to sign in
            </button>

            {err && (
              <div style={{ color: "#fca5a5", marginTop: 12, fontWeight: 800 }}>
                {err}
              </div>
            )}
            {okMsg && (
              <div style={{ color: "#86efac", marginTop: 12, fontWeight: 900 }}>
                {okMsg}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
