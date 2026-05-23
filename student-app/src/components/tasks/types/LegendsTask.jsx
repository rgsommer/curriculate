// student-app/src/components/tasks/types/LegendsTask.jsx
//
// "Legends" — 5W deduction game. The team sees a portrait (no name) plus 10
// facts in random order. Through 4 phases they sort facts into WHAT / WHERE /
// WHY / WHEN buckets (2/2/2/1 with 3 decoys). After all sorting completes,
// the legendary figure is revealed.
//
// Scoring: 2 pts per correct pick in a phase, -1 per wrong pick (clamped at 0).
// Bonus: +3 if the entire phase is solved on the first try.
//
// Anti-gaming: facts are shuffled per task instance; categories are server-known
// (server validates final score in handleStudentSubmit branch).
import React, { useEffect, useMemo, useState } from "react";

const PHASES = [
  { key: "what",  label: "WHAT did she do?",   prompt: "Tap the 2 facts that tell you WHAT she's famous for.",   needed: 2 },
  { key: "where", label: "WHERE did she live?", prompt: "Tap the 2 facts that tell you WHERE — location, place.", needed: 2 },
  { key: "why",   label: "WHY did she do it?", prompt: "Tap the 2 facts that tell you WHY — the motivation or need.", needed: 2 },
  { key: "when",  label: "WHEN did this happen?", prompt: "Tap the 1 fact that tells you WHEN.", needed: 1 },
];

function _shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function LegendsTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};
  const figure = cfg.figure || {};
  const factsRaw = Array.isArray(cfg.facts) ? cfg.facts : [];

  // Stable shuffle keyed off task id so re-renders don't re-shuffle the same instance
  const facts = useMemo(() => _shuffle(factsRaw.map((f, i) => ({ id: f.id || `f-${i}`, ...f }))), [factsRaw, task?.id, task?._taskIndex]);

  const [phaseIdx, setPhaseIdx] = useState(0);
  // assignments: factId → phaseKey | null. null means unsorted; "decoy" means actively-marked-as-decoy (we never expose this; decoys just stay unsorted).
  const [assignments, setAssignments] = useState({});
  const [picks, setPicks] = useState([]);                // current phase's picks in order
  const [phaseFlash, setPhaseFlash] = useState(null);    // brief feedback on wrong selection
  const [stats, setStats] = useState({ correct: 0, wrong: 0, perfectPhases: 0, points: 0 });
  const [revealed, setRevealed] = useState(false);

  const phase = PHASES[phaseIdx];

  const handleTap = (factId) => {
    if (disabled || revealed) return;
    if (picks.includes(factId)) return;             // already picked this round
    if (assignments[factId]) return;                // already assigned in a prior phase

    const fact = facts.find((f) => f.id === factId);
    const correct = fact?.category === phase.key;
    const newPicks = [...picks, factId];

    if (correct) {
      setStats((s) => ({ ...s, correct: s.correct + 1, points: s.points + 2 }));
    } else {
      // Wrong tap: flash + dock 1 point (clamped >=0). Still adds to the pick list so we don't infinite-pick.
      setStats((s) => ({ ...s, wrong: s.wrong + 1, points: Math.max(0, s.points - 1) }));
      setPhaseFlash({ factId, ts: Date.now() });
      setTimeout(() => setPhaseFlash(null), 700);
    }

    setPicks(newPicks);

    // Check if phase is complete (enough CORRECT picks)
    const correctPicksSoFar = newPicks.filter((id) => facts.find((f) => f.id === id)?.category === phase.key).length;
    if (correctPicksSoFar >= phase.needed) {
      // Lock the correct picks for this phase; clear incorrect picks (they remain unassigned for next phase)
      setAssignments((a) => {
        const next = { ...a };
        for (const id of newPicks) {
          const f = facts.find((ff) => ff.id === id);
          if (f && f.category === phase.key) next[id] = phase.key;
        }
        return next;
      });
      // Perfect phase bonus
      const wrongInPhase = newPicks.filter((id) => facts.find((f) => f.id === id)?.category !== phase.key).length;
      if (wrongInPhase === 0) {
        setStats((s) => ({ ...s, perfectPhases: s.perfectPhases + 1, points: s.points + 3 }));
      }
      // Advance
      setTimeout(() => {
        setPicks([]);
        if (phaseIdx + 1 < PHASES.length) {
          setPhaseIdx((p) => p + 1);
        } else {
          setRevealed(true);
        }
      }, 700);
    }
  };

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({
        type: "legends",
        assignments,
        stats,
        figure: figure.name,
        pointsEarned: stats.points,
        autoComplete: true,
      });
    }
  };

  /* ──────────────── Render ──────────────── */

  // Bundled local default so we never show a blank portrait. The
  // /demo-images/great-wave.svg is a public-domain placeholder that
  // ships with the app — visible immediately even if the AI-supplied
  // portraitUrl is missing or fails to load.
  // (great-wave.jpg was a 0-byte placeholder that never rendered.)
  const FALLBACK_PORTRAIT = "/demo-images/great-wave.svg";
  const portraitSrc = figure.portraitUrl || FALLBACK_PORTRAIT;

  if (revealed) {
    return (
      <div style={wrap}>
        <div style={revealHeader}>
          <div style={revealLabel}>This Legendary Figure Is…</div>
          <img
            src={portraitSrc}
            alt={figure.name || "Legendary figure"}
            referrerPolicy="no-referrer"
            onError={(e) => {
              if (e.target.src.indexOf(FALLBACK_PORTRAIT) === -1) {
                e.target.src = FALLBACK_PORTRAIT;
              }
            }}
            style={portraitLarge}
          />
          <div style={revealName}>{figure.name || "?"}</div>
          {figure.era ? <div style={{ ...revealEra }}>{figure.era}</div> : null}
          {figure.summary ? <p style={revealSummary}>{figure.summary}</p> : null}
        </div>

        <div style={statsCard}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "#a78bfa", marginBottom: 6 }}>Your team's run</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span><strong style={{ color: "#22c55e" }}>{stats.correct}</strong> correct</span>
            <span><strong style={{ color: "#ef4444" }}>{stats.wrong}</strong> wrong</span>
            <span><strong style={{ color: "#fde68a" }}>{stats.perfectPhases}</strong> / 4 perfect phases</span>
            <span><strong style={{ color: "#fbbf24" }}>+{stats.points}</strong> pts</span>
          </div>
        </div>

        <button type="button" onClick={handleContinue} disabled={disabled} style={primaryBtn}>
          Continue →
        </button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={tagStrip}>Legends · Phase {phaseIdx + 1} of {PHASES.length}</div>

      {/* Goal + how-to — testers didn't realise the aim is to identify WHO the
          hidden figure is, or that tapping matching facts advances the task. */}
      <div
        style={{
          alignSelf: "center",
          textAlign: "center",
          maxWidth: 560,
          margin: "2px auto 8px",
          color: "#e9d5ff",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>
          🕵️ Who is this mystery legend?
        </div>
        <div style={{ fontSize: "0.85rem", opacity: 0.85, lineHeight: 1.35, marginTop: 2 }}>
          Tap the facts that answer each question. Sort enough correct clues across all{" "}
          {PHASES.length} phases and the figure is revealed.
        </div>
      </div>

      <div style={portraitWrap}>
        <img
          src={portraitSrc}
          alt="A legendary figure"
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (e.target.src.indexOf(FALLBACK_PORTRAIT) === -1) {
              e.target.src = FALLBACK_PORTRAIT;
            }
          }}
          style={portrait}
        />
        <div style={mysteryOverlay}>?</div>
      </div>

      <h2 style={phaseTitle}>{phase.label}</h2>
      <p style={phasePrompt}>{phase.prompt}</p>

      <div style={progressLine}>
        Tapped: <strong>{picks.length}</strong> · need <strong>{phase.needed}</strong> correct · <span style={{ color: "#fbbf24" }}>+{stats.points}</span> pts
      </div>

      <div style={factGrid}>
        {facts.map((f) => {
          const assigned = assignments[f.id];
          const inPicks = picks.includes(f.id);
          const wasWrong = phaseFlash?.factId === f.id;
          const dimmed = !!assigned;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => handleTap(f.id)}
              disabled={disabled || dimmed}
              style={{
                ...factCard,
                ...(dimmed ? factCardAssigned : {}),
                ...(inPicks && !wasWrong ? factCardPicked : {}),
                ...(wasWrong ? factCardWrong : {}),
                cursor: dimmed ? "default" : "pointer",
              }}
            >
              <div style={{ fontSize: "0.92rem", lineHeight: 1.4 }}>{f.text}</div>
              {assigned ? (
                <span style={assignedBadge}>{assigned.toUpperCase()}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 14px",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 2,
  color: "#c4b5fd",
  alignSelf: "flex-start",
  padding: "2px 10px",
  background: "rgba(124,58,237,0.18)",
  borderRadius: 999,
};
const portraitWrap = {
  position: "relative",
  width: 188,
  height: 188,
  alignSelf: "center",
  borderRadius: "50%",
  overflow: "hidden",
  border: "3px solid #7c3aed",
  background: "rgba(15,23,42,0.5)",
};
const portrait = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  // Slight desaturation to hint at "mystery"; not blurred so the image is recognisable to teachers who know
  filter: "saturate(0.5) brightness(0.85)",
};
const mysteryOverlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "3rem",
  fontWeight: 900,
  color: "rgba(255,255,255,0.4)",
  pointerEvents: "none",
};
const phaseTitle = {
  fontSize: "1.3rem",
  fontWeight: 800,
  color: "#fde68a",
  textAlign: "center",
  margin: "6px 0 2px",
};
const phasePrompt = {
  fontSize: "0.9rem",
  color: "#cbd5e1",
  textAlign: "center",
  lineHeight: 1.4,
  margin: 0,
};
const progressLine = {
  fontSize: "0.78rem",
  color: "#94a3b8",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
};
const factGrid = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 8,
};
const factCard = {
  position: "relative",
  padding: "12px 14px",
  background: "rgba(15,23,42,0.7)",
  border: "1px solid #334155",
  borderRadius: 12,
  color: "#e2e8f0",
  textAlign: "left",
  transition: "all 200ms ease",
};
const factCardPicked = {
  background: "rgba(34,197,94,0.18)",
  borderColor: "#22c55e",
  transform: "scale(1.01)",
};
const factCardWrong = {
  background: "rgba(239,68,68,0.18)",
  borderColor: "#ef4444",
  animation: "legends-shake 0.3s ease",
};
const factCardAssigned = {
  opacity: 0.55,
  background: "rgba(124,58,237,0.10)",
  borderColor: "rgba(124,58,237,0.4)",
};
const assignedBadge = {
  display: "inline-block",
  marginTop: 6,
  fontSize: "0.62rem",
  fontWeight: 800,
  letterSpacing: 1,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(124,58,237,0.25)",
  color: "#c4b5fd",
  border: "1px solid rgba(124,58,237,0.5)",
};
const revealHeader = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 8,
  padding: "12px 0",
};
const revealLabel = {
  fontSize: "0.72rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 2,
  color: "#c4b5fd",
};
const portraitLarge = {
  width: 160,
  height: 160,
  borderRadius: "50%",
  border: "4px solid #fde68a",
  background: "rgba(15,23,42,0.5)",
  objectFit: "cover",
  boxShadow: "0 0 24px rgba(251,191,36,0.4)",
};
const revealName = {
  fontSize: "1.7rem",
  fontWeight: 900,
  color: "#fde68a",
};
const revealEra = {
  fontSize: "0.85rem",
  color: "#a78bfa",
  fontStyle: "italic",
};
const revealSummary = {
  fontSize: "0.95rem",
  color: "#e2e8f0",
  lineHeight: 1.5,
  maxWidth: 440,
  margin: "8px auto 0",
};
const statsCard = {
  padding: 12,
  background: "rgba(30,41,59,0.6)",
  border: "1px solid rgba(124,58,237,0.3)",
  borderRadius: 12,
  fontSize: "0.85rem",
  color: "#cbd5e1",
};
const primaryBtn = {
  padding: "12px 28px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 14,
  background: "linear-gradient(135deg, #fbbf24, #d97706)",
  color: "#1f2937",
  cursor: "pointer",
  alignSelf: "center",
  marginTop: 6,
};
