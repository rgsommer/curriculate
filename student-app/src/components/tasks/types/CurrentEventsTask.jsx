// student-app/src/components/tasks/types/CurrentEventsTask.jsx
//
// Renderer for the "current-events" task type.
// The persisted task is just a shell; the backend's resolveCurrentEvents pipeline
// (backend/services/currentEventsResolver.js) fetches a real news story at launch
// time and populates `task.config.resolved`. While resolution is in flight, the
// backend sends a placeholder task with `config.loading: true`.
//
// See CURRENT_EVENTS_PLAN.md §11 + §14 for the spec.
import React, { useEffect, useMemo, useState } from "react";
import SpeechQualityMeter from "../SpeechQualityMeter";
import { API_BASE_URL } from "../../../config";

// Count sentence-shaped chunks in a free-text response. Handles the
// common end-of-sentence punctuation + the case where the user just
// types two lines with no terminators (counts each non-empty line).
function countSentences(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  // Split on . ! ? while keeping the punctuation; filter to sentences
  // with at least 3 words so trivial fragments don't pad the count.
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s.replace(/[^\w]+/g, " ").trim().split(/\s+/).length >= 3);
  if (parts.length > 0) return parts.length;
  // Fallback: count non-empty lines (covers tester typing without
  // punctuation).
  return t
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3).length;
}

const MIN_RESPONSE_SENTENCES = 3;

export default function CurrentEventsTask({ task, onSubmit, disabled, practiceMode = false }) {
  const cfg = task?.config || {};

  // ── Practice-mode live news ──────────────────────────────────────────
  // Live sessions resolve a REAL story over the socket (roomEngine). Solo
  // practice ships a pre-baked "evergreen" demo block, which testers flagged
  // as feeling fake. When the demo opts in (config.liveResolveInPractice), we
  // fetch an actual current event over HTTP and swap it in. The pre-baked
  // block stays as a graceful fallback if the fetch fails or no key is set.
  const wantsLive = practiceMode && !!cfg.liveResolveInPractice && !cfg.resolvedFromLive;
  const [liveResolved, setLiveResolved] = useState(null);
  const [liveFetching, setLiveFetching] = useState(wantsLive);

  useEffect(() => {
    if (!wantsLive) return;
    let cancelled = false;
    // Don't let a slow web-search hang forever — the pre-baked story is already
    // on screen, so we abort after 12s (tester: "nothing showed up").
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/current-events/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            lessonTopic: cfg.lessonTopic || task?.title || "general learning",
            subject: cfg.subject || "General",
            gradeLevel: cfg.gradeLevel || 7,
            region: cfg.region || "Canada",
            worldviewProfile: cfg.worldviewProfile || "general",
            preferredCategories: cfg.preferredCategories,
          }),
        });
        const j = await r.json().catch(() => null);
        if (!cancelled && j?.ok && j.resolved) setLiveResolved(j.resolved);
      } catch {
        /* keep pre-baked fallback */
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLiveFetching(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [wantsLive, cfg.lessonTopic, cfg.subject, cfg.gradeLevel, cfg.region, cfg.worldviewProfile, task?.title]);

  // Prefer the live story when we got one; otherwise the pre-baked block. We do
  // NOT block on liveFetching — the pre-baked story shows instantly and quietly
  // upgrades to live news when it arrives, so the screen is never blank.
  const resolved = liveResolved || cfg.resolved || null;
  const loading = !!cfg.loading || !resolved;

  const [response, setResponse] = useState("");
  // Track whether the user has been shown AI feedback yet. After they
  // submit a long-enough response, we kick off scoring and show the
  // coach reply BEFORE auto-advancing. (No feedback = silent ship was
  // tester complaint #4.)
  const [feedbackPhase, setFeedbackPhase] = useState("compose"); // compose | scoring | feedback
  const [aiFeedback, setAiFeedback] = useState(null);

  const sentenceCount = useMemo(() => countSentences(response), [response]);
  const meetsMinimum = sentenceCount >= MIN_RESPONSE_SENTENCES;

  const handleSubmitResponse = async () => {
    if (!meetsMinimum || disabled) return;
    setFeedbackPhase("scoring");
    // Best-effort AI feedback via the existing /api/audio/transcribe-ish
    // generic feedback endpoint — falls back to a friendly rubric note
    // if the network call fails or no key is configured.
    let coach = "";
    try {
      const backendBase = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";
      const r = await fetch(`${backendBase}/api/text-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "current-events",
          prompt: resolved?.studentTask || task?.prompt || "Respond to the current event.",
          context: `Story: ${resolved?.currentEventHeadline || resolved?.title || ""}\n${resolved?.eventSummary || ""}`,
          response: response.trim(),
        }),
      });
      const j = await r.json().catch(() => null);
      if (j?.feedback) coach = String(j.feedback);
    } catch {}
    if (!coach) {
      coach =
        "Thoughtful response. Strong responses connect the story to a specific idea or detail from your lesson and offer at least one of your own observations or questions — try to do both in your next one.";
    }
    setAiFeedback(coach);
    setFeedbackPhase("feedback");
  };

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({
        type: "current-events-response",
        text: response.trim(),
        sentenceCount,
        feedback: aiFeedback,
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

      {/* Top-of-task instruction line — testers couldn't tell what was
          expected of them. Sets up roles (Reader / Responder) and the
          fact that the story below is a real current event. */}
      <div style={instructionStrip}>
        You will be presented with <strong>an actual current event</strong>. One player
        <strong> reads it aloud</strong>; the team then <strong>responds in at least {MIN_RESPONSE_SENTENCES} sentences</strong>.
      </div>

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

      {feedbackPhase === "compose" && (
        <>
          <div style={{ ...cardLabel, marginTop: 4 }}>
            Your team's response · at least {MIN_RESPONSE_SENTENCES} sentences
          </div>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder={`Type at least ${MIN_RESPONSE_SENTENCES} sentences responding to the story above…`}
            disabled={disabled}
            style={textareaStyle}
            maxLength={1200}
          />

          {/* Live answer-quality speedometer (typed or dictated). */}
          <div style={{ margin: "8px 0" }}>
            <SpeechQualityMeter text={response} dark />
          </div>
          <div
            style={{
              fontSize: "0.78rem",
              color: meetsMinimum ? "#86efac" : "#cbd5e1",
              textAlign: "right",
              marginTop: -4,
            }}
          >
            {meetsMinimum
              ? `✓ ${sentenceCount} sentence${sentenceCount === 1 ? "" : "s"}`
              : `${sentenceCount} of ${MIN_RESPONSE_SENTENCES} sentences — keep going`}
          </div>
          <button
            type="button"
            onClick={handleSubmitResponse}
            disabled={!meetsMinimum || disabled}
            style={{
              ...continueBtn,
              opacity: !meetsMinimum || disabled ? 0.5 : 1,
              cursor: !meetsMinimum || disabled ? "not-allowed" : "pointer",
            }}
          >
            Submit response →
          </button>
        </>
      )}

      {feedbackPhase === "scoring" && (
        <div style={{ ...cardWrap, textAlign: "center" }}>
          <div className="ce-pulse" style={{ fontSize: "0.85rem", color: "#a78bfa", fontWeight: 700 }}>
            Reading your response…
          </div>
        </div>
      )}

      {feedbackPhase === "feedback" && (
        <>
          <div style={{ ...cardWrap, borderColor: "rgba(245,158,11,0.5)" }}>
            <div style={{ ...cardLabel, color: "#fde68a" }}>Coach's note on your response</div>
            <p style={{ ...bodyText, color: "#fef3c7" }}>{aiFeedback}</p>
          </div>
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
        </>
      )}

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
const instructionStrip = {
  fontSize: "0.88rem",
  color: "#e2e8f0",
  background: "rgba(59,130,246,0.10)",
  border: "1px solid rgba(59,130,246,0.35)",
  borderRadius: 10,
  padding: "10px 12px",
  lineHeight: 1.45,
};
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
