"use client";

/**
 * curriculate.net/subs/respond?token=…&action=accept|decline
 *
 * Landing page for the accept/decline links embedded in offer emails and
 * SMS. The unguessable token IS the credential, so no sign-in is required —
 * a teacher can respond straight from the message. We show the assignment
 * details first, then act on confirmation (or immediately if ?action= is
 * present and the teacher just taps the button in the email).
 */

import React, { useCallback, useEffect, useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

const box = { maxWidth: 460, margin: "48px auto", padding: 24, fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", color: "#0f172a" };
const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 24 };
const btnGreen = { background: "#16a34a", color: "#fff", border: 0, padding: "10px 18px", borderRadius: 8, fontWeight: 600, cursor: "pointer", marginRight: 8 };
const btnRed = { background: "#fff", color: "#dc2626", border: "1px solid #fecaca", padding: "10px 18px", borderRadius: 8, fontWeight: 600, cursor: "pointer" };

export default function RespondPage() {
  const [token, setToken] = useState("");
  const [offer, setOffer] = useState(null);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tk = p.get("token") || "";
    setToken(tk);
    if (!tk) {
      setErr("Missing offer token.");
      return;
    }
    fetch(`${BACKEND_URL}/api/subs-teacher/offer-by-token/${encodeURIComponent(tk)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErr(d.error);
        else setOffer(d.offer);
      })
      .catch(() => setErr("Could not load this offer."));
  }, []);

  const respond = useCallback(
    async (action) => {
      setBusy(true);
      setErr("");
      try {
        const r = await fetch(`${BACKEND_URL}/api/subs-teacher/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, action }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not process response.");
        setResult(action === "accept" ? "You're confirmed — thank you! The school has been notified." : "You've declined. The assignment will be offered to the next teacher.");
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  return (
    <div style={box}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Substitute teaching offer</h1>
      <div style={card}>
        {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
        {result && <p style={{ color: "#15803d", fontWeight: 600 }}>{result}</p>}
        {!result && offer && (
          <>
            <p style={{ color: "#475569" }}>
              <strong>{offer.request?.gradeName}</strong> at {offer.request?.schoolName} on {offer.request?.date}
              {offer.request?.urgency === "urgent" ? " (urgent)" : ""}.
            </p>
            {offer.request?.notes && <p style={{ color: "#64748b" }}>Notes: {offer.request.notes}</p>}
            {offer.status !== "pending" ? (
              <p style={{ color: "#64748b" }}>This offer is no longer active (status: {offer.status}).</p>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button style={btnGreen} disabled={busy} onClick={() => respond("accept")}>
                  Accept
                </button>
                <button style={btnRed} disabled={busy} onClick={() => respond("decline")}>
                  Decline
                </button>
              </div>
            )}
          </>
        )}
        {!err && !offer && !result && <p style={{ color: "#64748b" }}>Loading…</p>}
      </div>
    </div>
  );
}
