// student-app/src/components/tasks/types/ClozeTask.jsx
//
// Cloze (fill-in-the-blank) task. Passage has ___ blanks, word bank below.
// Students drag (or tap) words into the correct blanks. Instant feedback on
// each drop. Bonus points for first-attempt correct. Distractors for 7+.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";
import { useThemeMode } from "../../../utils/ThemeModeContext";

/* ------------------------------------------------------------------ */
/*  CSS animations                                                     */
/* ------------------------------------------------------------------ */
const STYLE_ID = "cloze-anims";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes cloze-popIn {
      0%   { transform: scale(0.85); opacity: 0; }
      60%  { transform: scale(1.05); opacity: 1; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes cloze-shake {
      0%, 100% { transform: translateX(0); }
      15%  { transform: translateX(-6px); }
      30%  { transform: translateX(6px); }
      45%  { transform: translateX(-4px); }
      60%  { transform: translateX(4px); }
      75%  { transform: translateX(-2px); }
      90%  { transform: translateX(2px); }
    }
    @keyframes cloze-glow {
      0%   { box-shadow: 0 0 0 3px rgba(34,197,94,0.5); }
      100% { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
    }
    @keyframes cloze-fadeIn {
      0%   { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes cloze-bounce {
      0%   { transform: scale(1); }
      50%  { transform: scale(1.08); }
      100% { transform: scale(1); }
    }
    @keyframes cloze-slideUp {
      0%   { opacity: 0; transform: translateY(12px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .cloze-blank-drop-target {
      transition: all 0.15s ease;
    }
    .cloze-blank-drop-target.drag-over {
      background: rgba(99,102,241,0.2) !important;
      border-color: rgba(99,102,241,0.6) !important;
      transform: scale(1.04);
    }
  `;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/*  Theme-adaptive colors                                              */
/* ------------------------------------------------------------------ */
function themeColors(theme) {
  const dark = theme === "dark";
  return {
    // Word chip (unused)
    chipText:      dark ? "rgba(255,255,255,0.88)" : "#1e293b",
    chipBg:        dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
    chipBorder:    dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)",
    // Word chip (selected)
    chipSelText:   dark ? "#a5b4fc" : "#4338ca",
    chipSelBg:     dark ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.12)",
    chipSelBorder: dark ? "rgba(99,102,241,0.7)"  : "rgba(99,102,241,0.5)",
    // Word chip (used)
    chipUsedText:   dark ? "rgba(255,255,255,0.2)" : "rgba(15,23,42,0.25)",
    chipUsedBg:     dark ? "rgba(255,255,255,0.02)" : "rgba(15,23,42,0.03)",
    chipUsedBorder: dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.06)",
    // Blank slot
    blankBg:        dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)",
    blankBorder:    dark ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.15)",
    blankText:      dark ? "rgba(255,255,255,0.4)"  : "rgba(15,23,42,0.4)",
    blankFilledText: dark ? "#a5b4fc" : "#4338ca",
    blankFilledBg:   dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)",
    blankFilledBorder: dark ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.35)",
    blankDragBg:    dark ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.12)",
    blankDragBorder: dark ? "rgba(99,102,241,0.6)" : "rgba(99,102,241,0.4)",
    // Passage
    passageText:   dark ? "rgba(255,255,255,0.88)" : "#1e293b",
    passageBg:     dark ? "rgba(0,0,0,0.18)" : "rgba(15,23,42,0.04)",
    passageBorder: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.1)",
    // Word bank container
    bankBg:        dark ? "rgba(255,255,255,0.02)" : "rgba(15,23,42,0.02)",
    bankBorder:    dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)",
    bankLabel:     dark ? "rgba(148,163,184,0.5)" : "rgba(100,116,139,0.6)",
    // Misc
    promptText:    dark ? "rgba(226,232,240,0.85)" : "rgba(30,41,59,0.85)",
    hintText:      dark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.55)",
    resultSubtext: dark ? "rgba(226,232,240,0.6)" : "rgba(30,41,59,0.6)",
    scoreBg:       dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
  };
}

/* ------------------------------------------------------------------ */
/*  Scoring constants                                                  */
/* ------------------------------------------------------------------ */
const PTS_FIRST = 10;   // correct on first attempt
const PTS_SECOND = 5;   // correct on second attempt
const PTS_THIRD = 2;    // correct on 3+ attempts

function pointsForAttempt(n) {
  if (n <= 1) return PTS_FIRST;
  if (n === 2) return PTS_SECOND;
  return PTS_THIRD;
}

/* ------------------------------------------------------------------ */
/*  Fisher-Yates shuffle                                               */
/* ------------------------------------------------------------------ */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/*  Parse passage into segments                                        */
/* ------------------------------------------------------------------ */
function parsePassage(passage) {
  // Split on ___ markers. Returns alternating text and blank indicators.
  const parts = passage.split(/___/);
  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) segments.push({ type: "text", text: parts[i] });
    if (i < parts.length - 1) segments.push({ type: "blank", blankIndex: i });
  }
  return segments;
}

/* ================================================================== */
/*  Blank slot component                                               */
/* ================================================================== */
function BlankSlot({ index, filledWord, status, attempts, onDrop, onTap, onRemove, disabled, tc }) {
  const ref = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const word = e.dataTransfer.getData("text/plain");
    const srcIdx = e.dataTransfer.getData("application/x-cloze-bank-idx");
    if (word) onDrop(index, word, srcIdx ? parseInt(srcIdx, 10) : null);
  }, [index, onDrop]);

  const isCorrect = status === "correct";
  const isWrong = status === "wrong";
  const isEmpty = !filledWord;

  let bgColor = tc.blankBg;
  let borderColor = tc.blankBorder;
  let textColor = tc.blankText;
  let anim = undefined;

  if (isCorrect) {
    bgColor = "rgba(34,197,94,0.15)";
    borderColor = "#22c55e";
    textColor = "#22c55e";
    anim = "cloze-glow 0.5s ease";
  } else if (isWrong) {
    bgColor = "rgba(239,68,68,0.12)";
    borderColor = "#ef4444";
    textColor = "#ef4444";
    anim = "cloze-shake 0.4s ease";
  } else if (filledWord) {
    bgColor = tc.blankFilledBg;
    borderColor = tc.blankFilledBorder;
    textColor = tc.blankFilledText;
  } else if (dragOver) {
    bgColor = tc.blankDragBg;
    borderColor = tc.blankDragBorder;
  }

  return (
    <span
      ref={ref}
      className="cloze-blank-drop-target"
      onDragOver={!disabled && !isCorrect ? handleDragOver : undefined}
      onDragLeave={handleDragLeave}
      onDrop={!disabled && !isCorrect ? handleDrop : undefined}
      onClick={() => {
        if (isEmpty && !disabled) onTap(index);
        else if (filledWord && !isCorrect && !disabled) onRemove(index);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: filledWord ? undefined : 80,
        padding: "4px 12px",
        margin: "2px 4px",
        borderRadius: 12,
        border: `2px dashed ${borderColor}`,
        background: bgColor,
        cursor: disabled || isCorrect ? "default" : "pointer",
        animation: anim,
        transition: "all 0.15s ease",
        verticalAlign: "middle",
        position: "relative",
      }}
    >
      {filledWord ? (
        <span style={{
          fontSize: 15, fontWeight: 800, color: textColor,
          textDecoration: isWrong ? "line-through" : "none",
        }}>
          {filledWord}
        </span>
      ) : (
        <span style={{
          fontSize: 13, fontWeight: 700, color: "rgba(148,163,184,0.5)",
          fontStyle: "italic",
        }}>
          {index + 1}
        </span>
      )}

      {/* Points badge for correct */}
      {isCorrect && attempts > 0 && (
        <span style={{
          position: "absolute", top: -10, right: -6,
          fontSize: 10, fontWeight: 900, color: "#fff",
          background: "#22c55e", borderRadius: 8, padding: "1px 5px",
          animation: "cloze-popIn 0.3s ease",
        }}>
          +{pointsForAttempt(attempts)}
        </span>
      )}
    </span>
  );
}

/* ================================================================== */
/*  Word bank chip                                                     */
/* ================================================================== */
function WordChip({ word, bankIdx, used, isDistractor, onDragStart, onTapSelect, selected, disabled, tc }) {
  const handleDragStart = useCallback((e) => {
    e.dataTransfer.setData("text/plain", word);
    e.dataTransfer.setData("application/x-cloze-bank-idx", String(bankIdx));
    e.dataTransfer.effectAllowed = "move";
  }, [word, bankIdx]);

  return (
    <span
      draggable={!used && !disabled}
      onDragStart={!used && !disabled ? handleDragStart : undefined}
      onClick={() => !used && !disabled && onTapSelect(bankIdx)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "8px 16px",
        borderRadius: 14,
        fontSize: 15,
        fontWeight: 800,
        cursor: used || disabled ? "default" : "grab",
        userSelect: "none",
        transition: "all 0.15s ease",
        border: selected
          ? `2px solid ${tc.chipSelBorder}`
          : used
            ? `2px solid ${tc.chipUsedBorder}`
            : `2px solid ${tc.chipBorder}`,
        background: selected
          ? tc.chipSelBg
          : used
            ? tc.chipUsedBg
            : tc.chipBg,
        color: used
          ? tc.chipUsedText
          : selected
            ? tc.chipSelText
            : tc.chipText,
        textDecoration: used ? "line-through" : "none",
        opacity: used ? 0.4 : 1,
        animation: used ? undefined : "cloze-fadeIn 0.2s ease",
      }}
    >
      {word}
      {isDistractor && used && (
        <span style={{ marginLeft: 4, fontSize: 11, color: "#ef4444" }}>✗</span>
      )}
    </span>
  );
}

/* ================================================================== */
/*  ClozeTask (main component)                                        */
/* ================================================================== */
export default function ClozeTask({ task, onSubmit, disabled }) {
  injectStyles();
  const theme = useThemeMode() || "light";
  const tc = useMemo(() => themeColors(theme), [theme]);

  const passage = task?.passage || "";
  const blanks = useMemo(() => Array.isArray(task?.blanks) ? task.blanks : [], [task?.blanks]);
  const distractors = useMemo(() => Array.isArray(task?.distractors) ? task.distractors : [], [task?.distractors]);

  // Parse passage into text/blank segments
  const segments = useMemo(() => parsePassage(passage), [passage]);

  // Build shuffled word bank: answers + distractors
  const wordBank = useMemo(() => {
    const words = blanks.map((b, i) => ({
      word: b.answer,
      bankIdx: i,
      isDistractor: false,
    }));
    distractors.forEach((d, i) => {
      words.push({ word: d, bankIdx: blanks.length + i, isDistractor: true });
    });
    return shuffle(words);
  }, [blanks, distractors]);

  // State
  const [fills, setFills] = useState(() => new Array(blanks.length).fill(null));
  const [statuses, setStatuses] = useState(() => new Array(blanks.length).fill(null)); // null | "correct" | "wrong"
  const [attempts, setAttempts] = useState(() => new Array(blanks.length).fill(0));
  const [usedBankIdxs, setUsedBankIdxs] = useState(new Set());
  const [selectedBankIdx, setSelectedBankIdx] = useState(null); // for tap-to-place flow
  const [submitted, setSubmitted] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(null); // blankIndex that just got wrong

  // Clear wrong flash after animation
  useEffect(() => {
    if (wrongFlash !== null) {
      const t = setTimeout(() => {
        setWrongFlash(null);
        // Remove the wrong word from the blank after shake
        setFills((prev) => {
          const next = [...prev];
          if (statuses[wrongFlash] === "wrong") next[wrongFlash] = null;
          return next;
        });
        setStatuses((prev) => {
          const next = [...prev];
          if (next[wrongFlash] === "wrong") next[wrongFlash] = null;
          return next;
        });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [wrongFlash, statuses]);

  // Check if all blanks are correctly filled
  const allCorrect = statuses.every((s) => s === "correct");
  const correctCount = statuses.filter((s) => s === "correct").length;
  const totalScore = useMemo(() => {
    let score = 0;
    for (let i = 0; i < blanks.length; i++) {
      if (statuses[i] === "correct") score += pointsForAttempt(attempts[i]);
    }
    return score;
  }, [blanks.length, statuses, attempts]);
  const maxPossible = blanks.length * PTS_FIRST;

  /* ---------- drop / place handler ---------- */
  const placeWord = useCallback((blankIdx, word, bankIdx) => {
    if (statuses[blankIdx] === "correct" || submitted) return;

    const correct = blanks[blankIdx]?.answer?.toLowerCase().trim();
    const guess = word.toLowerCase().trim();
    const isCorrect = guess === correct;

    // Update fills
    setFills((prev) => {
      const next = [...prev];
      next[blankIdx] = word;
      return next;
    });

    // Update attempts
    setAttempts((prev) => {
      const next = [...prev];
      next[blankIdx] = (next[blankIdx] || 0) + 1;
      return next;
    });

    // Update status
    setStatuses((prev) => {
      const next = [...prev];
      next[blankIdx] = isCorrect ? "correct" : "wrong";
      return next;
    });

    // Track bank usage
    if (bankIdx !== null) {
      if (isCorrect) {
        setUsedBankIdxs((prev) => new Set([...prev, bankIdx]));
      }
    } else {
      // Find bank idx by word match
      const match = wordBank.find((w) => w.word.toLowerCase().trim() === guess && !usedBankIdxs.has(w.bankIdx));
      if (match && isCorrect) {
        setUsedBankIdxs((prev) => new Set([...prev, match.bankIdx]));
      }
    }

    if (!isCorrect) {
      setWrongFlash(blankIdx);
    }

    setSelectedBankIdx(null);
  }, [blanks, statuses, submitted, wordBank, usedBankIdxs]);

  /* ---------- tap-to-place flow ---------- */
  const handleBankTap = useCallback((bankIdx) => {
    if (selectedBankIdx === bankIdx) {
      setSelectedBankIdx(null);
    } else {
      setSelectedBankIdx(bankIdx);
    }
  }, [selectedBankIdx]);

  const handleBlankTap = useCallback((blankIdx) => {
    if (selectedBankIdx !== null) {
      const bankEntry = wordBank.find((w) => w.bankIdx === selectedBankIdx);
      if (bankEntry && !usedBankIdxs.has(bankEntry.bankIdx)) {
        placeWord(blankIdx, bankEntry.word, bankEntry.bankIdx);
      }
    }
  }, [selectedBankIdx, wordBank, usedBankIdxs, placeWord]);

  const handleRemoveFromBlank = useCallback((blankIdx) => {
    if (statuses[blankIdx] === "correct" || submitted) return;
    setFills((prev) => { const n = [...prev]; n[blankIdx] = null; return n; });
    setStatuses((prev) => { const n = [...prev]; n[blankIdx] = null; return n; });
  }, [statuses, submitted]);

  /* ---------- submit ---------- */
  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit({
      fills: fills.map((f, i) => ({
        blankIndex: i,
        answer: blanks[i]?.answer,
        studentAnswer: f,
        correct: statuses[i] === "correct",
        attempts: attempts[i],
        points: statuses[i] === "correct" ? pointsForAttempt(attempts[i]) : 0,
      })),
      totalScore,
      maxPossible,
      correctCount,
      totalBlanks: blanks.length,
      perfectFirst: attempts.every((a, i) => statuses[i] === "correct" && a === 1),
    });
  }, [submitted, fills, blanks, statuses, attempts, totalScore, maxPossible, correctCount, onSubmit]);

  // Auto-submit when all correct
  useEffect(() => {
    if (allCorrect && blanks.length > 0 && !submitted) {
      const t = setTimeout(handleSubmit, 800);
      return () => clearTimeout(t);
    }
  }, [allCorrect, blanks.length, submitted, handleSubmit]);

  return (
    <TaskCardFrame
      title={task?.title || "Fill in the Blanks"}
      badge="CLOZE"
      right={
        <Pill style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 900 }}>
          {correctCount}/{blanks.length}
        </Pill>
      }
    >
      {/* Prompt */}
      {task?.prompt && (
        <div style={{
          fontSize: 14, fontWeight: 700, lineHeight: 1.55,
          color: tc.promptText, marginBottom: 12,
        }}>
          {task.prompt}
        </div>
      )}

      {/* Instructions hint */}
      {!submitted && (
        <div style={{
          fontSize: 12, fontWeight: 700, color: tc.hintText,
          marginBottom: 12, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 15 }}>💡</span>
          Drag words from the bank into the blanks, or tap a word then tap a blank
        </div>
      )}

      {/* Passage with blank slots */}
      <div style={{
        padding: "16px 14px",
        borderRadius: 18,
        border: `1px solid ${tc.passageBorder}`,
        background: tc.passageBg,
        marginBottom: 16,
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 2,
        color: tc.passageText,
      }}>
        {segments.map((seg, i) => {
          if (seg.type === "text") {
            return <span key={`t${i}`}>{seg.text}</span>;
          }
          const bi = seg.blankIndex;
          return (
            <BlankSlot
              key={`b${bi}`}
              index={bi}
              filledWord={fills[bi]}
              status={wrongFlash === bi ? "wrong" : statuses[bi]}
              attempts={attempts[bi]}
              onDrop={placeWord}
              onTap={handleBlankTap}
              onRemove={handleRemoveFromBlank}
              disabled={disabled || submitted}
              tc={tc}
            />
          );
        })}
      </div>

      {/* Score bar */}
      {correctCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginBottom: 14,
        }}>
          <div style={{
            flex: 1, height: 8, borderRadius: 4,
            background: tc.scoreBg,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${(correctCount / blanks.length) * 100}%`,
              background: allCorrect
                ? "linear-gradient(90deg, #22c55e, #16a34a)"
                : "linear-gradient(90deg, #6366f1, #8b5cf6)",
              borderRadius: 4,
              transition: "width 0.4s ease",
            }} />
          </div>
          <span style={{
            fontSize: 13, fontWeight: 900,
            color: allCorrect ? "#22c55e" : "#a5b4fc",
          }}>
            {totalScore}/{maxPossible} pts
          </span>
        </div>
      )}

      {/* Word bank */}
      {!submitted && (
        <div style={{
          padding: "14px",
          borderRadius: 16,
          border: `1px solid ${tc.bankBorder}`,
          background: tc.bankBg,
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: tc.bankLabel,
            marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.2,
          }}>
            Word Bank
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {wordBank.map((entry) => (
              <WordChip
                key={entry.bankIdx}
                word={entry.word}
                bankIdx={entry.bankIdx}
                used={usedBankIdxs.has(entry.bankIdx)}
                isDistractor={entry.isDistractor}
                onDragStart={() => {}}
                onTapSelect={handleBankTap}
                selected={selectedBankIdx === entry.bankIdx}
                disabled={disabled || submitted}
                tc={tc}
              />
            ))}
          </div>
        </div>
      )}

      {/* Submit button (if not auto-submitted) */}
      {!submitted && !allCorrect && correctCount > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PrimaryButton
            onClick={handleSubmit}
            style={{ fontSize: 14, padding: "14px 28px" }}
          >
            Submit ({correctCount}/{blanks.length} filled)
          </PrimaryButton>
        </div>
      )}

      {/* Post-submit summary */}
      {submitted && (
        <div style={{
          textAlign: "center", padding: 24,
          animation: "cloze-popIn 0.4s ease",
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>
            {allCorrect ? "🎉" : correctCount >= blanks.length / 2 ? "👏" : "📝"}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>
            {allCorrect ? "Perfect!" : `${correctCount} of ${blanks.length} Correct`}
          </div>
          <div style={{
            fontSize: 28, fontWeight: 900, marginTop: 8,
            color: totalScore >= maxPossible * 0.8 ? "#22c55e" : totalScore >= maxPossible * 0.5 ? "#f59e0b" : "#ef4444",
          }}>
            {totalScore} / {maxPossible} pts
          </div>
          {attempts.some((a) => a === 1 && statuses[attempts.indexOf(a)] === "correct") && (
            <div style={{
              fontSize: 13, fontWeight: 700, color: tc.resultSubtext,
              marginTop: 8,
            }}>
              {attempts.filter((a, i) => a === 1 && statuses[i] === "correct").length} blanks correct on first try!
            </div>
          )}

          {/* Show answers for any missed */}
          {!allCorrect && (
            <div style={{
              marginTop: 16, textAlign: "left",
              padding: "12px 14px", borderRadius: 14,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: "rgba(148,163,184,0.5)",
                marginBottom: 8, textTransform: "uppercase", letterSpacing: 1,
              }}>
                Answers
              </div>
              {blanks.map((b, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 900,
                    background: statuses[i] === "correct" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    color: statuses[i] === "correct" ? "#22c55e" : "#ef4444",
                  }}>
                    {statuses[i] === "correct" ? "✓" : "✗"}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#22c55e" }}>
                    {b.answer}
                  </span>
                  {statuses[i] !== "correct" && fills[i] && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(239,68,68,0.6)", textDecoration: "line-through" }}>
                      ({fills[i]})
                    </span>
                  )}
                  <span style={{
                    marginLeft: "auto", fontSize: 11, fontWeight: 800,
                    color: statuses[i] === "correct" ? "#22c55e" : "rgba(148,163,184,0.4)",
                  }}>
                    {statuses[i] === "correct" ? `+${pointsForAttempt(attempts[i])}` : "+0"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TaskCardFrame>
  );
}
