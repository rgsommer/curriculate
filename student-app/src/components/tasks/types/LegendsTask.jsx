// student-app/src/components/tasks/types/LegendsTask.jsx
//
// "Legends" — learn the 5Ws of a KNOWN legendary figure. The figure's name and
// portrait are shown up front ("Marie Curie is a legend") — this is NOT a
// guess-who. Through 4 phases the team sorts 10 facts (random order) into
// WHAT / WHERE / WHY / WHEN buckets (2/2/2/1 with 3 decoys) to map out the
// legend's story.
//
// Scoring: 2 pts per correct pick in a phase, -1 per wrong pick (clamped at 0).
// Bonus: +3 if the entire phase is solved on the first try.
//
// Anti-gaming: facts are shuffled per task instance; categories are server-known
// (server validates final score in handleStudentSubmit branch).
import React, { useEffect, useMemo, useState } from "react";
import reportImageFailure from "../../../utils/reportImageFailure.js";

const PHASES = [
  { key: "what",  needed: 2 },
  { key: "where", needed: 2 },
  { key: "why",   needed: 2 },
  { key: "when",  needed: 1 },
];

// The figure is KNOWN, so phase text names them directly (not "she").
const PHASE_TEXT = {
  what:  (n) => ({ label: `WHAT is ${n} known for?`,   prompt: `Tap the 2 facts about WHAT ${n} did or is famous for.` }),
  where: (n) => ({ label: `WHERE did ${n} live & work?`, prompt: `Tap the 2 facts about WHERE — places connected to ${n}.` }),
  why:   (n) => ({ label: `WHY did ${n} do it?`,        prompt: `Tap the 2 facts about WHY — ${n}'s motivation or purpose.` }),
  when:  (n) => ({ label: `WHEN did it happen?`,        prompt: `Tap the 1 fact about WHEN ${n} lived or worked.` }),
};

// Pronouns by the figure's documented birth sex (Curriculate names real,
// historical people — so we use he/she/his/her, not "they"). The generator
// supplies figure.gender ("male" | "female"); we fall back to neutral wording
// only when it's genuinely unknown.
function _pronouns(figure = {}) {
  const g = String(figure.gender || figure.sex || figure.pronoun || "").trim().toLowerCase();
  if (g.startsWith("m") || g === "he" || g === "him" || g === "his") {
    return { subj: "he", obj: "him", poss: "his", possName: "his" };
  }
  if (g.startsWith("f") || g === "she" || g === "her" || g === "hers") {
    return { subj: "she", obj: "her", poss: "her", possName: "her" };
  }
  // Unknown → name-based wording instead of "they" (keeps it concrete).
  return { subj: null, obj: null, poss: null, possName: null };
}

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

  // The legend is KNOWN — name the phases after them.
  const who = String(figure.name || "this legend").trim();
  const pr = useMemo(() => _pronouns(figure), [figure]);
  // Possessive for the banner: "his/her life" when sex is known, else "their".
  const possLife = pr.poss ? `${pr.poss} life` : "their life";
  const phases = useMemo(
    () => PHASES.map((p) => ({ ...p, ...(PHASE_TEXT[p.key]?.(who) || {}) })),
    [who]
  );

  const [phaseIdx, setPhaseIdx] = useState(0);
  // assignments: factId → phaseKey | null. null means unsorted; "decoy" means actively-marked-as-decoy (we never expose this; decoys just stay unsorted).
  const [assignments, setAssignments] = useState({});
  const [picks, setPicks] = useState([]);                // current phase's picks in order
  const [phaseFlash, setPhaseFlash] = useState(null);    // brief feedback on wrong selection
  const [stats, setStats] = useState({ correct: 0, wrong: 0, perfectPhases: 0, points: 0 });
  const [revealed, setRevealed] = useState(false);

  const phase = phases[phaseIdx];

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
        if (phaseIdx + 1 < phases.length) {
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

  // Bundled local default — a generic "mystery person" silhouette so a missing
  // or failed portrait still reads as an unknown FIGURE (the old great-wave.svg
  // fallback showed a seascape, which made no sense for "guess the legend").
  // Real portraits are pre-generated to S3 at taskset creation (see
  // taskImageGen.js); this only shows when none is available.
  const FALLBACK_PORTRAIT = "/demo-images/mystery-portrait.svg";
  const portraitSrc = figure.portraitUrl || FALLBACK_PORTRAIT;

  if (revealed) {
    return (
      <div style={wrap}>
        <div style={revealHeader}>
          <div style={revealLabel}>You mapped this legend's story:</div>
          <img
            src={portraitSrc}
            alt={figure.name || "Legendary figure"}
            referrerPolicy="no-referrer"
            onError={(e) => {
              if (e.target.src.indexOf(FALLBACK_PORTRAIT) === -1) {
                reportImageFailure({ taskType: "legends", url: e.target.src, source: "portrait" });
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
      <div style={tagStrip}>Legends · Phase {phaseIdx + 1} of {phases.length}</div>

      {/* The legend is KNOWN — show name + clear portrait up front. This is NOT
          a guess-who; the task is to sort the facts about their life. */}
      <div style={portraitWrap}>
        <img
          src={portraitSrc}
          alt={who}
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (e.target.src.indexOf(FALLBACK_PORTRAIT) === -1) {
              reportImageFailure({ taskType: "legends", url: e.target.src, source: "portrait" });
              e.target.src = FALLBACK_PORTRAIT;
            }
          }}
          style={portrait}
        />
      </div>

      <div style={{ alignSelf: "center", textAlign: "center", maxWidth: 560, margin: "2px auto 6px", color: "#e9d5ff" }}>
        <div style={{ fontWeight: 1000, fontSize: "1.35rem", color: "#fff" }}>{who}</div>
        {figure.era ? <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>{figure.era}</div> : null}
        <div style={{ fontSize: "0.85rem", opacity: 0.9, lineHeight: 1.35, marginTop: 4 }}>
          A legend! Sort the facts about {possLife} into <b>What · Where · Why · When</b>.
        </div>
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

      {/* Let the team wrap up early if they're stuck on a phase (the figure is
          already known — this just jumps to the summary). */}
      <button
        type="button"
        onClick={() => setRevealed(true)}
        disabled={disabled}
        style={{
          alignSelf: "center",
          marginTop: 4,
          padding: "8px 16px",
          borderRadius: 999,
          border: "1px solid rgba(167,139,250,0.5)",
          background: "rgba(124,58,237,0.12)",
          color: "#e9d5ff",
          fontWeight: 800,
          fontSize: "0.85rem",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        ✓ Done — wrap up
      </button>
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
  // Shown clearly — the legend is known up front (not a guess-who).
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
// Sorted facts are ALWAYS correct (wrong taps flash red and never get assigned),
// so keep them GREEN as a persistent correct-answer overlay rather than dimming
// to purple (tester: "only turn green if it is correct… serves as a correct
// answer overlay").
const factCardAssigned = {
  opacity: 0.92,
  background: "rgba(34,197,94,0.16)",
  borderColor: "rgba(34,197,94,0.55)",
};
const assignedBadge = {
  display: "inline-block",
  marginTop: 6,
  fontSize: "0.62rem",
  fontWeight: 800,
  letterSpacing: 1,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.22)",
  color: "#bbf7d0",
  border: "1px solid rgba(34,197,94,0.5)",
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
  width: 224,
  height: 224,
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
