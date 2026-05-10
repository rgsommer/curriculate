// student-app/src/components/tasks/types/MatchingTask.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Matching / Connect (MATCHING)
 *
 * Two-column layout with a live SVG line between the columns.
 * Students tap (or drag) left item → right item to draw a match line.
 *
 * Supports task shapes:
 * - { leftItems, rightItems, correctMatches }
 * - { pairs:[{leftId,leftLabel,rightId,rightLabel}] }
 * - { items:[{left,right}] }
 */

// ── Seeded shuffle (keeps right-column order stable across re-renders) ──
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function strToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

export default function MatchingTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  mode = "play",
  review,
  readOnly,
}) {
  const norm = (x) => String(x ?? "").trim();
  const getLabel = (it) =>
    norm(it?.label ?? it?.text ?? it?.term ?? it?.value ?? it?.name);

  // ── Normalize task data ──────────────────────────────────────────────
  const normalized = useMemo(() => {
    const cfg =
      task?.config && typeof task.config === "object" ? task.config : {};

    const leftRaw =
      (Array.isArray(task?.leftItems) && task.leftItems) ||
      (Array.isArray(cfg?.leftItems) && cfg.leftItems) ||
      null;

    const rightRaw =
      (Array.isArray(task?.rightItems) && task.rightItems) ||
      (Array.isArray(cfg?.rightItems) && cfg.rightItems) ||
      null;

    const pairsRaw =
      (Array.isArray(task?.pairs) && task.pairs) ||
      (Array.isArray(task?.items) && task.items) ||
      (Array.isArray(cfg?.pairs) && cfg.pairs) ||
      (Array.isArray(cfg?.items) && cfg.items) ||
      [];

    let leftItems = [];
    let rightItems = [];
    let correctMatches = {};

    if (leftRaw && rightRaw) {
      leftItems = leftRaw.map((x, idx) => ({
        id: norm(x?.id ?? x?._id ?? `L${idx + 1}`) || `L${idx + 1}`,
        label: getLabel(x) || `Left ${idx + 1}`,
      }));
      rightItems = rightRaw.map((x, idx) => ({
        id: norm(x?.id ?? x?._id ?? `R${idx + 1}`) || `R${idx + 1}`,
        label: getLabel(x) || `Right ${idx + 1}`,
      }));

      const cm =
        (task?.correctMatches &&
          typeof task.correctMatches === "object" &&
          task.correctMatches) ||
        (task?.correctAnswer &&
          typeof task.correctAnswer === "object" &&
          task.correctAnswer) ||
        (cfg?.correctMatches &&
          typeof cfg.correctMatches === "object" &&
          cfg.correctMatches) ||
        (cfg?.correctAnswer &&
          typeof cfg.correctAnswer === "object" &&
          cfg.correctAnswer) ||
        {};

      correctMatches = Object.fromEntries(
        Object.entries(cm).map(([k, v]) => [norm(k), norm(v)])
      );
    } else {
      leftItems = pairsRaw.map((p, idx) => ({
        id: norm(p?.leftId ?? p?.id ?? `L${idx + 1}`) || `L${idx + 1}`,
        label: norm(
          p?.leftLabel ?? p?.leftText ?? p?.left ?? p?.term ?? `Left ${idx + 1}`
        ),
      }));
      rightItems = pairsRaw.map((p, idx) => ({
        id: norm(p?.rightId ?? p?.matchId ?? `R${idx + 1}`) || `R${idx + 1}`,
        label: norm(
          p?.rightLabel ??
            p?.rightText ??
            p?.right ??
            p?.definition ??
            `Right ${idx + 1}`
        ),
      }));

      correctMatches = Object.fromEntries(
        pairsRaw.map((p, idx) => [
          norm(p?.leftId ?? p?.id ?? `L${idx + 1}`) || `L${idx + 1}`,
          norm(p?.rightId ?? p?.matchId ?? `R${idx + 1}`) || `R${idx + 1}`,
        ])
      );
    }

    // Ensure unique IDs
    const uniq = (arr, prefix) => {
      const seen = new Set();
      return arr.map((it, idx) => {
        let id = norm(it.id) || `${prefix}${idx + 1}`;
        while (seen.has(id)) id = `${id}-${idx + 1}`;
        seen.add(id);
        return { ...it, id };
      });
    };

    return {
      leftItems: uniq(leftItems, "L"),
      rightItems: uniq(rightItems, "R"),
      correctMatches,
    };
  }, [task]);

  const { leftItems, rightItems, correctMatches } = normalized;

  // Shuffle right items once per task (stable based on task content)
  const shuffledRight = useMemo(() => {
    const seed = strToSeed(leftItems.map((i) => i.id + i.label).join("|"));
    return seededShuffle(rightItems, seed);
  }, [leftItems, rightItems]);

  const isReview = mode === "review" || !!review || !!readOnly;
  const isDisabled = !!disabled || !!readOnly || isReview;

  const reviewMatches =
    (review &&
      typeof review === "object" &&
      (review.matches ||
        review.answer?.matches ||
        review.studentAnswer?.matches)) ||
    null;

  const [matches, setMatches] = useState({}); // { [leftId]: rightId }
  const [activeLeft, setActiveLeft] = useState(null);

  // Reset when task changes
  useEffect(() => {
    setMatches({});
    setActiveLeft(null);
  }, [task?.taskType, task?.title, task?.prompt]);

  // In review mode, show student selections
  useEffect(() => {
    if (!isReview) return;
    if (!reviewMatches || typeof reviewMatches !== "object") return;
    setMatches(
      Object.fromEntries(
        Object.entries(reviewMatches).map(([k, v]) => [norm(k), norm(v)])
      )
    );
  }, [isReview]);

  useEffect(() => {
    if (isReview) return;
    onAnswerChange?.({ matches });
  }, [matches, isReview]);

  const isComplete =
    leftItems.length > 0 &&
    Object.keys(matches).length === leftItems.length;

  const getLeftForRight = (rightId) => {
    const entry = Object.entries(matches).find(([, r]) => r === rightId);
    return entry ? entry[0] : null;
  };

  const doMatch = (leftId, rightId) => {
    if (!leftId || !rightId || isDisabled) return;
    if (matches[leftId]) return; // left already used
    if (Object.values(matches).includes(rightId)) return; // right already used
    setMatches((prev) => ({ ...prev, [leftId]: rightId }));
    setActiveLeft(null);
  };

  const removeMatch = (leftId) => {
    if (isDisabled) return;
    setMatches((prev) => {
      const next = { ...prev };
      delete next[leftId];
      return next;
    });
    setActiveLeft(null);
  };

  const clearAll = () => {
    if (isDisabled) return;
    setMatches({});
    setActiveLeft(null);
  };

  // After Submit, enter a local review state that shows the answer
  // key overlaid on the matches: green lines for the student's correct
  // picks, red for incorrect, plus the correct line drawn alongside in
  // dashed green.  User taps Continue when they've absorbed it.
  // Falls back to immediate submit when there's no correct-answer key
  // (some matching tasks don't ship one).
  const [localReview, setLocalReview] = useState(false);
  const hasAnswerKey =
    correctMatches && Object.keys(correctMatches).length > 0;

  const handleSubmit = () => {
    if (!isComplete || isDisabled) return;
    if (hasAnswerKey && !localReview && !isReview) {
      setLocalReview(true);
      return;
    }
    onSubmit?.({ matches });
  };

  // Score for the review banner.
  const reviewScore = useMemo(() => {
    if (!hasAnswerKey) return null;
    let correct = 0;
    leftItems.forEach((l) => {
      if (matches[l.id] === correctMatches[l.id]) correct += 1;
    });
    return { correct, total: leftItems.length };
  }, [matches, correctMatches, leftItems, hasAnswerKey]);

  // ── SVG line drawing ─────────────────────────────────────────────────
  const containerRef = useRef(null);
  const [lines, setLines] = useState([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();

    const next = [];

    // Treat localReview the same as the official review mode for line drawing.
    const inReview = isReview || localReview;
    if (inReview) {
      // 1) Draw the student's actual picks coloured by correctness.
      for (const [leftId, rightId] of Object.entries(matches)) {
        const correctRightId = correctMatches?.[leftId];
        const le = document.getElementById(`ml-${leftId}`);
        const re = document.getElementById(`mr-${rightId}`);
        if (!le || !re) continue;
        const lr = le.getBoundingClientRect();
        const rr = re.getBoundingClientRect();
        const x1 = lr.right - crect.left;
        const y1 = lr.top + lr.height / 2 - crect.top;
        const x2 = rr.left - crect.left;
        const y2 = rr.top + rr.height / 2 - crect.top;
        const ok = correctRightId && rightId === correctRightId;
        next.push({ x1, y1, x2, y2, color: ok ? "#22c55e" : "#ef4444", review: true });
      }
      // 2) For wrong picks, also draw the CORRECT answer in dashed green.
      for (const left of leftItems) {
        const correctRightId = correctMatches?.[left.id];
        if (!correctRightId) continue;
        const studentPicked = matches?.[left.id];
        if (studentPicked === correctRightId) continue; // already drawn solid green
        const le = document.getElementById(`ml-${left.id}`);
        const re = document.getElementById(`mr-${correctRightId}`);
        if (!le || !re) continue;
        const lr = le.getBoundingClientRect();
        const rr = re.getBoundingClientRect();
        const x1 = lr.right - crect.left;
        const y1 = lr.top + lr.height / 2 - crect.top;
        const x2 = rr.left - crect.left;
        const y2 = rr.top + rr.height / 2 - crect.top;
        next.push({ x1, y1, x2, y2, color: "#22c55e", review: true, dashed: true });
      }
    } else {
      for (const [leftId, rightId] of Object.entries(matches)) {
        const le = document.getElementById(`ml-${leftId}`);
        const re = document.getElementById(`mr-${rightId}`);
        if (!le || !re) continue;
        const lr = le.getBoundingClientRect();
        const rr = re.getBoundingClientRect();
        const x1 = lr.right - crect.left;
        const y1 = lr.top + lr.height / 2 - crect.top;
        const x2 = rr.left - crect.left;
        const y2 = rr.top + rr.height / 2 - crect.top;
        next.push({ x1, y1, x2, y2, color: "#6366f1", review: false });
      }
    }

    setLines(next);
  }, [matches, correctMatches, isReview, leftItems, localReview]);

  // Recompute lines on any relevant change + on resize
  useEffect(() => {
    computeLines();
    const ro = new ResizeObserver(computeLines);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", computeLines);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", computeLines);
    };
  }, [computeLines]);

  // Detect placeholder / generic labels that the AI sometimes produces
  const _isPlaceholder = (s) =>
    /^(left|right|term|definition|item|word|concept|option|match|key\s*term)\s*\d+$/i.test(
      String(s || "").trim()
    );
  const hasPlaceholders =
    leftItems.some((it) => _isPlaceholder(it.label)) ||
    rightItems.some((it) => _isPlaceholder(it.label));

  if (!leftItems.length || !rightItems.length || hasPlaceholders) {
    return (
      <div className="p-6">
        <div className="text-xl font-bold mb-2 text-red-600">
          {hasPlaceholders
            ? "This matching task has placeholder content. Please regenerate the task set."
            : "No matching items found."}
        </div>
      </div>
    );
  }

  // ── Colours ──────────────────────────────────────────────────────────
  const COL = {
    leftBase: "#1e3a5f",      // deep navy
    leftActive: "#2563eb",    // bright blue
    leftMatched: "#475569",   // slate-600
    rightBase: "#1e3a5f",
    rightActive: "#7c3aed",   // violet
    rightMatched: "#475569",
    rightHighlight: "#2563eb", // when waiting for right selection
    dot: "rgba(255,255,255,0.9)",
    bg: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    card: "rgba(255,255,255,0.06)",
    cardBorder: "rgba(255,255,255,0.12)",
    text: "#f1f5f9",
    subtext: "rgba(241,245,249,0.65)",
  };

  return (
    <div
      style={{
        background: COL.bg,
        minHeight: "100%",
        padding: "16px 12px 20px",
        fontFamily: "system-ui, sans-serif",
        color: COL.text,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 900, lineHeight: 1.2 }}>
          {task?.title || "Match the Pairs"}
        </div>
        <div style={{ fontSize: "0.95rem", marginTop: 4, color: COL.subtext }}>
          {task?.prompt || "Tap a term on the left, then tap its match on the right."}
        </div>
      </div>

      {/* First-time tip — only when nothing's been matched yet, no
          left selected.  Several testers expected drag-and-drop on
          first encounter; spell out the tap-tap rhythm. */}
      {!isReview && !localReview && Object.keys(matches).length === 0 && !activeLeft && (
        <div
          style={{
            background: "rgba(34,197,94,0.10)",
            border: "1px solid rgba(34,197,94,0.30)",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.85rem",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.4,
            color: "rgba(220,252,231,0.95)",
          }}
        >
          👉 <b>Tap</b> a term on the <b>left</b>, then <b>tap</b> its match on the <b>right</b>.
          <span style={{ display: "block", fontWeight: 600, opacity: 0.8, marginTop: 2 }}>
            (No dragging — just two taps per pair.)
          </span>
        </div>
      )}

      {/* Instructions bar */}
      {!isReview && !localReview && (
        <div
          style={{
            background: activeLeft
              ? "rgba(37,99,235,0.25)"
              : "rgba(255,255,255,0.05)",
            border: activeLeft
              ? "1px solid rgba(37,99,235,0.5)"
              : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: "8px 14px",
            fontSize: "0.88rem",
            fontWeight: 600,
            textAlign: "center",
            transition: "all 0.2s",
          }}
        >
          {activeLeft
            ? "✨ Now tap its match on the RIGHT →"
            : `Tap a term on the LEFT to start   •   ${Object.keys(matches).length}/${leftItems.length} matched`}
        </div>
      )}

      {(isReview || localReview) && (
        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.92rem",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          {reviewScore && (
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 900,
                color: reviewScore.correct === reviewScore.total ? "#22c55e" : "#fbbf24",
                marginBottom: 4,
              }}
            >
              You got {reviewScore.correct}/{reviewScore.total} correct
            </div>
          )}
          <span style={{ color: "#22c55e" }}>—— Solid green</span> = your right answer&nbsp;
          <span style={{ color: "#22c55e" }}>· · ·</span> = correct answer (dashed)&nbsp;
          <span style={{ color: "#ef4444" }}>—— Red</span> = your wrong pick
        </div>
      )}

      {/* Main columns + SVG */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 40px 1fr",
          gap: 0,
          alignItems: "start",
        }}
      >
        {/* ── SVG line layer ── */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {lines.map((ln, i) => {
            // Bezier curve from right-dot to left-dot
            const dx = (ln.x2 - ln.x1) * 0.45;
            const d = `M ${ln.x1} ${ln.y1} C ${ln.x1 + dx} ${ln.y1}, ${ln.x2 - dx} ${ln.y2}, ${ln.x2} ${ln.y2}`;
            return (
              <g key={i}>
                {/* Shadow */}
                <path
                  d={d}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="7"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Line */}
                <path
                  d={d}
                  stroke={ln.color}
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={ln.dashed ? "8 6" : undefined}
                  opacity={ln.dashed ? 0.85 : 1}
                />
                {/* End dots */}
                <circle cx={ln.x1} cy={ln.y1} r="6" fill={ln.color} />
                <circle cx={ln.x2} cy={ln.y2} r="6" fill={ln.color} />
              </g>
            );
          })}
        </svg>

        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leftItems.map((it) => {
            const isMatched = !!matches[it.id];
            const isActive = activeLeft === it.id;

            let bg = COL.card;
            let border = COL.cardBorder;
            let opacity = 1;

            if (isActive) {
              bg = "rgba(37,99,235,0.35)";
              border = "rgba(37,99,235,0.8)";
            } else if (isMatched) {
              bg = "rgba(99,102,241,0.15)";
              border = "rgba(99,102,241,0.35)";
              opacity = 0.75;
            }

            return (
              <div
                key={it.id}
                id={`ml-${it.id}`}
                onClick={() => {
                  if (isDisabled) return;
                  if (isMatched) {
                    removeMatch(it.id);
                    return;
                  }
                  setActiveLeft((prev) => (prev === it.id ? null : it.id));
                }}
                style={{
                  background: bg,
                  border: `2px solid ${border}`,
                  borderRadius: 14,
                  padding: "12px 14px 12px 14px",
                  cursor: isDisabled ? "default" : "pointer",
                  opacity,
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  boxShadow: isActive
                    ? "0 0 0 3px rgba(37,99,235,0.4), 0 2px 8px rgba(0,0,0,0.3)"
                    : "0 1px 4px rgba(0,0,0,0.25)",
                  transform: isActive ? "scale(1.02)" : "scale(1)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.3 }}>
                  {it.label}
                </span>
                {/* Connector dot on right edge */}
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: isActive
                      ? "#60a5fa"
                      : isMatched
                      ? "#818cf8"
                      : "rgba(255,255,255,0.3)",
                    border: "2px solid rgba(255,255,255,0.5)",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* ── Centre gap (lines go here) ── */}
        <div />

        {/* ── Right column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shuffledRight.map((it) => {
            const usedByLeft = getLeftForRight(it.id);
            const isMatched = !!usedByLeft;
            const waitingForRight = !!activeLeft;

            let bg = COL.card;
            let border = COL.cardBorder;
            let opacity = 1;

            if (isMatched) {
              bg = "rgba(99,102,241,0.15)";
              border = "rgba(99,102,241,0.35)";
              opacity = 0.75;
            } else if (waitingForRight && !isDisabled) {
              bg = "rgba(124,58,237,0.2)";
              border = "rgba(124,58,237,0.55)";
            }

            return (
              <div
                key={it.id}
                id={`mr-${it.id}`}
                onClick={() => {
                  if (isDisabled) return;
                  if (isMatched) return; // already used
                  if (activeLeft) {
                    doMatch(activeLeft, it.id);
                  }
                }}
                style={{
                  background: bg,
                  border: `2px solid ${border}`,
                  borderRadius: 14,
                  padding: "12px 14px 12px 14px",
                  cursor:
                    isDisabled || isMatched
                      ? "default"
                      : activeLeft
                      ? "pointer"
                      : "default",
                  opacity,
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
              >
                {/* Connector dot on left edge */}
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: isMatched
                      ? "#818cf8"
                      : waitingForRight && !isDisabled
                      ? "#a78bfa"
                      : "rgba(255,255,255,0.3)",
                    border: "2px solid rgba(255,255,255,0.5)",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.3 }}>
                  {it.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      {!isReview && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
            marginTop: 4,
          }}
        >
          {/* Clear All hidden during localReview — once you've submitted
              and we're showing the answer key, undoing makes no sense. */}
          {!localReview && (
            <button
              type="button"
              onClick={clearAll}
              disabled={isDisabled || Object.keys(matches).length === 0}
              style={{
                padding: "10px 22px",
                borderRadius: 999,
                fontWeight: 800,
                fontSize: "0.95rem",
                border: "none",
                cursor:
                  isDisabled || Object.keys(matches).length === 0
                    ? "not-allowed"
                    : "pointer",
                background:
                  isDisabled || Object.keys(matches).length === 0
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(239,68,68,0.75)",
                color:
                  isDisabled || Object.keys(matches).length === 0
                    ? "rgba(255,255,255,0.3)"
                    : "#fff",
              }}
            >
              Clear All
            </button>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isComplete || isDisabled}
            style={{
              padding: "10px 32px",
              borderRadius: 999,
              fontWeight: 900,
              fontSize: "1rem",
              border: "none",
              cursor: isComplete && !isDisabled ? "pointer" : "not-allowed",
              background:
                isComplete && !isDisabled
                  ? (localReview
                      ? "linear-gradient(135deg, #2563eb, #4338ca)"
                      : "linear-gradient(135deg, #22c55e, #16a34a)")
                  : "rgba(255,255,255,0.08)",
              color: isComplete && !isDisabled ? "#fff" : "rgba(255,255,255,0.3)",
              boxShadow:
                isComplete && !isDisabled
                  ? "0 4px 14px rgba(34,197,94,0.4)"
                  : "none",
              transform: isComplete && !isDisabled ? "scale(1.03)" : "scale(1)",
              transition: "all 0.2s",
            }}
          >
            {!isComplete
              ? `${leftItems.length - Object.keys(matches).length} left to match`
              : localReview
                ? "Continue ▶"
                : (hasAnswerKey ? "✓ Submit & See Answers" : "✓ Submit")}
          </button>
        </div>
      )}
    </div>
  );
}
