// student-app/src/components/tasks/types/CurrentEventsTask.jsx
//
// Renderer for the "current-events" task type.
// The persisted task is just a shell; the backend's resolveCurrentEvents pipeline
// (backend/services/currentEventsResolver.js) fetches a real news story at launch
// time and populates `task.config.resolved`. While resolution is in flight, the
// backend sends a placeholder task with `config.loading: true`.
//
// See CURRENT_EVENTS_PLAN.md §11 + §14 for the spec.
import React, { useState } from "react";

export default function CurrentEventsTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};
  const resolved = cfg.resolved || null;
  const loading = !!cfg.loading || !resolved;

  const [response, setResponse] = useState("");

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({
        type: "current-events-response",
        text: response.trim(),
        autoComplete: true,
        meta: {
          sourceUrl: resolved?.sourceUrl || null,
          sourceName: resolved?.sourceName || null,
          fallbackTier: resolved?.fallbackTier || null,
        },
      });
    }
  };

  if (loading) {
    return (
      <div style={loadingWrap}>
        <div style={{ fontSize: "2.5rem" }}>📰</div>
        <div style={{ fontSize: "1rem", color: "#cbd5e1", marginTop: 8 }}>Loading today's connection to the lesson…</div>
        <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: 6 }}>
          (Searching the past week for a story that fits.)
        </div>
        <style>{`@keyframes ce-pulse { 0%{opacity:0.4}50%{opacity:1}100%{opacity:0.4} } .ce-pulse{animation:ce-pulse 1.5s infinite}`}</style>
        <div className="ce-pulse" style={{ marginTop: 16, fontSize: "0.7rem", color: "#a78bfa", letterSpacing: 2, textTransform: "uppercase" }}>
          Live fetch
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={tagStrip}>
        Current Events
        {resolved.fallbackTier ? (
          <span style={{ marginLeft: 8, opacity: 0.7, fontSize: "0.65rem", fontWeight: 500, letterSpacing: 1 }}>
            {String(resolved.fallbackTier).replaceAll("-", " ")}
          </span>
        ) : null}
      </div>

      <div style={titleStyle}>{resolved.title || task?.title || "This Week's Connection"}</div>

      {resolved.currentEventHeadline ? (
        <div style={headlineStyle}>{resolved.currentEventHeadline}</div>
      ) : null}

      <div style={cardWrap}>
        <div style={cardLabel}>What happened</div>
        <p style={bodyText}>{resolved.eventSummary}</p>
      </div>

      <div style={cardWrap}>
        <div style={cardLabel}>How it connects to today's lesson</div>
        <p style={bodyText}>{resolved.connectionToLesson}</p>
      </div>

      <div style={cardWrap}>
        <div style={cardLabel}>Your task</div>
        <p style={{ ...bodyText, fontWeight: 600 }}>{resolved.studentTask}</p>
      </div>

      {Array.isArray(resolved.discussionQuestions) && resolved.discussionQuestions.length > 0 && (
        <div style={cardWrap}>
          <div style={cardLabel}>Discussion</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: "#e2e8f0" }}>
            {resolved.discussionQuestions.map((q, i) => (
              <li key={i} style={{ marginBottom: 6, lineHeight: 1.5 }}>{q}</li>
            ))}
          </ol>
        </div>
      )}

      {resolved.extensionActivity ? (
        <div style={{ ...cardWrap, borderColor: "rgba(34,197,94,0.35)" }}>
          <div style={{ ...cardLabel, color: "#86efac" }}>If you finish early</div>
          <p style={bodyText}>{resolved.extensionActivity}</p>
        </div>
      ) : null}

      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Your team's response (optional)…"
        disabled={disabled}
        style={textareaStyle}
        maxLength={600}
      />

      <button
        type="button"
        onClick={handleContinue}
        disabled={disabled}
        style={{
          ...continueBtn,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Continue →
      </button>

      {resolved.sourceName ? (
        <div style={sourceLine}>
          Source: {resolved.sourceName}
          {resolved.sourceUrl ? (
            <> · <a href={resolved.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>read</a></>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "14px 14px",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const loadingWrap = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  minHeight: "55vh",
  padding: "20px",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#a78bfa",
  alignSelf: "flex-start",
  padding: "2px 8px",
  background: "rgba(124,58,237,0.18)",
  borderRadius: 999,
};
const titleStyle = { fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2 };
const headlineStyle = { fontSize: "1rem", color: "#cbd5e1", fontStyle: "italic", lineHeight: 1.4 };
const cardWrap = {
  padding: 12,
  background: "rgba(30,41,59,0.55)",
  border: "1px solid rgba(124,58,237,0.3)",
  borderRadius: 12,
};
const cardLabel = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#a78bfa",
  marginBottom: 6,
};
const bodyText = {
  fontSize: "0.95rem",
  color: "#e2e8f0",
  lineHeight: 1.55,
  margin: 0,
};
const textareaStyle = {
  width: "100%",
  minHeight: 80,
  padding: "10px 12px",
  fontSize: "0.95rem",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "rgba(15,23,42,0.6)",
  color: "#f1f5f9",
  outline: "none",
  fontFamily: "inherit",
  resize: "vertical",
};
const continueBtn = {
  padding: "12px 28px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 14,
  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
  color: "#fff",
  alignSelf: "center",
  marginTop: 4,
  boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
};
const sourceLine = {
  fontSize: "0.72rem",
  color: "#94a3b8",
  textAlign: "center",
};
