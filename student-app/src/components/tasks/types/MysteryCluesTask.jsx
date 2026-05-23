// student-app/src/components/tasks/types/MysteryCluesTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// MysteryCluesTask
//
// Purpose:
// - Non-final tasks may briefly reveal 1+ "mystery clue cards" (emoji/text tokens)
//   for students to memorize. These auto-hide after REVEAL_MS.
// - The final task (isFinal: true) becomes the recall challenge: students select
//   exactly the revealed clues from a larger grid to earn a bonus.
//
// Storage model:
// - We store the cumulative revealed clues in sessionStorage so it persists across
//   tasks within the same task set on the same device.
// -----------------------------------------------------------------------------

const REVEAL_MS_DEFAULT = 8000;
const BONUS_DEFAULT = 10;
// Reveal "shuffle" cadence: the clue cards re-order with a flip every SHUFFLE_MS
// during the reveal window (tester: "appear, shuffle, appear, shuffle, then
// choose") so it's an actual memory challenge, not a static peek.
const SHUFFLE_MS = 1200;

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic shuffle (stable across re-renders for a given seed).
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = (seed >>> 0) || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A safe default grid of 20 items (emojis are best, but any short token works)
const DEFAULT_GRID = [
  "🍎",
  "🐱",
  "🚀",
  "🌙",
  "⚽️",
  "🎸",
  "📚",
  "🧩",
  "🗝️",
  "🧠",
  "🌎",
  "⏳",
  "🔥",
  "💎",
  "🎯",
  "🔍",
  "🧪",
  "🧭",
  "🏰",
  "🌟",
];

function uniqClean(arr) {
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    const v = String(x ?? "").trim();
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function asKeyParts(task) {
  // Try hard to bind storage to the current task set / session.
  const a = task?.taskSetId || task?.tasksetId || task?.demoTasksetId || "";
  const b = task?.sessionId || task?.roomCode || task?.room || "";
  const c = task?.teamId || task?.team || task?.station || "";
  return [a, b, c].filter(Boolean).join("|") || "default";
}

function storageKey(task) {
  return `curriculate:mysteryClues:${asKeyParts(task)}`;
}

function loadRevealed(task) {
  try {
    const raw = sessionStorage.getItem(storageKey(task));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return uniqClean(parsed);
  } catch {
    return [];
  }
}

function saveRevealed(task, revealed) {
  try {
    sessionStorage.setItem(storageKey(task), JSON.stringify(uniqClean(revealed)));
  } catch {
    // ignore
  }
}

function arraysEqualAsSets(a, b) {
  const A = new Set(uniqClean(a));
  const B = new Set(uniqClean(b));
  if (A.size !== B.size) return false;
  for (const v of A) if (!B.has(v)) return false;
  return true;
}

function Card({ value, big = false }) {
  return (
    <div
      style={{
        width: big ? 92 : 72,
        height: big ? 92 : 72,
        borderRadius: 18,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.22)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: big ? 42 : 34,
        fontWeight: 900,
        color: "#fff",
        userSelect: "none",
      }}
      aria-label={`Clue card ${value}`}
    >
      {value}
    </div>
  );
}

function Pill({ children }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "#fff",
        fontWeight: 900,
        letterSpacing: 0.2,
      }}
    >
      {children}
    </div>
  );
}

export default function MysteryCluesTask({ task, onSubmit, disabled, practiceMode = false }) {
  // Practice mode = single isolated task with no "earlier cards to recall
  // from session storage". Make it a self-contained mini-game: reveal
  // clues briefly, hide, then ask the user to pick them out of a grid.
  // Tester (Bernadette, May 2026): 'Keeps cycling the victory video but
  // as far as I can see there is no actual clue revealed.' The
  // non-practice flow assumes a multi-task session where earlier reveal
  // cards seed sessionStorage, which never happens in solo practice.
  const isFinal = practiceMode ? false : !!task?.isFinal;
  const revealMs = Number(task?.revealMs ?? REVEAL_MS_DEFAULT) || REVEAL_MS_DEFAULT;
  const bonusPoints = Number(task?.bonusPoints ?? BONUS_DEFAULT) || BONUS_DEFAULT;

  // Pull clues from any of the common shapes the AI may produce.
  // Fall back to a small slice of DEFAULT_GRID so the task is *always*
  // playable — testers reported a hard error ("This task was generated
  // without a clues array") which we now treat as soft-recoverable.
  const cluesThisTask = useMemo(() => {
    const declared = uniqClean(task?.clues || task?.clueCards || task?.config?.clues || []);
    if (declared.length > 0) return declared;
    if (isFinal) return [];
    // Non-final / mid-session card with no clues: pick a deterministic
    // 3-emoji slice so each card is consistent on repeat plays.
    const seedSrc = String(task?.id || task?.title || "mystery").slice(0, 32);
    let seed = 0;
    for (let i = 0; i < seedSrc.length; i += 1) seed = (seed * 31 + seedSrc.charCodeAt(i)) | 0;
    const start = Math.abs(seed) % Math.max(1, DEFAULT_GRID.length - 3);
    return DEFAULT_GRID.slice(start, start + 3);
  }, [task, isFinal]);
  const usingFallbackClues =
    !isFinal &&
    cluesThisTask.length > 0 &&
    !uniqClean(task?.clues || task?.clueCards || task?.config?.clues || []).length;

  const [phase, setPhase] = useState(isFinal ? "recall" : (cluesThisTask.length ? "reveal" : "noop"));
  const [revealLeftMs, setRevealLeftMs] = useState(revealMs);
  const [selected, setSelected] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null); // {correct, revealed, selected}
  // Practice mode self-recall: once the reveal hides, the user must
  // pick the clues they just saw from a grid of distractors. This
  // makes the task a complete game rather than "just memorize and move
  // on" (which is what Bernadette saw).
  const [practiceRecallPhase, setPracticeRecallPhase] = useState(false);
  // Order the reveal cards are shown in; reshuffles during the reveal window.
  const [revealOrder, setRevealOrder] = useState(() => cluesThisTask.map((_, i) => i));
  const [shuffleTick, setShuffleTick] = useState(0);
  const treatAsFinal = isFinal || practiceRecallPhase;

  const revealedAll = useMemo(() => {
    // In practice mode the storage-based session log is empty (no
    // earlier tasks), so use the clues we just revealed in THIS task.
    if (practiceMode) return uniqClean(cluesThisTask);
    return loadRevealed(task);
  }, [task, practiceMode, cluesThisTask]);

  const tickRef = useRef(null);
  const startRef = useRef(null);

  // When entering a non-final reveal task, merge clues into storage immediately.
  useEffect(() => {
    if (isFinal) return;
    if (!cluesThisTask.length) return;

    const prev = loadRevealed(task);
    const merged = uniqClean([...prev, ...cluesThisTask]);
    saveRevealed(task, merged);
  }, [isFinal, cluesThisTask, task]);

  // Reveal countdown (non-final tasks)
  useEffect(() => {
    if (isFinal) return;
    if (phase !== "reveal") return;

    startRef.current = performance.now();
    setRevealLeftMs(revealMs);

    const tick = () => {
      const now = performance.now();
      const elapsed = now - (startRef.current || now);
      const left = Math.max(0, revealMs - elapsed);
      setRevealLeftMs(left);

      if (left <= 0) {
        setPhase("done");
        return;
      }
      tickRef.current = requestAnimationFrame(tick);
    };

    tickRef.current = requestAnimationFrame(tick);
    return () => {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    };
  }, [phase, isFinal, revealMs]);

  // Reveal "shuffle": re-order the clue cards every SHUFFLE_MS while they're
  // showing, so it's an actual memory challenge (appear → shuffle → appear →
  // shuffle → choose) instead of a static peek. Cards get a flip via shuffleTick.
  useEffect(() => {
    if (isFinal || phase !== "reveal") return;
    if (cluesThisTask.length < 2) return; // nothing to shuffle
    const id = window.setInterval(() => {
      setShuffleTick((t) => {
        const next = t + 1;
        setRevealOrder((order) =>
          seededShuffle(order.length ? order : cluesThisTask.map((_, i) => i), hashStr("mc-shuffle-" + next))
        );
        return next;
      });
    }, SHUFFLE_MS);
    return () => window.clearInterval(id);
  }, [phase, isFinal, cluesThisTask]);

  // Reset the reveal order whenever the clue set changes.
  useEffect(() => {
    setRevealOrder(cluesThisTask.map((_, i) => i));
    setShuffleTick(0);
  }, [cluesThisTask]);

  // Auto-submit non-final reveal tasks shortly after hiding, to keep
  // flow moving.  Bumped from 450ms → 1500ms so the "✅ Cards
  // memorized" confirmation panel (rendered below for phase === 'done')
  // is actually visible before the next task pops up.  Tester:
  // "we didn't do anything afte rthe seconds" — the screen used to
  // go blank for 450ms and then jump straight to the next task.
  useEffect(() => {
    if (isFinal) return;
    if (phase !== "done") return;

    // In practice mode, don't auto-submit at "done" — instead jump
    // straight into a self-contained recall phase using the clues that
    // were just shown. This turns the previously-broken "no clue ever
    // revealed" flow into an actual mini-game.
    if (practiceMode) {
      const t = window.setTimeout(() => {
        setPracticeRecallPhase(true);
      }, 1200);
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(() => {
      if (typeof onSubmit === "function") {
        onSubmit({
          kind: "mystery-clues",
          phase: "reveal",
          revealedThisTask: cluesThisTask,
          revealedTotal: loadRevealed(task),
          ok: true,
        });
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [phase, isFinal, onSubmit, cluesThisTask, task]);

  const gridItems = useMemo(() => {
    const provided = uniqClean(task?.grid || task?.allChoices || task?.choices || []);
    const base = provided.length ? provided : DEFAULT_GRID;

    // Ensure revealed items are always present in the grid.
    const mustInclude = uniqClean(treatAsFinal ? revealedAll : []);
    const distractors = base.filter((b) => !mustInclude.includes(b));

    // Keep the revealed clues, then cap to 24 for layout sanity.
    const capped = uniqClean([...mustInclude, ...distractors]).slice(0, 24);

    // Shuffle positions so the revealed clues aren't always the first cells
    // (tester: the answers were "too easy, obviously"). Seeded by task so the
    // layout stays stable across re-renders within the same task.
    const seed = hashStr(storageKey(task)) ^ 0x9e3779b9;
    return seededShuffle(capped, seed);
  }, [task, revealedAll, treatAsFinal]);

  function togglePick(v) {
    if (submitted) return;
    setSelected((prev) => {
      const set = new Set(prev);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      return Array.from(set);
    });
  }

  function submitFinal() {
    if (submitted) return;
    setSubmitted(true);

    const revealed = loadRevealed(task);
    const correct = arraysEqualAsSets(selected, revealed);

    const payload = {
      kind: "mystery-clues",
      phase: "recall",
      correct,
      bonusPoints: correct ? bonusPoints : 0,
      selected: uniqClean(selected),
      revealed: uniqClean(revealed),
    };

    setResult({ correct, selected: payload.selected, revealed: payload.revealed });

    if (typeof onSubmit === "function") onSubmit(payload);
  }

  // Clean, consistent full-bleed presentation similar to other premium tasks
  const bg = "linear-gradient(135deg, rgba(15,23,42,1), rgba(67,56,202,1))";

  return (
    <div
      style={{
        minHeight: "72vh",
        borderRadius: 18,
        padding: 22,
        color: "#fff",
        background: bg,
        boxShadow: "0 30px 80px rgba(2,6,23,0.25)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 38, fontWeight: 1000, letterSpacing: 0.2 }}>Mystery Clues</div>
          <div style={{ marginTop: 6, opacity: 0.95, fontSize: 16, lineHeight: 1.35, maxWidth: 720 }}>
            {!isFinal ? (
              <>Memorize these cards — they'll disappear soon.</>
            ) : (
              <>Final challenge: select <b>exactly</b> the cards you saw earlier — no extras.</>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!isFinal && (
            <Pill>
              <span style={{ opacity: 0.9 }}>Hiding in</span>
              <span style={{ fontSize: 18 }}>{Math.ceil(revealLeftMs / 1000)}s</span>
            </Pill>
          )}
          {isFinal && (
            <Pill>
              <span style={{ opacity: 0.9 }}>Bonus</span>
              <span style={{ fontSize: 18 }}>+{bonusPoints}</span>
            </Pill>
          )}
        </div>
      </div>

      {/* REVEAL PHASE (non-final) */}
      {!isFinal && phase === "reveal" && (
        <div style={{ marginTop: 26 }}>
          <style>{`
            @keyframes mcFlip {
              0%   { transform: rotateY(0deg) scale(1); }
              45%  { transform: rotateY(90deg) scale(1.06); }
              55%  { transform: rotateY(90deg) scale(1.06); }
              100% { transform: rotateY(0deg) scale(1); }
            }
          `}</style>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
            {(revealOrder.length ? revealOrder : cluesThisTask.map((_, i) => i)).map((origIdx) => {
              const c = cluesThisTask[origIdx];
              if (c == null) return null;
              return (
                <div
                  key={`${origIdx}-${shuffleTick}`}
                  style={{ animation: "mcFlip 420ms ease", transformStyle: "preserve-3d" }}
                >
                  <Card value={c} big />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 18, opacity: 0.9 }}>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (1 - revealLeftMs / revealMs) * 100)}%`,
                  background: "linear-gradient(90deg, rgba(56,189,248,1), rgba(34,197,94,1))",
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* DONE PHASE (non-final) — countdown reached zero.  Show a
          short confirmation so the screen isn't blank between
          "Hiding in 0s" and the next task.  Auto-submits ~1.5s later
          (see effect above). In practice mode this panel still
          appears for the brief transition into the recall phase. */}
      {!isFinal && phase === "done" && !practiceRecallPhase && (
        <div
          style={{
            marginTop: 26,
            padding: "18px 20px",
            borderRadius: 14,
            background: "rgba(34,197,94,0.18)",
            border: "1px solid rgba(34,197,94,0.4)",
            textAlign: "center",
            maxWidth: 480,
            marginInline: "auto",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 6 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#dcfce7" }}>
            Cards hidden — keep them in mind!
          </div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            You'll need them later. Moving on…
          </div>
        </div>
      )}

      {/* "noop" should only ever fire on a final card with no clues to
          recall; non-final cards now always fall back to DEFAULT_GRID
          so this branch shouldn't render in practice.  Keep the
          friendly continue button as a last-resort safety. */}
      {!isFinal && phase === "noop" && (
        <div style={{ marginTop: 26, opacity: 0.95, maxWidth: 720 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Nothing to memorise on this card.</div>
          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.85 }}>
            Tap continue to move on.
          </div>
          <button
            onClick={() => onSubmit?.({ kind: "mystery-clues", phase: "noop", ok: true })}
            disabled={disabled}
            style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              fontWeight: 900,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Continue
          </button>
        </div>
      )}

      {/* FINAL RECALL (including practice-mode self-recall) */}
      {treatAsFinal && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ opacity: 0.9 }}>
              Revealed clues: <b>{revealedAll.length}</b>
            </div>
            <div style={{ opacity: 0.9 }}>
              Selected: <b>{uniqClean(selected).length}</b>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
              gap: 14,
              alignItems: "stretch",
            }}
          >
            {gridItems.map((v) => {
              const picked = selected.includes(v);
              const correct = result?.correct;
              const wasRevealed = (result?.revealed || revealedAll).includes(v);

              // after submission: show feedback
              let border = "1px solid rgba(255,255,255,0.22)";
              let bgCell = "rgba(255,255,255,0.10)";
              if (submitted) {
                if (wasRevealed && selected.includes(v)) {
                  bgCell = "rgba(34,197,94,0.28)";
                  border = "1px solid rgba(34,197,94,0.65)";
                } else if (!wasRevealed && selected.includes(v)) {
                  bgCell = "rgba(239,68,68,0.22)";
                  border = "1px solid rgba(239,68,68,0.55)";
                } else if (wasRevealed && !selected.includes(v)) {
                  bgCell = "rgba(250,204,21,0.14)";
                  border = "1px solid rgba(250,204,21,0.45)";
                }
              } else if (picked) {
                bgCell = "rgba(255,255,255,0.18)";
                border = "1px solid rgba(255,255,255,0.38)";
              }

              return (
                <button
                  key={v}
                  onClick={() => togglePick(v)}
                  disabled={disabled || submitted}
                  style={{
                    width: "100%",
                    minHeight: 92,
                    borderRadius: 18,
                    border,
                    background: bgCell,
                    boxShadow: picked ? "0 18px 40px rgba(0,0,0,0.18)" : "0 12px 26px rgba(0,0,0,0.12)",
                    cursor: disabled || submitted ? "not-allowed" : "pointer",
                    color: "#fff",
                    fontSize: 40,
                    fontWeight: 1000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    userSelect: "none",
                  }}
                  aria-pressed={picked}
                >
                  {v}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={submitFinal}
              disabled={disabled || submitted}
              style={{
                padding: "14px 18px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.14)",
                color: "#fff",
                fontWeight: 1000,
                cursor: disabled || submitted ? "not-allowed" : "pointer",
              }}
            >
              Submit
            </button>

            {submitted && result && (
              <div style={{ fontWeight: 1000, fontSize: 18 }}>
                {result.correct ? (
                  <span>✅ Correct! Bonus +{bonusPoints}</span>
                ) : (
                  <span>❌ Not quite — no bonus this time.</span>
                )}
              </div>
            )}

            {/* Helper reset for testing */}
            <button
              onClick={() => {
                try {
                  sessionStorage.removeItem(storageKey(task));
                } catch (_) {}
                setSelected([]);
                setSubmitted(false);
                setResult(null);
              }}
              disabled={disabled}
              style={{
                marginLeft: "auto",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(0,0,0,0.16)",
                color: "rgba(255,255,255,0.90)",
                fontWeight: 900,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              title="Clears stored clues for this set (testing)"
            >
              Reset stored clues
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
