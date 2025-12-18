// teacher-app/src/pages/Login.jsx
import React, { useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";

export default function Login() {
  const { login, requestPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [showForgot, setShowForgot] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotErr, setForgotErr] = useState("");

  // dev-only display (only shows if server returns them)
  const [devResetLink, setDevResetLink] = useState("");
  const [devResetToken, setDevResetToken] = useState("");
  const [copied, setCopied] = useState(""); // "link" | "token" | ""

  const canSubmit = useMemo(() => {
    return !!email.trim() && !!String(password || "");
  }, [email, password]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    const em = (email || "").trim();
    const pw = String(password || "");

    if (!em) return setErr("Please enter your email.");
    if (!pw) return setErr("Please enter your password.");

    setBusy(true);
    try {
      await login(em, pw); // matches your current useAuth signature
      window.location.href = "/";
    } catch (e2) {
      setErr(e2?.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text, which) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopied(which);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      // ignore
    }
  };

  const onForgot = async () => {
    setForgotErr("");
    setForgotMsg("");
    setErr("");
    setDevResetLink("");
    setDevResetToken("");
    setCopied("");

    const em = (email || "").trim();
    if (!em) {
      setForgotErr("Enter your email above first.");
      return;
    }

    setForgotBusy(true);
    try {
      const data = await requestPasswordReset(em);
      console.log("forgot-password response:", data);

      // If your backend returns dev fields, show them. Otherwise show the generic safe message.
      const link = data?.resetLink || data?.link || "";
      const token = data?.resetToken || data?.token || "";

      if (link) setDevResetLink(String(link));
      if (token) setDevResetToken(String(token));

      if (link || token) {
        setForgotMsg(
          "Dev reset info received. Copy the link or token below to reset your password."
        );
      } else {
        setForgotMsg(
          "If that email exists, a reset link has been sent. (Dev: check backend logs.)"
        );
      }
    } catch (e2) {
      setForgotErr(e2?.message || "Could not request reset.");
    } finally {
      setForgotBusy(false);
    }

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
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 6 }}>
            Curriculate
          </div>
          <div style={{ opacity: 0.78, fontSize: 14, lineHeight: 1.35 }}>
            Stations. Teams. Momentum.
            <br />
            Make learning feel like a game.
          </div>
        </div>

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
              disabled={busy || forgotBusy}
            />

            <div style={{ height: 10 }} />

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={ui.label}>Password</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  style={ui.input}
                  disabled={busy || forgotBusy}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                style={{ ...ui.buttonGhost, width: 120, marginTop: 22 }}
                disabled={busy || forgotBusy}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>

            {err && (
              <div style={{ color: "#fca5a5", marginTop: 10, fontWeight: 700 }}>
                {err}
              </div>
            )}

            <button
              disabled={busy || forgotBusy || !canSubmit}
              style={{ ...ui.buttonPrimary, marginTop: 14, width: "100%" }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              style={{ marginTop: 10, width: "100%", ...ui.buttonGhost }}
              disabled={busy}
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
                    Dev mode: backend may return a token/link or print it to logs.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={onForgot}
                  disabled={forgotBusy || busy}
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

                {(devResetLink || devResetToken) && (
                  <div style={{ marginTop: 12 }}>
                    {devResetLink && (
                      <DevRow
                        label="Dev reset link"
                        value={devResetLink}
                        copied={copied === "link"}
                        onCopy={() => copy(devResetLink, "link")}
                      />
                    )}
                    {devResetToken && (
                      <DevRow
                        label="Dev reset token"
                        value={devResetToken}
                        copied={copied === "token"}
                        onCopy={() => copy(devResetToken, "token")}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>

        <div style={{ textAlign: "center", opacity: 0.55, marginTop: 14, fontSize: 12 }}>
          © {new Date().getFullYear()} Curriculate
        </div>
      </div>
    </div>
  );
}

function DevRow({ label, value, onCopy, copied }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
        marginTop: 10,
        padding: 10,
        borderRadius: 12,
        border: "1px solid rgba(148,163,184,0.18)",
        background: "rgba(2,6,23,0.55)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>{label}</div>
        <div
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            wordBreak: "break-all",
            opacity: 0.9,
          }}
        >
          {value}
        </div>
      </div>

      <button type="button" onClick={onCopy} style={{ ...ui.buttonGhost, width: 92 }}>
        {copied ? "Copied!" : "Copy"}
      </button>
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
