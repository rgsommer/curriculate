// student-app/src/components/tasks/types/FlashcardsTask.jsx
import React, { useMemo, useState } from "react";
import BuzzButton from "../../ui/BuzzButton";

/**
 * Flashcards (standard, low-stress review)
 * - Shows a deck of cards (question/answer)
 * - Click / tap the card to flip
 * - Intended classroom flow: students shout answers; teacher can optionally advance
 *
 * Expected task shapes (any of these are accepted):
 *  - task.cards: [{ question, answer }]
 *  - task.items/questions: [{ question, answer }] OR [{ q, a }]
 *  - task.config.cards: same as above
 */
export default function FlashcardsTask({ task, onSubmit, disabled, memberNames }) {
  const cards = useMemo(() => {
    const t = task || {};
    const cfg = t?.config && typeof t.config === "object" ? t.config : {};

    const raw =
      (Array.isArray(cfg.cards) && cfg.cards) ||
      (Array.isArray(t.cards) && t.cards) ||
      (Array.isArray(t.items) && t.items) ||
      (Array.isArray(t.questions) && t.questions) ||
      [];

    const clean = raw
      .map((c, i) => ({
        id: c?.id || `card-${i}`,
        question: String(c?.question ?? c?.q ?? c?.front ?? c?.term ?? "").trim(),
        answer: String(c?.answer ?? c?.a ?? c?.back ?? c?.definition ?? "").trim(),
      }))
      .filter((c) => c.question && c.answer);

    return clean.slice(0, Math.max(1, Math.min(20, Number(cfg.maxCards) || clean.length || 12)));
  }, [task]);

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [buzzedBy, setBuzzedBy] = useState(null); // player index or null
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState(() => ({})); // { [playerName]: { right, wrong } }

  // Player names: prefer config.playerNames, then memberNames from TaskRunner, else Player 1..4.
  const playerNames = useMemo(() => {
    const t = task || {};
    const cfg = t?.config && typeof t.config === "object" ? t.config : {};
    const fromCfg = Array.isArray(cfg.playerNames) ? cfg.playerNames : [];
    const fromMembers = Array.isArray(memberNames) ? memberNames : [];

    const base = (fromCfg.length ? fromCfg : fromMembers).map((n) => String(n ?? "").trim()).filter(Boolean);
    const count = Math.max(2, Math.min(8, Number(cfg.playerCount) || base.length || 4));
    const out = [];
    for (let i = 0; i < count; i++) out.push(base[i] || `Player ${i + 1}`);
    return out;
  }, [task, memberNames]);
  // NOTE: Prior versions of this task defined an alternate "playerNames" block and a separate
  // "revealLocked" state. Those are intentionally kept here as a comment so we don't lose history.
  // (Do not re-enable these duplicates; they would shadow the live variables above.)
  /*
  const [buzzedBy, setBuzzedBy] = useState(null); // player index
  const [revealLocked, setRevealLocked] = useState(false);
  const [scores, setScores] = useState(() => ({}));

  const playerNames = useMemo(() => {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const raw =
      (Array.isArray(cfg.playerNames) && cfg.playerNames) ||
      (Array.isArray(task?.playerNames) && task.playerNames) ||
      (Array.isArray(memberNames) && memberNames) ||
      [];
    const count = Math.max(2, Math.min(8, Number(cfg.playerCount) || raw.length || 4));
    const names = [];
    for (let i = 0; i < count; i++) {
      const n = String(raw[i] || "").trim();
      names.push(n || `Player ${i + 1}`);
    }
    return names;
  }, [task, memberNames]);
  */

  const current = cards[idx] || null;
  const total = cards.length || 0;

  const canPrev = idx > 0;
  const canNext = idx < total - 1;

  const finish = () => {
    try {
      onSubmit?.({
        answer: {
          mode: "flashcards",
          viewed: total,
          scores,
        },
        completed: true,
      });
    } catch {
      // ignore
    }
  };

  const resetForNext = (nextIdx) => {
    setIdx(nextIdx);
    setFlipped(false);
    setBuzzedBy(null);
    setRevealed(false);
    // setRevealLocked(false); // (kept as comment; revealLocked no longer used)
  };

  const bumpScore = (playerName, field) => {
    setScores((prev) => {
      const p = prev && typeof prev === "object" ? prev : {};
      const cur = p[playerName] || { right: 0, wrong: 0 };
      const next = { ...cur, [field]: (cur[field] || 0) + 1 };
      return { ...p, [playerName]: next };
    });
  };

  const handleBuzz = (playerIdx) => {
    if (disabled) return;
    if (revealed) return;
    setBuzzedBy(playerIdx);
    setRevealed(true);
    setFlipped(true);
  };

  const markBuzzResult = (wasRight) => {
    if (!revealed) return;
    const name = playerNames[buzzedBy] || "";
    if (name) bumpScore(name, wasRight ? "right" : "wrong");

    const nextIdx = idx + 1;
    if (nextIdx >= total) {
      finish();
      return;
    }
    resetForNext(nextIdx);
  };

  // NOTE: Older buzzer handlers are kept here as a comment (history), but the live
  // version is handleBuzz(...) + markBuzzResult(...) above.
  /*
  const handleBuzz = (playerIdx) => {
    if (disabled) return;
    if (revealLocked) return;
    setBuzzedBy(playerIdx);
    setRevealLocked(true);
    setFlipped(true); // reveal answer by flipping
  };

  const markResult = (isCorrect) => {
    if (disabled) return;
    if (buzzedBy === null || buzzedBy === undefined) return;
    setScores((prev) => {
      const next = { ...(prev || {}) };
      const key = String(buzzedBy);
      const existing = next[key] || { right: 0, wrong: 0 };
      next[key] = {
        right: existing.right + (isCorrect ? 1 : 0),
        wrong: existing.wrong + (isCorrect ? 0 : 1),
      };
      return next;
    });

    const next = Math.min(total - 1, idx + 1);
    if (next === idx && idx >= total - 1) {
      // last card -> finish
      finish();
      return;
    }
    resetForNext(next);
  };
  */

  if (!current) {
    return (
      <div style={{ padding: 20 }}>
        <h2 style={{ margin: 0 }}>Flashcards</h2>
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "#fee2e2" }}>
          <div style={{ fontWeight: 900 }}>Flashcards error:</div>
          <div>No cards were provided for this task.</div>
        </div>
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(task, null, 2)}</pre>
      </div>
    );
  }

  const shell = {
    position: "relative",
    width: "100%",
    minHeight: 520,
    padding: 16,
    borderRadius: 18,
    background:
      "radial-gradient(1200px 520px at 30% 0%, rgba(255,255,255,0.70), rgba(219,234,254,0.92) 45%, rgba(224,231,255,0.95))",
    overflow: "hidden",
  };

  const cardWrap = {
    perspective: 1200,
    width: "min(50vw, 560px)",
    maxWidth: "92vw",
    // 50% width card with 1.4x height (aspect ratio 5/7)
    aspectRatio: "5 / 7",
    height: "auto",
    maxHeight: "72vh",
    minHeight: 320,
    margin: "0 auto",
  };

  const card3d = {
    width: "100%",
    height: "100%",
    position: "relative",
    transformStyle: "preserve-3d",
    transition: "transform 520ms cubic-bezier(.2,.9,.2,1)",
    transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
    cursor: disabled ? "not-allowed" : "pointer",
  };

  const face = {
    position: "absolute",
    inset: 0,
    borderRadius: 22,
    background: "#ffffff",
    border: "1px solid rgba(15,23,42,0.15)",
    boxShadow: "0 18px 40px rgba(2,6,23,0.12)",
    padding: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    backfaceVisibility: "hidden",
  };

  const front = {
    ...face,
  };

  const back = {
    ...face,
    transform: "rotateY(180deg)",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.10)",
    fontWeight: 900,
    color: "#0f172a",
    fontSize: 12,
  };

  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 1000, fontSize: "1.3rem", color: "#0f172a" }}>Flashcards</div>
        <div style={pill}>
          Card <span style={{ fontWeight: 1000 }}>{idx + 1}</span> / {total} • Tap to flip
        </div>
      </div>

      <div style={{ marginTop: 10, color: "#334155", fontWeight: 800 }}>
        <div style={{ fontSize: 14 }}>
          **How to play:** Students shout the answer. The first student to hit their **BUZZ** button gets to answer.
          Then the team marks **Right** or **Wrong**.
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={cardWrap}>
          <div
            style={card3d}
            onClick={() => {
              if (disabled) return;
              setFlipped((v) => !v);
            }}
            role="button"
            aria-label="Flip flashcard"
            tabIndex={0}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") setFlipped((v) => !v);
            }}
          >
            <div style={front}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 1000, letterSpacing: 0.5, textTransform: "uppercase", color: "#2563eb" }}>
                  Question
                </div>
                <div style={{ marginTop: 14, fontSize: "2.1rem", fontWeight: 1000, lineHeight: 1.15, color: "#0f172a" }}>
                  {current.question}
                </div>
                <div style={{ marginTop: 16, fontSize: 14, color: "#475569" }}>
                  (Tap the card to flip)
                </div>
              </div>
            </div>

            <div style={back}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 1000, letterSpacing: 0.5, textTransform: "uppercase", color: "#16a34a" }}>
                  Answer
                </div>
                <div style={{ marginTop: 14, fontSize: "2.0rem", fontWeight: 1000, lineHeight: 1.15, color: "#0f172a" }}>
                  {current.answer}
                </div>
                <div style={{ marginTop: 16, fontSize: 14, color: "#475569" }}>
                  (Tap to flip back)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Buzz controls */}
        <div style={{ marginTop: 18 }}>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            {!revealed ? (
              <div style={{ fontWeight: 1000, color: "#0f172a" }}>
                Say the answer out loud. First person to hit <span style={{ fontWeight: 1100 }}>BUZZ</span> gets checked.
              </div>
            ) : (
              <div style={{ fontWeight: 1000, color: "#0f172a" }}>
                Buzzed: <span style={{ color: "#2563eb" }}>{playerNames[buzzedBy] || ""}</span> • Now mark Right or Wrong.
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 14,
              marginBottom: 12,
            }}
          >
            {playerNames.map((name, pIdx) => {
              const isActive = buzzedBy === pIdx;
              return (
                <div key={pIdx} style={{ width: "min(30vw, 220px)", minWidth: 150 }}>
                  <BuzzButton
                    label={name}
                    active={isActive}
                    disabled={disabled || revealed}
                    onClick={() => handleBuzz(pIdx)}
                  />
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              disabled={disabled || !revealed}
              onClick={() => markBuzzResult(true)}
              style={{
                padding: "14px 18px",
                borderRadius: 16,
                fontWeight: 1000,
                border: "1px solid rgba(22,163,74,0.25)",
                background: !revealed ? "rgba(22,163,74,0.10)" : "rgba(22,163,74,0.18)",
                cursor: disabled || !revealed ? "not-allowed" : "pointer",
                color: "#14532d",
                minWidth: 200,
                fontSize: 18,
              }}
            >
              ✅ Got it Right
            </button>

            <button
              disabled={disabled || !revealed}
              onClick={() => markBuzzResult(false)}
              style={{
                padding: "14px 18px",
                borderRadius: 16,
                fontWeight: 1000,
                border: "1px solid rgba(220,38,38,0.25)",
                background: !revealed ? "rgba(220,38,38,0.10)" : "rgba(220,38,38,0.16)",
                cursor: disabled || !revealed ? "not-allowed" : "pointer",
                color: "#7f1d1d",
                minWidth: 200,
                fontSize: 18,
              }}
            >
              ❌ Got it Wrong
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={disabled || !canPrev}
            onClick={() => {
              if (disabled || !canPrev) return;
              resetForNext(Math.max(0, idx - 1));
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              fontWeight: 1000,
              border: "1px solid rgba(15,23,42,0.15)",
              background: canPrev ? "#ffffff" : "rgba(255,255,255,0.6)",
              cursor: disabled || !canPrev ? "not-allowed" : "pointer",
              color: "#0f172a",
            }}
          >
            ← Prev
          </button>

          <button
            disabled={disabled || !canNext}
            onClick={() => {
              if (disabled || !canNext) return;
              resetForNext(Math.min(total - 1, idx + 1));
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              fontWeight: 1000,
              border: "1px solid rgba(15,23,42,0.15)",
              background: canNext ? "#ffffff" : "rgba(255,255,255,0.6)",
              cursor: disabled || !canNext ? "not-allowed" : "pointer",
              color: "#0f172a",
            }}
          >
            Next →
          </button>

          <button
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              finish();
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 14,
              fontWeight: 1000,
              border: "1px solid rgba(22,163,74,0.25)",
              background: "rgba(22,163,74,0.10)",
              cursor: disabled ? "not-allowed" : "pointer",
              color: "#14532d",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
