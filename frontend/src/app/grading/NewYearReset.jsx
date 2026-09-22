"use client";

/**
 * NewYearReset — "start a new school year".
 *
 * Clears last year's published results so a new cohort isn't sharing a
 * progress portal with the previous one. This is the most destructive action
 * in the grading tool, so the UI is built to make it hard to do by accident
 * and easy to understand before agreeing:
 *
 *   1. Preview first — real counts, plus a sample of what matched, so the
 *      teacher can check the scope caught the right cohort.
 *   2. Opt in per category. Answer keys are OFF by default: they belong to a
 *      BOOK, not a year, and re-photographing every key page is an hour's work.
 *   3. Type "NEW YEAR" to arm the button. A click alone can't fire it.
 */

import React, { useState } from "react";

// Shown on hover before the dialog is ever opened. A destructive control
// labelled only "Start a new school year…" doesn't say what it clears, and the
// one thing a teacher needs to know before clicking is that results are deleted
// outright rather than archived.
const NEW_YEAR_TOOLTIP = [
  "Permanently deletes last year's graded results from your account, so a new",
  "cohort doesn't inherit the previous one's progress portal. Result links you",
  "handed out stop working.",
  "",
  "Deleted by default: published results and homework batches.",
  "Kept by default: class rosters, parent contacts and answer keys — you can",
  "tick those in if you want them gone too. (Answer keys belong to a textbook,",
  "not a year.)",
  "",
  "You see exact counts of what will go before anything happens, and must type",
  "NEW YEAR to confirm. It cannot be undone.",
].join("\n");

export default function NewYearReset({ backendBase, teacherEmail, onDone }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [keepBefore, setKeepBefore] = useState(""); // optional date cutoff

  const [include, setInclude] = useState({
    publishedResults: true,
    homeworkBatches: true,
    rosters: false,
    contacts: false,
    answerKeys: false,
  });

  const url = (p) => `${backendBase}/grading/reset${p}`;

  async function runPreview() {
    setBusy(true); setError(""); setDone(null);
    try {
      const res = await fetch(url("/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherEmail, before: keepBefore || null }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setPreview(data);
    } catch (err) {
      setError(err?.message || "Could not load the preview.");
    } finally {
      setBusy(false);
    }
  }

  async function runExecute() {
    if (!preview?.token) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(url("/execute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherEmail, token: preview.token, confirmPhrase, include,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setDone(data.removed);
      setPreview(null);
      setConfirmPhrase("");
      onDone?.(data.removed);
    } catch (err) {
      setError(err?.message || "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setPreview(null);
    setConfirmPhrase("");
    setError("");
    setDone(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        style={st.trigger}
        onClick={() => { setOpen(true); runPreview(); }}
        title={NEW_YEAR_TOOLTIP}
      >
        Start a new school year…
      </button>
    );
  }

  const armed = confirmPhrase.trim().toUpperCase() === "NEW YEAR" && !!preview?.token;
  const c = preview?.counts;

  return (
    <div style={st.overlay} role="dialog" aria-modal="true" aria-label="Start a new school year">
      <div style={st.modal}>
        <div style={st.head}>
          <div style={st.title}>Start a new school year</div>
          <button type="button" style={st.x} onClick={close} aria-label="Close">✕</button>
        </div>

        {!teacherEmail && (
          <div style={st.warn}>
            Add your teacher email on the grading page first — the reset is scoped to your account.
          </div>
        )}

        {done ? (
          <>
            <div style={st.ok}>
              <b>Done.</b> Removed {done.publishedResults} published result
              {done.publishedResults === 1 ? "" : "s"}
              {done.homeworkBatches ? `, ${done.homeworkBatches} homework batch${done.homeworkBatches === 1 ? "" : "es"}` : ""}
              {done.rosters ? `, ${done.rosters} roster${done.rosters === 1 ? "" : "s"}` : ""}
              {done.contacts ? `, ${done.contacts} contact${done.contacts === 1 ? "" : "s"}` : ""}
              {done.answerKeys ? `, ${done.answerKeys} answer key${done.answerKeys === 1 ? "" : "s"}` : ""}.
            </div>
            <button type="button" style={st.primary} onClick={close}>Close</button>
          </>
        ) : (
          <>
            <div style={st.body}>
              Clears last year's results so a new cohort doesn't share a progress portal
              with the previous one. Everything here is scoped to your account only.
              {" "}
              <b>This deletes permanently — there is no archive and no undo, and any
              result links you handed out will stop working.</b>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={st.label}>Keep anything created on or after (optional)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="date"
                  value={keepBefore}
                  onChange={(e) => setKeepBefore(e.target.value)}
                  style={st.input}
                />
                <button type="button" style={st.secondary} disabled={busy} onClick={runPreview}>
                  Recount
                </button>
              </div>
              <div style={st.hint}>
                Leave blank to clear everything. Set it to the first day of term to keep this year
                and clear what came before.
              </div>
            </div>

            {busy && !preview && <div style={st.body}>Counting…</div>}

            {preview && (
              <>
                <div style={st.countBox}>
                  <div style={st.countRow}><b>{c.publishedResults}</b> published results (what students see at /progress)</div>
                  <div style={st.countRow}><b>{c.homeworkBatches}</b> homework check batches</div>
                  <div style={st.countRow}><b>{c.rosters}</b> class rosters</div>
                  <div style={st.countRow}><b>{c.contacts}</b> student/parent contacts</div>
                  <div style={st.countRow}><b>{c.answerKeys}</b> answer keys</div>
                </div>

                {preview.scope?.matchedBy?.length > 0 && (
                  <div style={st.hint}>
                    Matched by: {preview.scope.matchedBy.join("; ")}.
                  </div>
                )}

                {preview.sample?.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={st.summary}>
                      Check a sample of what matched ({preview.sample.length} most recent)
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {preview.sample.map((s, i) => (
                        <div key={i} style={st.sampleRow}>
                          {s.studentName}
                          {s.className ? ` · ${s.className}` : ""}
                          {s.title ? ` · ${s.title}` : ""}
                          <span style={st.sampleDate}>
                            {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div style={{ marginTop: 12 }}>
                  <div style={st.label}>What to clear</div>
                  {[
                    ["publishedResults", "Published results", "Removes them from /progress and stops their ref-code links working."],
                    ["homeworkBatches", "Homework check batches", "Last year's homework history."],
                    ["rosters", "Class rosters", "Only if your classes change completely. You can also just re-upload."],
                    ["contacts", "Student & parent contacts", "Emails are slow to re-collect — leave off unless you're sure."],
                    ["answerKeys", "Answer keys", "Keys belong to a book, not a year. Leave off if you teach the same book again."],
                  ].map(([key, label, note]) => (
                    <label key={key} style={st.check}>
                      <input
                        type="checkbox"
                        checked={include[key]}
                        onChange={(e) => setInclude((p) => ({ ...p, [key]: e.target.checked }))}
                      />
                      <span>
                        <b>{label}</b>
                        <div style={st.hint}>{note}</div>
                      </span>
                    </label>
                  ))}
                </div>

                <div style={st.danger}>{preview.warning}</div>

                <div style={{ marginTop: 10 }}>
                  <label style={st.label}>Type <code>NEW YEAR</code> to confirm</label>
                  <input
                    value={confirmPhrase}
                    onChange={(e) => setConfirmPhrase(e.target.value)}
                    placeholder="NEW YEAR"
                    style={st.input}
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            {error && <div style={st.err}>{error}</div>}

            <div style={st.actions}>
              <button type="button" style={st.secondary} onClick={close}>Cancel</button>
              <button
                type="button"
                style={{ ...st.destructive, opacity: armed && !busy ? 1 : 0.45, cursor: armed && !busy ? "pointer" : "not-allowed" }}
                disabled={!armed || busy}
                onClick={runExecute}
              >
                {busy ? "Clearing…" : "Clear permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const st = {
  trigger: {
    background: "none", border: "none", padding: 0,
    color: "#b91c1c", fontSize: 12, fontWeight: 700,
    textDecoration: "underline", cursor: "pointer",
  },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16, zIndex: 9999,
  },
  modal: {
    background: "#fff", borderRadius: 16, padding: 20,
    maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto",
    boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 900, color: "#0f172a" },
  x: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b" },
  body: { fontSize: 13, color: "#475569", lineHeight: 1.6, marginBottom: 12 },
  label: {
    display: "block", fontSize: 11, fontWeight: 800, color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
  },
  hint: { fontSize: 11, color: "#64748b", marginTop: 3, lineHeight: 1.5 },
  input: {
    width: "100%", padding: "8px 12px", borderRadius: 10,
    border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
  },
  countBox: {
    border: "1px solid #e2e8f0", borderRadius: 12, padding: 12,
    background: "#f8fafc", marginTop: 8,
  },
  countRow: { fontSize: 13, color: "#0f172a", padding: "2px 0" },
  summary: { fontSize: 12, fontWeight: 700, color: "#2563eb", cursor: "pointer" },
  sampleRow: {
    fontSize: 12, color: "#475569", padding: "3px 0",
    borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", gap: 8,
  },
  sampleDate: { color: "#94a3b8", whiteSpace: "nowrap" },
  check: {
    display: "flex", gap: 8, alignItems: "flex-start",
    padding: "6px 0", fontSize: 13, cursor: "pointer",
  },
  danger: {
    marginTop: 12, padding: "10px 12px", borderRadius: 10,
    background: "#fef2f2", border: "1px solid #fecaca",
    color: "#b91c1c", fontSize: 12, lineHeight: 1.6,
  },
  warn: {
    padding: "10px 12px", borderRadius: 10, marginBottom: 12,
    background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13,
  },
  ok: {
    padding: "10px 12px", borderRadius: 10, marginBottom: 12,
    background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: 13, lineHeight: 1.6,
  },
  err: {
    marginTop: 10, padding: "8px 12px", borderRadius: 10,
    background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13,
  },
  actions: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 },
  primary: {
    padding: "10px 18px", borderRadius: 10, border: "none",
    background: "#2563eb", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: 14,
  },
  secondary: {
    padding: "10px 16px", borderRadius: 10, border: "1px solid #cbd5e1",
    background: "#fff", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 14,
  },
  destructive: {
    padding: "10px 18px", borderRadius: 10, border: "none",
    background: "#dc2626", color: "#fff", fontWeight: 800, fontSize: 14,
  },
};
