// student-app/src/components/tasks/types/WhatAmITask.jsx
//
// "What Am I?" — deduction task with progressive clue reveal + decaying point ceiling.
//
// Modes:
// - solo / intra-team: each team manages its own reveal ceiling.
// - inter-team: server-authoritative GLOBAL ceiling that drops for everyone when ANY team reveals.
//
// Wiring:
// - Practice/demo path (no socket): everything runs locally via the inline matcher and ceiling.
// - Live path (socket prop supplied): `whatAmI:revealClue` is emitted to the server; the server's
//   ACK provides the authoritative ceiling. Inter-team broadcasts arrive via `whatAmI:clueRevealed`,
//   and `whatAmI:firstCorrect` locks the round. `whatAmI:frozen` honours teacher freeze.
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ──────────────── Answer matching (client-side, MVP) ──────────────── */
function _normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function isAcceptable(submission, config) {
  const sub = _normalize(submission);
  if (!sub) return { ok: false, strategy: "empty" };
  const canonical = _normalize(config?.answer);
  const variants = Array.isArray(config?.acceptableAnswers) ? config.acceptableAnswers.map(_normalize) : [];
  const candidates = Array.from(new Set([canonical, ...variants].filter(Boolean)));

  // Exact
  if (candidates.includes(sub)) return { ok: true, strategy: "exact" };

  // Substring (catches "durham report" matching "lord durham s report")
  for (const c of candidates) {
    if (!c) continue;
    if (sub.includes(c) || c.includes(sub)) return { ok: true, strategy: "substring" };
  }

  // Fuzzy on shortest candidate, tolerance scales with length
  const shortest = candidates.reduce((a, b) => (a.length <= b.length ? a : b), candidates[0] || "");
  if (shortest) {
    const tolerance = shortest.length <= 6 ? 1 : shortest.length <= 12 ? 2 : 3;
    if (_levenshtein(sub, shortest) <= tolerance) return { ok: true, strategy: "fuzzy" };
  }

  return { ok: false, strategy: "miss" };
}

/* ──────────────── Point computation ──────────────── */
function pointsForReveal(revealedCount, totalClues, perClueCurve) {
  if (Array.isArray(perClueCurve) && perClueCurve.length > 0) {
    return perClueCurve[Math.min(revealedCount, perClueCurve.length - 1)] ?? 1;
  }
  // Fallback default curve
  const def = [10, 8, 6, 4, 2];
  while (def.length < totalClues + 1) def.push(Math.max(1, def[def.length - 1] - 1));
  return def[Math.min(revealedCount, def.length - 1)];
}

// Bonus points for spelling the answer exactly (vs. an accepted fuzzy match).
const EXACT_SPELLING_BONUS = 2;

/* ──────────────── Component ──────────────── */
export default function WhatAmITask({ task, onSubmit, disabled, socket, roomCode, teamId, taskIndex }) {
  const rawCfg = task?.config || {};

  // Pool rotation: if `config.pool` is present, pick one entry deterministically by _taskIndex
  // (same pattern as RiddleTask). This lets practice/demo cycle through multiple concepts
  // instead of replaying the same one. Falls back to the top-level answer/clues/acceptableAnswers.
  const cfg = useMemo(() => {
    const pool = Array.isArray(rawCfg.pool) ? rawCfg.pool.filter(Boolean) : [];
    if (pool.length === 0) return rawCfg;
    const pickIdx =
      typeof task?._taskIndex === "number"
        ? task._taskIndex
        : (String(task?.id || "")
            .split("")
            .reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 0)) || 0;
    const picked = pool[Math.abs(pickIdx) % pool.length] || pool[0];
    return {
      ...rawCfg,
      answer: picked.answer ?? rawCfg.answer,
      acceptableAnswers: Array.isArray(picked.acceptableAnswers)
        ? picked.acceptableAnswers
        : rawCfg.acceptableAnswers,
      clues: Array.isArray(picked.clues) ? picked.clues : rawCfg.clues,
    };
  }, [rawCfg, task?._taskIndex, task?.id]);

  const clues = useMemo(() => (Array.isArray(cfg.clues) ? cfg.clues : []), [cfg.clues]);
  const totalClues = clues.length;

  // perClueCurve is length = totalClues + 1; index 0 = "0 clues revealed yet"
  const perClueCurve = Array.isArray(cfg?.scoring?.perClueCurve) ? cfg.scoring.perClueCurve : null;
  const lockoutMs = Number(cfg?.penalties?.lockoutMs) || 8000;
  const mode = cfg.mode || "intra-team";
  const isInterTeam = mode === "inter-team";
  const isLive = !!(socket && roomCode && teamId);

  // ── State ──
  const [revealedCount, setRevealedCount] = useState(0);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null); // { ok, pts, strategy } | null
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [ceilingFlash, setCeilingFlash] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [interTeamLocked, setInterTeamLocked] = useState(false);
  const [revealedByTeacher, setRevealedByTeacher] = useState(false);
  const inputRef = useRef(null);
  const taskIdxRef = useRef(Number.isFinite(Number(taskIndex)) ? Number(taskIndex) : task?._taskIndex);

  // Tick `now` while a lockout is active (or briefly after a ceiling change for the flash)
  useEffect(() => {
    if (lockoutUntil <= 0 && !ceilingFlash) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [lockoutUntil, ceilingFlash]);

  // Briefly flash the ceiling when a clue is revealed
  useEffect(() => {
    if (revealedCount === 0) return;
    setCeilingFlash(true);
    const t = setTimeout(() => setCeilingFlash(false), 600);
    return () => clearTimeout(t);
  }, [revealedCount]);

  // Auto-focus input on mount
  useEffect(() => {
    if (inputRef.current && !disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [disabled]);

  // ── Server-authoritative ceiling: hydrate + subscribe (live path only) ──
  useEffect(() => {
    if (!isLive) return;
    const idx = taskIdxRef.current;

    // Ask server for the current snapshot. In inter-team mode the server's globalRevealed
    // may already be > 0 if another team revealed before we mounted.
    socket.emit(
      "whatAmI:requestState",
      { roomCode, teamId, taskIndex: idx },
      (resp) => {
        if (!resp || !resp.ok) return;
        if (typeof resp.revealedCount === "number") setRevealedCount(resp.revealedCount);
        if (typeof resp.frozen === "boolean") setFrozen(resp.frozen);
        if (resp.locked) setInterTeamLocked(true);
      },
    );

    const onClueRevealed = (msg) => {
      if (!msg || msg.taskIndex !== idx) return;
      if (typeof msg.newLevel === "number") setRevealedCount((cur) => Math.max(cur, msg.newLevel));
      if (msg.revealedBy === "teacher") setRevealedByTeacher(true);
    };
    const onFirstCorrect = (msg) => {
      if (!msg || msg.taskIndex !== idx) return;
      if (msg.teamId !== teamId) setInterTeamLocked(true);
    };
    const onFrozen = (msg) => {
      if (!msg || msg.taskIndex !== idx) return;
      setFrozen(!!msg.frozen);
    };

    socket.on("whatAmI:clueRevealed", onClueRevealed);
    socket.on("whatAmI:firstCorrect", onFirstCorrect);
    socket.on("whatAmI:frozen", onFrozen);
    return () => {
      socket.off("whatAmI:clueRevealed", onClueRevealed);
      socket.off("whatAmI:firstCorrect", onFirstCorrect);
      socket.off("whatAmI:frozen", onFrozen);
    };
  }, [isLive, socket, roomCode, teamId]);

  const lockoutRemainingMs = Math.max(0, lockoutUntil - now);
  const isLockedOut = lockoutRemainingMs > 0;
  const inputDisabled = disabled || submitted || isLockedOut || frozen || interTeamLocked;

  const pointCeiling = pointsForReveal(revealedCount, totalClues, perClueCurve);

  // ── Handlers ──
  const handleReveal = () => {
    if (revealedCount >= totalClues || submitted || isLockedOut || frozen || interTeamLocked) return;
    if (isLive) {
      // Optimistic update; server ACK can correct via authoritative value
      setRevealedCount((r) => r + 1);
      socket.emit(
        "whatAmI:revealClue",
        { roomCode, teamId, taskIndex: taskIdxRef.current },
        (resp) => {
          if (resp && resp.ok && typeof resp.newLevel === "number") {
            setRevealedCount(resp.newLevel);
          } else if (resp && resp.frozen) {
            setFrozen(true);
          } else if (resp && resp.locked) {
            setInterTeamLocked(true);
          }
        },
      );
    } else {
      setRevealedCount((r) => r + 1);
    }
  };

  const handleSubmit = () => {
    if (inputDisabled || !answer.trim()) return;
    const r = isAcceptable(answer, cfg);
    if (r.ok) {
      // Reward exact spelling (tester typed "Elcipse" for "Solar Eclipse" via
      // fuzzy match and asked if exact would earn more — yes, +2 bonus).
      const exactBonus = r.strategy === "exact" ? EXACT_SPELLING_BONUS : 0;
      const pts = pointCeiling + exactBonus;
      setResult({ ok: true, pts, strategy: r.strategy, exactBonus });
      setSubmitted(true);
    } else {
      // Wrong → lockout
      setResult({ ok: false, pts: 0, strategy: r.strategy });
      setLockoutUntil(Date.now() + lockoutMs);
      setNow(Date.now());
      // Clear the wrong-answer indicator after the lockout ends
      setTimeout(() => {
        setResult((cur) => (cur && cur.ok ? cur : null));
      }, lockoutMs + 100);
    }
  };

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({
        answer: answer.trim(),
        correct: !!result?.ok,
        cluesRevealed: revealedCount,
        totalClues,
        pointsEarned: result?.ok ? result.pts : 0,
        strategy: result?.strategy || null,
        exactBonus: result?.exactBonus || 0,
        autoComplete: true,
      });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (submitted) handleContinue();
      else handleSubmit();
    }
  };

  /* ──────────────── Styles ──────────────── */
  const wrap = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: "60vh",
    padding: "20px 14px",
    gap: 14,
    width: "100%",
    maxWidth: 520,
    margin: "0 auto",
  };
  const titleStyle = {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#a78bfa",
  };
  const bigQ = {
    fontSize: "2rem",
    fontWeight: 800,
    color: "#f1f5f9",
    textAlign: "center",
    margin: "2px 0 6px",
  };
  const promptStyle = {
    fontSize: "0.95rem",
    color: "#cbd5e1",
    textAlign: "center",
    lineHeight: 1.45,
    maxWidth: 440,
  };
  const ceilingWrap = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    background: ceilingFlash ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.10)",
    color: "#22c55e",
    border: `1px solid rgba(34,197,94,${ceilingFlash ? 0.5 : 0.3})`,
    borderRadius: 999,
    fontSize: "0.95rem",
    fontWeight: 700,
    transition: "all 400ms ease",
  };
  const clueBox = {
    width: "100%",
    padding: "14px 16px",
    background: "rgba(139,92,246,0.13)",
    border: "1px solid rgba(139,92,246,0.3)",
    borderRadius: 14,
    color: "#e2e8f0",
    fontSize: "1rem",
    lineHeight: 1.45,
    animation: "wai-slidein 0.35s ease-out",
  };
  const clueLabel = {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#a78bfa",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  };
  const revealBtn = {
    background: "rgba(139,92,246,0.18)",
    border: "1px dashed rgba(139,92,246,0.45)",
    color: "#c4b5fd",
    padding: "12px 22px",
    borderRadius: 12,
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: revealedCount >= totalClues || submitted || isLockedOut ? "not-allowed" : "pointer",
    opacity: revealedCount >= totalClues || submitted || isLockedOut ? 0.45 : 1,
    width: "100%",
    maxWidth: 360,
  };
  const inputStyle = {
    width: "100%",
    padding: "14px 16px",
    fontSize: "1.05rem",
    borderRadius: 12,
    border: "1px solid #475569",
    background: "rgba(15,23,42,0.6)",
    color: "#f1f5f9",
    outline: "none",
  };
  const submitBtn = {
    background: "linear-gradient(135deg, #22c55e, #16a34a)",
    border: "none",
    borderRadius: 12,
    padding: "12px 28px",
    color: "#fff",
    fontWeight: 700,
    fontSize: "1rem",
    cursor: inputDisabled || !answer.trim() ? "not-allowed" : "pointer",
    opacity: inputDisabled || !answer.trim() ? 0.5 : 1,
    boxShadow: "0 4px 14px rgba(34,197,94,0.3)",
    minWidth: 140,
  };
  const lockoutPill = {
    fontSize: "0.85rem",
    color: "#fca5a5",
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.35)",
    padding: "6px 14px",
    borderRadius: 999,
    fontWeight: 600,
  };
  const resultBoxOk = {
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#22c55e",
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.4)",
    padding: "14px 22px",
    borderRadius: 14,
    textAlign: "center",
  };
  const resultBoxBad = {
    fontSize: "0.95rem",
    color: "#fca5a5",
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.35)",
    padding: "10px 16px",
    borderRadius: 12,
    textAlign: "center",
  };

  /* ──────────────── Render ──────────────── */
  return (
    <div style={wrap}>
      <div style={titleStyle}>Deduction Challenge</div>
      <div style={bigQ}>What am I?</div>
      {task?.prompt ? <div style={promptStyle}>{task.prompt}</div> : null}

      {/* Inter-team / freeze status banners */}
      {frozen && (
        <div style={{
          fontSize: "0.85rem", color: "#fbbf24",
          background: "rgba(251,191,36,0.12)",
          border: "1px solid rgba(251,191,36,0.35)",
          padding: "8px 14px", borderRadius: 999, fontWeight: 600,
        }}>
          ⏸ Frozen by teacher
        </div>
      )}
      {interTeamLocked && (
        <div style={{
          fontSize: "0.85rem", color: "#94a3b8",
          background: "rgba(148,163,184,0.12)",
          border: "1px solid rgba(148,163,184,0.35)",
          padding: "8px 14px", borderRadius: 999, fontWeight: 600,
        }}>
          🔒 Another team locked it in — consolation points only
        </div>
      )}
      {revealedByTeacher && !submitted && (
        <div style={{
          fontSize: "0.75rem", color: "#a78bfa",
          fontWeight: 600, fontStyle: "italic",
        }}>
          Teacher revealed a clue
        </div>
      )}

      {/* Point ceiling */}
      <div style={ceilingWrap}>
        <span>🎯</span>
        <span>Worth {pointCeiling} pt{pointCeiling === 1 ? "" : "s"} now</span>
        {isInterTeam && isLive && (
          <span style={{ fontSize: "0.7rem", opacity: 0.7, marginLeft: 4 }}>(class ceiling)</span>
        )}
      </div>

      {/* Revealed clues, in order */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        {clues.slice(0, revealedCount).map((c, i) => (
          <div key={`clue-${i}`} style={clueBox}>
            <div style={clueLabel}>Clue {c.level ?? i + 1}</div>
            <div>{c.text}</div>
          </div>
        ))}
      </div>

      {/* Reveal next clue */}
      {revealedCount < totalClues && !submitted && (
        <button onClick={handleReveal} disabled={isLockedOut} style={revealBtn}>
          + Reveal Clue {revealedCount + 1} of {totalClues}
          <div style={{ fontSize: "0.72rem", fontWeight: 500, opacity: 0.8, marginTop: 2 }}>
            (Drops the ceiling to {pointsForReveal(revealedCount + 1, totalClues, perClueCurve)} pts)
          </div>
        </button>
      )}

      {revealedCount === 0 && !submitted && (
        <div style={{ fontSize: "0.85rem", color: "#94a3b8", textAlign: "center", maxWidth: 380 }}>
          Tap "Reveal Clue" for a hint, or take your best guess for max points.
        </div>
      )}

      {/* Answer input */}
      {!submitted && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type your answer…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={inputDisabled}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{
              ...inputStyle,
              opacity: inputDisabled ? 0.5 : 1,
              borderColor: result?.ok === false && !isLockedOut ? "#475569" : isLockedOut ? "#ef4444" : "#475569",
            }}
          />
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button onClick={handleSubmit} disabled={inputDisabled || !answer.trim()} style={submitBtn}>
              Submit Guess
            </button>
          </div>
          {isLockedOut && (
            <div style={lockoutPill}>
              Wrong answer — try again in {Math.ceil(lockoutRemainingMs / 1000)}s
            </div>
          )}
          {result && !result.ok && !isLockedOut && (
            <div style={resultBoxBad}>Not quite — keep trying!</div>
          )}
        </div>
      )}

      {/* Success state */}
      {submitted && result?.ok && (
        <>
          <div style={{ fontSize: "2.5rem", animation: "wai-pop 0.5s ease-out" }}>🎉</div>
          <div style={resultBoxOk}>
            Correct! <span style={{ opacity: 0.8, fontWeight: 600 }}>+{result.pts} pts</span>
            <div style={{ fontSize: "0.85rem", fontWeight: 500, marginTop: 6, color: "#86efac" }}>
              The answer: <strong style={{ color: "#bbf7d0" }}>{cfg.answer}</strong>
            </div>
            {result.exactBonus > 0 ? (
              <div style={{ fontSize: "0.8rem", fontWeight: 700, marginTop: 6, color: "#fde68a" }}>
                ✨ +{result.exactBonus} bonus for exact spelling!
              </div>
            ) : result.strategy === "fuzzy" || result.strategy === "substring" ? (
              <div style={{ fontSize: "0.8rem", fontWeight: 500, marginTop: 6, color: "#fcd34d" }}>
                Close enough! Spelling it exactly earns a +{EXACT_SPELLING_BONUS} bonus next time.
              </div>
            ) : null}
          </div>
          <button
            onClick={handleContinue}
            disabled={disabled}
            style={{
              marginTop: 4,
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              border: "none",
              borderRadius: 14,
              padding: "12px 32px",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
            }}
          >
            Continue →
          </button>
        </>
      )}

      <style>{`
        @keyframes wai-slidein {
          0%   { transform: translateY(-6px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes wai-pop {
          0%   { transform: scale(0.4) rotate(-8deg); opacity: 0; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
