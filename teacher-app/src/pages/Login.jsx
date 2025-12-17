// teacher-app/src/pages/Login.jsx
import React, { useState } from "react";
import { useAuth } from "../auth/useAuth";

export default function Login() {
  const { login, requestPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [showForgot, setShowForgot] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotErr, setForgotErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setForgotMsg("");
    setForgotErr("");

    const em = (email || "").trim();
    const pw = String(password || "");

    if (!em) return setErr("Please enter your email.");
    if (!pw) return setErr("Please enter your password.");

    setBusy(true);
    try {
      await login(email.trim(), password.trim());
      // Your TeacherApp routes will take over once authenticated
      // (no sidebar on this page anyway)
      window.location.href = "/";
    } catch (e2) {
      setErr(e2?.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    setForgotErr("");
    setForgotMsg("");
    setErr("");

    const em = (email || "").trim();
    if (!em) {
      setForgotErr("Enter your email above first.");
      return;
    }

    setForgotBusy(true);
    try {
      await requestPasswordReset(em);
      setForgotMsg(
        "If that email exists, a reset link has been sent. (Dev: check backend logs.)"
      );
    } catch (e2) {
      setForgotErr(e2?.message || "Could not request reset.");
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(1200px 600px at 50% 20%, #1e293b 0%, #0b1220 55%, #020617 100%)",
        color: "#f9fafb",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        {/* Top brand / tagline */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: 0.2,
              marginBottom: 6,
            }}
          >
            Curriculate
          </div>
          <div style={{ opacity: 0.78, fontSize: 14, lineHeight: 1.35 }}>
            Stations. Teams. Momentum.
            <br />
            Make learning feel like a game.
          </div>
        </div>

        {/* Center card */}
        <div
          style={{
            width: "100%",
            padding: 20,
            borderRadius: 16,
            background: "rgba(2,6,23,0.92)",
            border: "1px solid rgba(148,163,184,0.18)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            boxSizing: "border-box",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: 8, fontSize: "1.25rem" }}>
            Presenter Login
          </h2>
          <p style={{ opacity: 0.78, marginTop: 0, marginBottom: 14 }}>
            Sign in to launch task sets and run live sessions.
          </p>

          <form onSubmit={onSubmit}>
            <label style={ui.label}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.ca"
              autoComplete="email"
              style={ui.input}
            />

            <div style={{ height: 10 }} />

            <label style={ui.label}>Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              style={ui.input}
            />

            {err && (
              <div style={{ color: "#fca5a5", marginTop: 10, fontWeight: 700 }}>
                {err}
              </div>
            )}

            <button
              disabled={busy}
              style={{ ...ui.buttonPrimary, marginTop: 14, width: "100%" }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              style={{
                marginTop: 10,
                width: "100%",
                ...ui.buttonGhost,
              }}
            >
              {showForgot ? "Hide password reset" : "Forgot password?"}
            </button>

            {showForgot && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(15,23,42,0.75)",
                  border: "1px solid rgba(148,163,184,0.18)",
                }}
              >
                <div style={{ opacity: 0.82, fontSize: 13, marginBottom: 10 }}>
                  We’ll send a reset link to your email.
                  <br />
                  <span style={{ opacity: 0.85 }}>
                    (Dev mode: link prints in backend logs.)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={onForgot}
                  disabled={forgotBusy}
                  style={{ ...ui.buttonPrimary, width: "100%" }}
                >
                  {forgotBusy ? "Sending…" : "Send reset link"}
                </button>

                {forgotErr && (
                  <div style={{ color: "#fca5a5", marginTop: 10, fontWeight: 700 }}>
                    {forgotErr}
                  </div>
                )}
                {forgotMsg && (
                  <div style={{ color: "#86efac", marginTop: 10, fontWeight: 700 }}>
                    {forgotMsg}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>

        {/* tiny footer */}
        <div style={{ textAlign: "center", opacity: 0.55, marginTop: 14, fontSize: 12 }}>
          © {new Date().getFullYear()} Curriculate
        </div>
      </div>
    </div>
  );
}

const ui = {
  input: {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(255,255,255,0.06)",
    color: "#f9fafb",
    outline: "none",
    boxSizing: "border-box",
    fontSize: "0.98rem",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 800,
    opacity: 0.88,
    marginBottom: 6,
  },
  buttonPrimary: {
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 900,
    cursor: "pointer",
    background: "linear-gradient(180deg, #38bdf8 0%, #0ea5e9 55%, #0284c7 100%)",
    color: "#06263a",
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
};
