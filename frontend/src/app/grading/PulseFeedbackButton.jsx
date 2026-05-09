"use client";

// frontend/src/app/grading/PulseFeedbackButton.jsx
//
// Pulse Grading — bug reports + suggestions UI.
// POSTs to /api/grading/report (rate-limited to 10/10min/IP, auth-free).
// Floating button bottom-left, opens a small modal with two buttons
// ("Report a problem" / "Suggest a feature"), then a textarea + optional
// contact fields. Designed to live alongside the existing QuestWidget
// without crowding it.

import React, { useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

export default function PulseFeedbackButton({ surface = "grading", context = {} }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(null); // null | "problem" | "suggestion"
  const [message, setMessage] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  // Pre-fill name + email from teacher's saved address if present
  React.useEffect(() => {
    try {
      const e = localStorage.getItem("curriculate_report_email") || "";
      if (e && !fromEmail) setFromEmail(e);
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setKind(null);
    setMessage("");
    setSent(false);
    setErr("");
  };

  const close = () => {
    setOpen(false);
    setTimeout(reset, 300); // wait for fade before clearing state
  };

  const submit = async () => {
    if (!message.trim() || message.trim().length < 5) {
      setErr("Add a few words so we know what's going on.");
      return;
    }
    setSending(true);
    setErr("");
    try {
      // Light context: page URL + viewport + user agent.
      const enriched = {
        ...context,
        url: typeof window !== "undefined" ? window.location.href : "",
        viewport:
          typeof window !== "undefined"
            ? `${window.innerWidth}x${window.innerHeight}`
            : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      };
      const res = await fetch(`${BACKEND_URL}/api/grading/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          fromName: fromName.trim(),
          fromEmail: fromEmail.trim().toLowerCase(),
          surface,
          context: enriched,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          setErr("Too many reports right now — please try again in a few minutes.");
        } else {
          setErr(data?.error || `Send failed (${res.status})`);
        }
        return;
      }
      setSent(true);
      // Auto-close after thank-you screen — but on a long-enough timer
      // that the teacher can read it.
      setTimeout(() => close(), 2500);
    } catch (e) {
      setErr(e?.message || "Send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Report a problem or suggest a feature"
        aria-label="Report a problem or suggest a feature"
        style={{
          position: "fixed",
          left: 16,
          bottom: 16,
          zIndex: 9000,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "none",
          background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          color: "#1f2937",
          fontSize: 22,
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
        }}
      >
        💬
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              borderRadius: 16,
              background: "#ffffff",
              boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
              padding: 20,
            }}
          >
            {sent ? (
              <div style={{ textAlign: "center", padding: "24px 12px" }}>
                <div style={{ fontSize: 36 }}>🙏</div>
                <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>Thanks — got it.</div>
                <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>
                  This goes straight to the team's triage queue.
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#0f172a" }}>
                    Send feedback to the team
                  </h3>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 22,
                      color: "#64748b",
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: 4,
                    }}
                  >
                    ×
                  </button>
                </div>

                {!kind ? (
                  <>
                    <p style={{ margin: "4px 0 14px", color: "#475569", fontSize: 13 }}>
                      Quick triage — what brings you here?
                    </p>
                    <div style={{ display: "grid", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => setKind("problem")}
                        style={{
                          ...kindBtn,
                          background: "linear-gradient(135deg, #fee2e2, #fef3c7)",
                          borderColor: "#fbbf24",
                        }}
                      >
                        <div style={{ fontSize: 22 }}>🐞</div>
                        <div>
                          <div style={kindBtnTitle}>Report a problem</div>
                          <div style={kindBtnSub}>Something's broken, slow, or wrong.</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setKind("suggestion")}
                        style={{
                          ...kindBtn,
                          background: "linear-gradient(135deg, #dcfce7, #dbeafe)",
                          borderColor: "#60a5fa",
                        }}
                      >
                        <div style={{ fontSize: 22 }}>💡</div>
                        <div>
                          <div style={kindBtnTitle}>Suggest a feature</div>
                          <div style={kindBtnSub}>An idea that would make Pulse better.</div>
                        </div>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 18 }}>{kind === "problem" ? "🐞" : "💡"}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                        {kind === "problem" ? "Report a problem" : "Suggest a feature"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setKind(null)}
                        style={{
                          marginLeft: "auto",
                          background: "transparent",
                          border: "none",
                          color: "#64748b",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        change
                      </button>
                    </div>

                    <textarea
                      autoFocus
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={
                        kind === "problem"
                          ? "What were you doing when it broke? What did you see vs. expect?"
                          : "What would help your workflow? Example uses welcome."
                      }
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        fontSize: 14,
                        fontFamily: "inherit",
                        resize: "vertical",
                        minHeight: 100,
                        boxSizing: "border-box",
                      }}
                    />
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={fromName}
                        onChange={(e) => setFromName(e.target.value)}
                        placeholder="Your name (optional)"
                        style={contactInput}
                      />
                      <input
                        type="email"
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
                        placeholder="Email (optional, for follow-up)"
                        style={contactInput}
                      />
                    </div>
                    {err && (
                      <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{err}</div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
                      <button type="button" onClick={close} style={ghostBtn}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submit}
                        disabled={sending || message.trim().length < 5}
                        style={{
                          ...primaryBtn,
                          opacity: sending || message.trim().length < 5 ? 0.55 : 1,
                          cursor:
                            sending || message.trim().length < 5 ? "not-allowed" : "pointer",
                          background:
                            kind === "problem"
                              ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                              : "linear-gradient(135deg, #2563eb, #7c3aed)",
                        }}
                      >
                        {sending ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const kindBtn = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 14px",
  border: "1px solid",
  borderRadius: 12,
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};
const kindBtnTitle = { fontWeight: 800, fontSize: 14, color: "#0f172a" };
const kindBtnSub = { fontSize: 12, color: "#475569", marginTop: 2 };

const contactInput = {
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const primaryBtn = {
  padding: "8px 18px",
  border: "none",
  borderRadius: 10,
  color: "#fff",
  fontWeight: 800,
  fontSize: 14,
};

const ghostBtn = {
  padding: "8px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  background: "transparent",
  color: "#475569",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
