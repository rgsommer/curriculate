// student-app/src/components/tasks/types/PeerEditingTask.jsx
//
// Redesigned peer-editing with teacher-style markup.
// Every word is tappable → popup to choose an annotation mark →
// inline shows the short code (like "Sp", "ww", "agr") in a
// hand-written style with the word circled in red, just like
// a real teacher would mark a paper.

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton } from "../taskStyles";

/* ------------------------------------------------------------------ */
/*  CSS keyframe animations (injected once)                           */
/* ------------------------------------------------------------------ */
const STYLE_ID = "peer-editing-anims-v2";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes pe-popIn {
      0%   { transform: scale(0.85); opacity: 0; }
      60%  { transform: scale(1.05); opacity: 1; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes pe-timerPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.6; }
    }
    @keyframes pe-slideUp {
      0%   { transform: translateY(12px); opacity: 0; }
      100% { transform: translateY(0);    opacity: 1; }
    }
    @keyframes pe-fadeIn {
      0%   { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes pe-circleIn {
      0%   { r: 0; opacity: 0; }
      100% { r: inherit; opacity: 1; }
    }
  `;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/*  Annotation marks — teacher correction conventions                 */
/* ------------------------------------------------------------------ */
const MARK_CATEGORIES = [
  {
    label: "Writing & Grammar",
    icon: "✏️",
    marks: [
      { code: "Sp",      full: "Spelling mistake",              color: "#ef4444" },
      { code: "Cap",     full: "Needs a capital letter",         color: "#f59e0b" },
      { code: "lc",      full: "Lowercase needed",              color: "#f59e0b" },
      { code: "P",       full: "Punctuation error",             color: "#f97316" },
      { code: "Frag",    full: "Sentence fragment",             color: "#ef4444" },
      { code: "Run-on",  full: "Run-on sentence",               color: "#ef4444" },
      { code: "Agr",     full: "Subject-verb agreement error",  color: "#dc2626" },
      { code: "Tense",   full: "Incorrect verb tense",          color: "#dc2626" },
      { code: "ww",      full: "Wrong word used",               color: "#e11d48" },
      { code: "Rep",     full: "Repetitive wording",            color: "#a855f7" },
      { code: "Awk",     full: "Awkward phrasing",              color: "#a855f7" },
      { code: "?",       full: "Unclear meaning",               color: "#6366f1" },
    ],
  },
  {
    label: "Content & Thinking",
    icon: "🧠",
    marks: [
      { code: "✓",      full: "Correct / good point",          color: "#22c55e" },
      { code: "✓+",     full: "Strong insight / excellent",    color: "#16a34a" },
      { code: "✗",      full: "Incorrect",                     color: "#ef4444" },
      { code: "△",      full: "Partially correct",             color: "#f59e0b" },
      { code: "E",       full: "Needs more explanation",        color: "#3b82f6" },
      { code: "D",       full: "Needs more detail",             color: "#3b82f6" },
      { code: "Ex",      full: "Give an example",               color: "#0ea5e9" },
      { code: "Dev",     full: "Develop your idea further",     color: "#0ea5e9" },
      { code: "Rel",     full: "Not relevant to the question",  color: "#f97316" },
    ],
  },
  {
    label: "Organization",
    icon: "📋",
    marks: [
      { code: "¶",       full: "Start a new paragraph",        color: "#8b5cf6" },
      { code: "→",       full: "Move or reorder this part",    color: "#8b5cf6" },
      { code: "Org",     full: "Organization issue",            color: "#a855f7" },
      { code: "Intro?",  full: "Unclear or missing intro",     color: "#6366f1" },
      { code: "Concl?",  full: "Weak or missing conclusion",   color: "#6366f1" },
      { code: "Trans",   full: "Needs better transitions",     color: "#7c3aed" },
    ],
  },
  {
    label: "Presentation",
    icon: "📊",
    marks: [
      { code: "F",       full: "Formatting issue",             color: "#f59e0b" },
      { code: "Neat",    full: "Improve presentation",         color: "#f59e0b" },
      { code: "Inc",     full: "Incomplete",                   color: "#ef4444" },
    ],
  },
  {
    label: "Positive",
    icon: "⭐",
    marks: [
      { code: "G",       full: "Good",                          color: "#22c55e" },
      { code: "VG",      full: "Very good",                    color: "#16a34a" },
      { code: "Ex!",     full: "Excellent",                    color: "#059669" },
      { code: "NI",      full: "Nice insight",                 color: "#10b981" },
    ],
  },
];

// Flat lookup: code -> mark data
const ALL_MARKS = {};
MARK_CATEGORIES.forEach((cat) =>
  cat.marks.forEach((m) => {
    ALL_MARKS[m.code] = m;
  })
);

// Positive codes that get a green treatment instead of red
const POSITIVE_CODES = new Set(["✓", "✓+", "G", "VG", "Ex!", "NI"]);

/* ------------------------------------------------------------------ */
/*  Timer hook                                                        */
/* ------------------------------------------------------------------ */
const TIMED_DURATION = 180;

function useCountdown(startSeconds, active) {
  const [remaining, setRemaining] = useState(startSeconds);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    setRemaining(startSeconds);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [active, startSeconds]);

  return remaining;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Popup component: tap a word to see annotation categories          */
/* ------------------------------------------------------------------ */
function AnnotationPopup({ word, wordIdx, currentMark, onSelect, onClear, onClose, anchorRect }) {
  const popRef = useRef(null);
  const [activeCat, setActiveCat] = useState(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [onClose]);

  // If there's already a mark, show it first
  const existingMark = currentMark ? ALL_MARKS[currentMark] : null;

  return (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        animation: "pe-fadeIn 0.15s ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "70vh",
          overflowY: "auto",
          background: "linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)",
          borderRadius: "24px 24px 0 0",
          padding: "20px 16px 28px",
          animation: "pe-slideUp 0.2s ease",
        }}
      >
        {/* Header: the tapped word */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 18, fontWeight: 900, color: "#fff",
              background: "rgba(99,102,241,0.2)", borderRadius: 12, padding: "6px 14px",
              border: "1px solid rgba(99,102,241,0.3)",
            }}>
              "{word}"
            </span>
            <span style={{ fontSize: 11, color: "rgba(226,232,240,0.5)", fontWeight: 700 }}>
              word {wordIdx + 1}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 10,
              width: 36, height: 36, fontSize: 18, color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* If there's an existing mark, show it prominently */}
        {existingMark && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: "10px 14px", borderRadius: 14,
            background: `${existingMark.color}18`,
            border: `1px solid ${existingMark.color}40`,
          }}>
            <span style={{
              fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
              fontSize: 20, fontWeight: 700, color: existingMark.color,
            }}>
              {currentMark}
            </span>
            <span style={{ flex: 1, fontSize: 13, color: "rgba(226,232,240,0.8)", fontWeight: 700 }}>
              {existingMark.full}
            </span>
            <button
              onClick={onClear}
              style={{
                background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 800,
                color: "#ef4444", cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        )}

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {MARK_CATEGORIES.map((cat, ci) => (
            <button
              key={ci}
              onClick={() => setActiveCat(activeCat === ci ? null : ci)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "7px 12px", borderRadius: 12, fontSize: 12, fontWeight: 800,
                cursor: "pointer", border: "1px solid",
                borderColor: activeCat === ci ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)",
                background: activeCat === ci ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                color: activeCat === ci ? "#a5b4fc" : "rgba(226,232,240,0.7)",
                transition: "all 0.15s ease",
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Marks for selected category */}
        {activeCat !== null && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8,
            animation: "pe-fadeIn 0.15s ease",
          }}>
            {MARK_CATEGORIES[activeCat].marks.map((mark) => (
              <button
                key={mark.code}
                onClick={() => onSelect(mark.code)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px", borderRadius: 14, cursor: "pointer",
                  border: `1px solid ${currentMark === mark.code ? mark.color : "rgba(255,255,255,0.08)"}`,
                  background: currentMark === mark.code ? `${mark.color}20` : "rgba(255,255,255,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{
                  fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
                  fontSize: 18, fontWeight: 700, color: mark.color,
                  minWidth: 34, textAlign: "center",
                }}>
                  {mark.code}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "rgba(226,232,240,0.75)",
                  lineHeight: 1.3, textAlign: "left",
                }}>
                  {mark.full}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Quick picks: show all marks at once if no category selected */}
        {activeCat === null && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6,
            animation: "pe-fadeIn 0.15s ease",
          }}>
            {MARK_CATEGORIES.flatMap((cat) => cat.marks).map((mark) => (
              <button
                key={mark.code}
                onClick={() => onSelect(mark.code)}
                title={mark.full}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "7px 10px", borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${currentMark === mark.code ? mark.color : "rgba(255,255,255,0.06)"}`,
                  background: currentMark === mark.code ? `${mark.color}20` : "rgba(255,255,255,0.02)",
                  transition: "all 0.12s ease",
                }}
              >
                <span style={{
                  fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
                  fontSize: 15, fontWeight: 700, color: mark.color,
                }}>
                  {mark.code}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Marked word component — the inline teacher markup                 */
/* ------------------------------------------------------------------ */
function MarkedWord({ word, idx, markCode, isSelected, onTap, disabled }) {
  const mark = markCode ? ALL_MARKS[markCode] : null;
  const isPositive = markCode && POSITIVE_CODES.has(markCode);
  const borderColor = mark ? mark.color : "transparent";

  return (
    <span
      onClick={onTap}
      style={{
        display: "inline-block",
        position: "relative",
        padding: mark ? "4px 6px 12px" : "4px 6px",
        margin: "8px 2px 4px",
        cursor: disabled ? "default" : "pointer",
        transition: "all 0.15s ease",
        userSelect: "none",
        // Circle effect for marked words (like teacher circling in red)
        borderRadius: mark ? 8 : 6,
        border: mark
          ? `2.5px solid ${borderColor}`
          : isSelected
            ? "2px solid rgba(99,102,241,0.5)"
            : "1.5px solid transparent",
        background: mark
          ? `${borderColor}12`
          : isSelected
            ? "rgba(99,102,241,0.08)"
            : "transparent",
        animation: mark ? "pe-popIn 0.25s ease" : undefined,
      }}
    >
      {/* The word text */}
      <span style={{
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 1.5,
        color: mark
          ? (isPositive ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)")
          : "rgba(255,255,255,0.92)",
        textDecoration: mark && !isPositive ? "wavy underline" : "none",
        textDecorationColor: mark ? borderColor : undefined,
        textUnderlineOffset: "3px",
      }}>
        {word}
      </span>

      {/* Inline annotation code — hand-written style, positioned below the word */}
      {mark && (
        <span style={{
          position: "absolute",
          bottom: -2,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
          fontSize: 13,
          fontWeight: 700,
          color: borderColor,
          whiteSpace: "nowrap",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          animation: "pe-slideUp 0.2s ease",
          lineHeight: 1,
        }}>
          {markCode}
        </span>
      )}
    </span>
  );
}

/* ================================================================== */
/*  PeerEditingTask (main component)                                  */
/* ================================================================== */
export default function PeerEditingTask({ task, onSubmit, disabled }) {
  injectStyles();

  const mode = task?.mode || "on-screen";
  const passage = task?.passage || "";
  const words = useMemo(() => passage.split(/\s+/).filter(Boolean), [passage]);

  // Expected error indices come from the AI-generated errors[] array.
  // We use these to (a) show a "X issues to find" counter and (b) power
  // the Hint button which reveals the sentence/line where an unfound
  // issue lives.
  const errorIndices = useMemo(() => {
    const arr = Array.isArray(task?.errors) ? task.errors : [];
    return arr
      .map((e) => Number(e?.wordIndex))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < words.length);
  }, [task, words.length]);
  const totalIssuesToFind = errorIndices.length;

  // Build a wordIdx → sentenceIdx map.  We split on .!? so the hint
  // can say "Sentence 3" (stable across device widths — flex-wrap
  // line breaks aren't reliable for this).
  const sentences = useMemo(() => {
    if (!passage) return [];
    // Greedy sentence split keeping terminator with the sentence.
    const matches = passage.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [passage];
    return matches.map((s) => s.trim()).filter(Boolean);
  }, [passage]);

  const wordIdxToSentence = useMemo(() => {
    const map = new Array(words.length).fill(0);
    let cursor = 0;
    sentences.forEach((sent, sIdx) => {
      const wordsInSent = sent.split(/\s+/).filter(Boolean).length;
      for (let i = 0; i < wordsInSent && cursor < words.length; i += 1) {
        map[cursor] = sIdx;
        cursor += 1;
      }
    });
    // any trailing words → last sentence
    while (cursor < words.length) {
      map[cursor] = Math.max(0, sentences.length - 1);
      cursor += 1;
    }
    return map;
  }, [words.length, sentences]);

  // --- state ---
  const [marks, setMarks] = useState(new Map());      // wordIndex -> markCode
  const [popupIdx, setPopupIdx] = useState(null);      // which word's popup is open
  const [submitted, setSubmitted] = useState(false);
  const [photoData, setPhotoData] = useState(null);
  const fileRef = useRef(null);
  // Hint mechanic: students can request a sentence-level hint when
  // they're stuck.  Hints are tracked so we can ding the score later.
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintMessage, setHintMessage] = useState(null); // { sentenceIdx, text } | null
  const hintTimerRef = useRef(null);

  const timerActive = mode === "timed" && !submitted;
  const timeRemaining = useCountdown(TIMED_DURATION, timerActive);

  // Auto-submit when timer expires
  useEffect(() => {
    if (mode === "timed" && timeRemaining === 0 && !submitted) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining]);

  /* ---------- helpers ---------- */

  const tapWord = useCallback((idx) => {
    if (disabled || submitted) return;
    setPopupIdx(idx);
  }, [disabled, submitted]);

  const selectMark = useCallback((code) => {
    if (popupIdx === null) return;
    setMarks((prev) => {
      const next = new Map(prev);
      next.set(popupIdx, code);
      return next;
    });
    setPopupIdx(null);
  }, [popupIdx]);

  const clearMark = useCallback(() => {
    if (popupIdx === null) return;
    setMarks((prev) => {
      const next = new Map(prev);
      next.delete(popupIdx);
      return next;
    });
    setPopupIdx(null);
  }, [popupIdx]);

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    const editsArr = [];
    marks.forEach((code, idx) => {
      const m = ALL_MARKS[code];
      editsArr.push({
        wordIndex: idx,
        word: words[idx],
        markCode: code,
        markFull: m?.full || code,
        category: POSITIVE_CODES.has(code) ? "positive" : "correction",
      });
    });
    // How many actual errors were caught? Marks placed on wordIndices
    // listed in task.errors count as hits regardless of the chosen mark code.
    const errSet = new Set(errorIndices);
    const issuesFound = editsArr.filter((e) => errSet.has(e.wordIndex)).length;
    onSubmit({
      edits: editsArr,
      mode,
      editCount: editsArr.length,
      corrections: editsArr.filter((e) => e.category === "correction").length,
      positives: editsArr.filter((e) => e.category === "positive").length,
      // Hint accounting — back-end can apply a small score penalty per hint.
      issuesToFind: totalIssuesToFind,
      issuesFound,
      hintsUsed,
      hintPenaltyPct:
        totalIssuesToFind > 0
          ? Math.round((hintsUsed / totalIssuesToFind) * 30)
          : 0,
      photoData: mode === "paper" ? photoData : null,
      timeRemaining: mode === "timed" ? timeRemaining : null,
    });
  }, [submitted, marks, words, mode, photoData, timeRemaining, onSubmit, errorIndices, hintsUsed, totalIssuesToFind]);

  // Hint: pick an unfound error and surface its sentence number + a
  // short snippet.  Uses errorIndices (set by the task author) and
  // wordIdxToSentence to translate.  Hint banner auto-clears after
  // 6s so it doesn't crowd the UI.
  const requestHint = useCallback(() => {
    if (submitted || disabled) return;
    if (errorIndices.length === 0) return;
    const remaining = errorIndices.filter((idx) => !marks.has(idx));
    if (remaining.length === 0) {
      setHintMessage({
        sentenceIdx: -1,
        text: "Nice — you've already caught every issue. Tap Submit when you're ready.",
      });
    } else {
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      const sIdx = wordIdxToSentence[pick] ?? 0;
      const sentText = (sentences[sIdx] || "").slice(0, 80);
      setHintMessage({
        sentenceIdx: sIdx,
        text: `Look more carefully at sentence ${sIdx + 1}${sentText ? `: "${sentText}${sentText.length === 80 ? "…" : ""}"` : ""}`,
      });
      setHintsUsed((h) => h + 1);
    }
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHintMessage(null), 6000);
  }, [submitted, disabled, errorIndices, marks, wordIdxToSentence, sentences]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const handlePhoto = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoData(reader.result);
    reader.readAsDataURL(file);
  }, []);

  /* ---------- stats ---------- */
  const markCount = marks.size;
  const correctionCount = [...marks.values()].filter((c) => !POSITIVE_CODES.has(c)).length;
  const positiveCount = markCount - correctionCount;
  const isPaper = mode === "paper";

  return (
    <TaskCardFrame
      title={task?.title || "Peer Editing"}
      badge="PEER EDIT"
      subtitle={mode === "timed" ? "Timed Challenge" : mode === "paper" ? "Paper Mode" : null}
      right={
        mode === "timed" ? (
          <Pill
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 16,
              fontWeight: 1000,
              color: timeRemaining <= 30 ? "#ef4444" : undefined,
              animation: timeRemaining <= 30 ? "pe-timerPulse 0.8s ease infinite" : undefined,
            }}
          >
            {fmtTime(timeRemaining)}
          </Pill>
        ) : null
      }
    >
      {/* --- Prompt --- */}
      {task?.prompt && (
        <div style={{
          fontSize: 14, fontWeight: 700, lineHeight: 1.55,
          color: "rgba(226,232,240,0.85)", marginBottom: 10,
        }}>
          {task.prompt}
        </div>
      )}

      {/* --- Instructions hint --- */}
      {!isPaper && !submitted && (
        <div style={{
          fontSize: 12, fontWeight: 700, color: "rgba(148,163,184,0.7)",
          marginBottom: 12, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 16 }}>👆</span>
          Tap any word to mark it — just like a teacher correcting a paper
        </div>
      )}

      {/* --- Issues-to-find counter + Hint button (on-screen mode only) --- */}
      {!isPaper && !submitted && totalIssuesToFind > 0 && (() => {
        // Marks placed on wordIndices listed in task.errors count as hits.
        const errSet = new Set(errorIndices);
        const found = [...marks.keys()].filter((idx) => errSet.has(idx)).length;
        const remaining = totalIssuesToFind - found;
        return (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "12px 14px", borderRadius: 14,
              // Solid surface (was 8% amber on dark theme — invisible).
              // Tester reported the whole status box was hard to read.
              background: "linear-gradient(135deg, #fef3c7, #fde68a)",
              border: "2px solid #f59e0b",
              boxShadow: "0 4px 12px rgba(245,158,11,0.18)",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 22 }}>🔍</span>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#78350f" }}>
                {totalIssuesToFind} {totalIssuesToFind === 1 ? "issue" : "issues"} hidden in this passage
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                {found > 0
                  ? `Marked ${found} of ${totalIssuesToFind}${remaining > 0 ? ` — ${remaining} to go.` : " — nice work!"}`
                  : "Mark words you think are wrong. Stuck? Use a hint."}
              </div>
            </div>
            <button
              type="button"
              onClick={requestHint}
              disabled={remaining === 0}
              title={remaining === 0 ? "All issues marked" : "Reveals which sentence has an unfound issue"}
              style={{
                padding: "10px 16px", borderRadius: 12,
                border: "none",
                background: remaining === 0
                  ? "rgba(15,23,42,0.10)"
                  : "linear-gradient(135deg, #f59e0b, #d97706)",
                color: remaining === 0 ? "rgba(15,23,42,0.4)" : "#fff",
                fontWeight: 900, fontSize: 13,
                cursor: remaining === 0 ? "default" : "pointer",
                boxShadow: remaining === 0 ? "none" : "0 4px 12px rgba(245,158,11,0.4)",
              }}
            >
              💡 Hint{hintsUsed > 0 ? ` (${hintsUsed} used)` : ""}
            </button>
          </div>
        );
      })()}

      {/* --- Hint banner (auto-clears after 6s) --- */}
      {!isPaper && !submitted && hintMessage && (
        <div
          style={{
            padding: "10px 14px", borderRadius: 14,
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.4)",
            color: "#fde68a", fontSize: 13, fontWeight: 700,
            marginBottom: 12, lineHeight: 1.5,
            animation: "pe-slideUp 0.2s ease",
          }}
        >
          💡 {hintMessage.text}
        </div>
      )}

      {/* --- Passage with tappable words --- */}
      <div style={{
        maxHeight: 400, overflowY: "auto",
        padding: "16px 14px",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.22)",
        marginBottom: 16,
        // Lined paper effect
        backgroundImage: "repeating-linear-gradient(transparent, transparent 31px, rgba(99,102,241,0.08) 31px, rgba(99,102,241,0.08) 32px)",
        backgroundSize: "100% 32px",
        backgroundPosition: "0 8px",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
          {words.map((word, idx) => (
            <MarkedWord
              key={idx}
              word={word}
              idx={idx}
              markCode={marks.get(idx) || null}
              isSelected={popupIdx === idx}
              onTap={() => !isPaper && tapWord(idx)}
              disabled={disabled || submitted || isPaper}
            />
          ))}
        </div>
      </div>

      {/* --- Annotation popup --- */}
      {popupIdx !== null && !submitted && (
        <AnnotationPopup
          word={words[popupIdx]}
          wordIdx={popupIdx}
          currentMark={marks.get(popupIdx) || null}
          onSelect={selectMark}
          onClear={clearMark}
          onClose={() => setPopupIdx(null)}
        />
      )}

      {/* --- Paper mode: photo upload --- */}
      {isPaper && !submitted && (
        <div style={{ marginBottom: 16 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            style={{ display: "none" }}
          />
          <GhostButton
            onClick={() => fileRef.current?.click()}
            style={{ fontSize: 14, padding: "14px 20px", width: "100%" }}
          >
            {photoData ? "✅ Photo Captured — Tap to Retake" : "📷 Take Photo of Edits"}
          </GhostButton>
          {photoData && (
            <div style={{ marginTop: 12, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <img src={photoData} alt="Captured edits" style={{ width: "100%", display: "block" }} />
            </div>
          )}
        </div>
      )}

      {/* --- Marks summary strip --- */}
      {!submitted && markCount > 0 && (
        <div style={{
          display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12,
          padding: "10px 12px", borderRadius: 14,
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.12)",
        }}>
          {[...marks.entries()].map(([idx, code]) => {
            const m = ALL_MARKS[code];
            return (
              <span
                key={idx}
                onClick={() => tapWord(idx)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", borderRadius: 8, cursor: "pointer",
                  background: `${m?.color || "#6366f1"}15`,
                  border: `1px solid ${m?.color || "#6366f1"}30`,
                  fontSize: 11, fontWeight: 800,
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.6)" }}>
                  {words[idx]?.slice(0, 12)}
                </span>
                <span style={{
                  fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
                  color: m?.color || "#6366f1", fontSize: 13, fontWeight: 700,
                }}>
                  {code}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* --- Summary + submit --- */}
      {!submitted && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill style={{ fontSize: 13, fontWeight: 900 }}>
              {isPaper
                ? (photoData ? "✅ Photo ready" : "📷 Snap your edits")
                : `${markCount} mark${markCount !== 1 ? "s" : ""}`}
            </Pill>
            {!isPaper && correctionCount > 0 && (
              <Pill style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.2)" }}>
                {correctionCount} correction{correctionCount !== 1 ? "s" : ""}
              </Pill>
            )}
            {!isPaper && positiveCount > 0 && (
              <Pill style={{ fontSize: 11, fontWeight: 800, color: "#22c55e", background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.2)" }}>
                {positiveCount} positive
              </Pill>
            )}
          </div>

          <PrimaryButton
            onClick={handleSubmit}
            disabled={disabled || (isPaper ? !photoData : markCount === 0)}
            style={{ fontSize: 14, padding: "14px 28px" }}
          >
            Submit Marks
          </PrimaryButton>
        </div>
      )}

      {/* --- Post-submit confirmation --- */}
      {submitted && (
        <div style={{
          textAlign: "center", padding: 24,
          animation: "pe-popIn 0.4s ease",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Marks Submitted!</div>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "rgba(226,232,240,0.6)", marginTop: 8,
            lineHeight: 1.6,
          }}>
            {isPaper
              ? "Your photo has been sent for review."
              : (
                <>
                  You marked {markCount} item{markCount !== 1 ? "s" : ""}
                  {correctionCount > 0 && <> — <span style={{ color: "#ef4444" }}>{correctionCount} correction{correctionCount !== 1 ? "s" : ""}</span></>}
                  {positiveCount > 0 && <> and <span style={{ color: "#22c55e" }}>{positiveCount} positive note{positiveCount !== 1 ? "s" : ""}</span></>}
                </>
              )}
            {mode === "timed" && timeRemaining > 0 && (
              <div style={{ marginTop: 4 }}>
                Time remaining: {fmtTime(timeRemaining)}
              </div>
            )}
          </div>

          {/* Show all marks in summary */}
          {markCount > 0 && !isPaper && (
            <div style={{
              marginTop: 16, textAlign: "left",
              padding: "12px 14px", borderRadius: 14,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.06)",
              maxHeight: 200, overflowY: "auto",
            }}>
              {[...marks.entries()].map(([idx, code]) => {
                const m = ALL_MARKS[code];
                return (
                  <div key={idx} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 12,
                  }}>
                    <span style={{
                      fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive",
                      fontSize: 16, fontWeight: 700, color: m?.color || "#6366f1",
                      minWidth: 40, textAlign: "center",
                    }}>
                      {code}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>
                      "{words[idx]}"
                    </span>
                    <span style={{ color: "rgba(226,232,240,0.45)", fontWeight: 600 }}>
                      — {m?.full || code}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </TaskCardFrame>
  );
}
