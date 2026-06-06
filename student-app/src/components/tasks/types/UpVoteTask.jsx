// student-app/src/components/tasks/types/UpVoteTask.jsx
//
// UpVote — debatable binary proposition. The whole task is ONE sentence:
// a claim that has at least two defensible viewpoints. The class votes
// For or Against, then sees the tally and the AI-surfaced strongest
// argument for each side.
//
// Three phases:
//   1. PRESENT — proposition shown for ~15s so everyone reads it.
//   2. VOTE    — For / Against buttons + countdown + optional reasoning.
//   3. REVEAL  — tally bar (For % vs Against %) + AI strongest-for /
//                strongest-against bullets. Practice mode also surfaces
//                a counter-argument that asks the solo player to
//                reconsider — turns it into a one-person dialectic.
//
// Live (socket) mode is intentionally minimal here: the student submits
// their vote via onSubmit and the runtime / teacher session aggregates.
// The tally we render in REVEAL is whatever the parent passes back as
// `task._tally` (set by the session runtime once votes close). Without
// a tally we render the player's own vote as the only data point.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../../config.js";

const PRESENT_SECONDS = 12;

export default function UpVoteTask({
  task,
  onSubmit,
  disabled,
  practiceMode = false,
}) {
  const cfg = task?.config || {};
  const proposition = String(cfg.proposition || task?.proposition || "").trim();
  const requireReasoning = !!cfg.requireReasoningOnSubmit;
  const voteTimeSeconds = Math.max(
    30,
    Math.min(300, Number(cfg.voteTimeSeconds) || 120)
  );
  const showRunningTally = cfg.showRunningTally !== false;

  // ── Phase state ──
  const [phase, setPhase] = useState("present"); // 'present' | 'vote' | 'reveal'
  const [presentRemaining, setPresentRemaining] = useState(PRESENT_SECONDS);
  const [voteRemaining, setVoteRemaining] = useState(voteTimeSeconds);
  const [vote, setVote] = useState(null); // 'for' | 'against' | null
  const [reasoning, setReasoning] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const reasoningRef = useRef(null);

  // ── AI counter-argument (practice mode) + strongest-for / strongest-against ──
  const [coachLoading, setCoachLoading] = useState(false);
  const [counterArg, setCounterArg] = useState("");
  const [strongestFor, setStrongestFor] = useState("");
  const [strongestAgainst, setStrongestAgainst] = useState("");

  // ── PRESENT phase countdown ──
  useEffect(() => {
    if (phase !== "present") return;
    if (presentRemaining <= 0) {
      setPhase("vote");
      return;
    }
    const t = setTimeout(() => setPresentRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, presentRemaining]);

  // ── VOTE phase countdown — only counts if no vote yet ──
  useEffect(() => {
    if (phase !== "vote") return;
    if (voteRemaining <= 0) {
      // Time's up — auto-advance to reveal even without a vote.
      handleSubmit({ abstained: vote == null });
      return;
    }
    const t = setTimeout(() => setVoteRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, voteRemaining]);

  // Skip the present phase early — useful for students who already read it.
  function skipPresent() {
    if (phase === "present") setPhase("vote");
  }

  // ── Submit + reveal ──
  function handleSubmit({ abstained = false } = {}) {
    if (submitted) return;
    if (!abstained && !vote) return; // user clicked submit before picking — ignore
    if (!abstained && requireReasoning && !reasoning.trim()) {
      reasoningRef.current?.focus();
      return;
    }
    setSubmitted(true);
    setPhase("reveal");
    // Fire-and-forget AI coach panel.
    askCoach({ side: vote, abstained });
    // Notify TaskRunner — payload mirrors other "participation" task shapes.
    if (typeof onSubmit === "function") {
      onSubmit({
        vote: abstained ? null : vote,
        reasoning: reasoning.trim() || null,
        abstained,
        practiceMode,
      });
    }
  }

  // ── Coach panel: fetches strongestFor / strongestAgainst, plus a
  //    targeted "have you considered..." counter-argument tailored to
  //    the player's vote. Practice mode = solo dialectic. ──
  async function askCoach({ side, abstained }) {
    if (!proposition) return;
    setCoachLoading(true);
    try {
      const payload = {
        proposition,
        playerVote: abstained ? null : side,
        worldview: cfg.worldview || "general",
        subject: cfg.subject || "",
        unitName: cfg.unitName || "",
        gradeLevel: cfg.gradeLevel || null,
      };
      const resp = await fetch(`${API_BASE_URL}/api/upvote/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`coach ${resp.status}`);
      const data = await resp.json();
      if (data?.strongestFor) setStrongestFor(String(data.strongestFor));
      if (data?.strongestAgainst) setStrongestAgainst(String(data.strongestAgainst));
      if (data?.counterArgument) setCounterArg(String(data.counterArgument));
    } catch {
      // Soft-fail — the tally still renders without coach text.
    } finally {
      setCoachLoading(false);
    }
  }

  // ── Tally (live mode: from parent; practice/solo: just your vote) ──
  const tally = useMemo(() => {
    const provided = task?._tally;
    if (provided && typeof provided === "object") {
      return {
        forCount: Number(provided.for) || 0,
        againstCount: Number(provided.against) || 0,
      };
    }
    // Solo / practice — your vote is the only data point.
    if (vote === "for") return { forCount: 1, againstCount: 0 };
    if (vote === "against") return { forCount: 0, againstCount: 1 };
    return { forCount: 0, againstCount: 0 };
  }, [task?._tally, vote]);

  const totalVotes = tally.forCount + tally.againstCount;
  const forPct = totalVotes ? Math.round((tally.forCount / totalVotes) * 100) : 50;
  const againstPct = totalVotes ? 100 - forPct : 50;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        color: "#0f172a",
        paddingBottom: 56,
      }}
    >
      {/* Prompt sentence */}
      {task?.prompt && (
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#475569", lineHeight: 1.45 }}>
          {task.prompt}
        </div>
      )}

      {/* Proposition card — the WHOLE task. Sized big and quoted. */}
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 18,
          background: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%)",
          border: "1px solid #c7d2fe",
          boxShadow: "0 8px 24px rgba(99,102,241,0.10)",
        }}
      >
        <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: 0.8, color: "#6366f1", textTransform: "uppercase", marginBottom: 8 }}>
          🗳 The proposition
        </div>
        <div style={{ fontSize: "1.15rem", fontWeight: 800, lineHeight: 1.35, color: "#0f172a" }}>
          “{proposition || "(no proposition set)"}”
        </div>
        {cfg.unitName && (
          <div style={{ marginTop: 8, fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>
            Unit: {cfg.unitName}
          </div>
        )}
      </div>

      {/* PRESENT phase */}
      {phase === "present" && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#78350f",
            fontWeight: 700,
            fontSize: "0.9rem",
          }}
        >
          📖 Read the proposition carefully — voting opens in {presentRemaining}s.
          <button
            type="button"
            onClick={skipPresent}
            style={{
              marginLeft: 12,
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid #b45309",
              background: "#fff",
              color: "#78350f",
              fontWeight: 800,
              fontSize: "0.78rem",
              cursor: "pointer",
            }}
          >
            I'm ready →
          </button>
        </div>
      )}

      {/* VOTE phase */}
      {phase === "vote" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#475569" }}>
              Cast your vote
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 800,
                color: voteRemaining < 20 ? "#dc2626" : "#475569",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ⏱ {voteRemaining}s
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setVote("for")}
              disabled={disabled}
              style={voteBtnStyle(vote === "for", "#16a34a", "#15803d")}
              aria-pressed={vote === "for"}
            >
              ✅ For
            </button>
            <button
              type="button"
              onClick={() => setVote("against")}
              disabled={disabled}
              style={voteBtnStyle(vote === "against", "#dc2626", "#b91c1c")}
              aria-pressed={vote === "against"}
            >
              ❌ Against
            </button>
          </div>

          {/* Optional reasoning textarea */}
          <div>
            <label
              htmlFor="upvote-reasoning"
              style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}
            >
              Why? {requireReasoning ? <span style={{ color: "#dc2626" }}>(required)</span> : <span style={{ color: "#94a3b8" }}>(optional — one sentence)</span>}
            </label>
            <textarea
              id="upvote-reasoning"
              ref={reasoningRef}
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value.slice(0, 400))}
              placeholder="One sentence defending your vote — strongest argument first."
              rows={2}
              disabled={disabled}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                fontSize: "0.92rem",
                lineHeight: 1.4,
                resize: "vertical",
                background: "#fff",
                color: "#0f172a",
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => handleSubmit({})}
            disabled={disabled || !vote || (requireReasoning && !reasoning.trim())}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: "none",
              background:
                !vote || (requireReasoning && !reasoning.trim()) ? "#94a3b8" : "#2563eb",
              color: "#fff",
              fontWeight: 800,
              fontSize: "0.98rem",
              cursor: !vote || (requireReasoning && !reasoning.trim()) ? "not-allowed" : "pointer",
              boxShadow: "0 6px 14px rgba(37,99,235,0.25)",
            }}
          >
            Lock in vote →
          </button>
        </div>
      )}

      {/* REVEAL phase — tally bar + strongest-side panels */}
      {phase === "reveal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Tally bar */}
          {showRunningTally && (
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#475569", marginBottom: 6 }}>
                {totalVotes > 0
                  ? `Class tally — ${totalVotes} vote${totalVotes === 1 ? "" : "s"}`
                  : "Class tally (no other votes yet)"}
              </div>
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: 28,
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "#e2e8f0",
                  border: "1px solid #cbd5e1",
                }}
              >
                <div
                  style={{
                    width: `${forPct}%`,
                    background: "linear-gradient(135deg, #16a34a, #15803d)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "width 0.5s ease-out",
                  }}
                >
                  {forPct >= 18 ? `For ${forPct}%` : ""}
                </div>
                <div
                  style={{
                    width: `${againstPct}%`,
                    background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "width 0.5s ease-out",
                  }}
                >
                  {againstPct >= 18 ? `Against ${againstPct}%` : ""}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>
                <span>✅ For: {tally.forCount}</span>
                <span>Against: {tally.againstCount} ❌</span>
              </div>
            </div>
          )}

          {/* Your vote chip */}
          {vote && (
            <div style={{ fontSize: "0.85rem", color: "#475569" }}>
              Your vote:{" "}
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: vote === "for" ? "#dcfce7" : "#fee2e2",
                  color: vote === "for" ? "#15803d" : "#b91c1c",
                  fontWeight: 800,
                }}
              >
                {vote === "for" ? "✅ For" : "❌ Against"}
              </span>
            </div>
          )}

          {/* AI strongest-for / strongest-against bullets */}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <SidePanel
              kind="for"
              title="Strongest case FOR"
              text={strongestFor}
              loading={coachLoading && !strongestFor}
            />
            <SidePanel
              kind="against"
              title="Strongest case AGAINST"
              text={strongestAgainst}
              loading={coachLoading && !strongestAgainst}
            />
          </div>

          {/* Practice-mode counter-argument — turns the solo round into a
              one-person dialectic so the player practices reconsidering. */}
          {practiceMode && counterArg && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fef3c7",
                border: "1px solid #fcd34d",
                color: "#78350f",
                fontWeight: 600,
                lineHeight: 1.5,
                fontSize: "0.92rem",
              }}
            >
              <div style={{ fontSize: "0.72rem", fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>
                🤔 Have you considered…
              </div>
              {counterArg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function voteBtnStyle(active, primaryColor, darkColor) {
  return {
    flex: 1,
    padding: "16px 18px",
    borderRadius: 16,
    border: active ? `3px solid ${darkColor}` : "3px solid transparent",
    background: active
      ? `linear-gradient(135deg, ${primaryColor}, ${darkColor})`
      : "#f1f5f9",
    color: active ? "#fff" : "#0f172a",
    fontWeight: 900,
    fontSize: "1.05rem",
    cursor: "pointer",
    boxShadow: active ? `0 8px 20px ${primaryColor}40` : "0 2px 6px rgba(15,23,42,0.05)",
    transition: "all 0.12s ease-out",
  };
}

function SidePanel({ kind, title, text, loading }) {
  const isFor = kind === "for";
  const tint = isFor ? "#16a34a" : "#dc2626";
  const bg = isFor ? "#f0fdf4" : "#fef2f2";
  const border = isFor ? "#bbf7d0" : "#fecaca";
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 900,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: tint,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "0.88rem", lineHeight: 1.45, color: "#0f172a", fontStyle: text ? "normal" : "italic" }}>
        {loading ? "Coach thinking…" : text || "(awaiting reasoning)"}
      </div>
    </div>
  );
}
