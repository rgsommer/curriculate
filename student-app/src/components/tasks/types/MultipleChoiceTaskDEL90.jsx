import React from "react";

/**
 * Multiple choice task (multi-question aware).
 *
 * Modes:
 *  - Single question (legacy): task.prompt + task.options
 *  - Multi-question: task.items[] of { prompt, options } (or inherits task.options)
 *
 * Key behavior:
 *  - Randomization is DETERMINISTIC per task (+ team if available) so it NEVER flips during interaction.
 *  - Multi-question submissions are mapped back to canonical order.
 *  - Single-question submits the chosen option string (legacy compatibility).
 *
 * Review behavior (NEW):
 *  - Pass mode="review" and review={...} to highlight correct answers.
 *  - Correct option: green tint/border
 *  - Selected wrong option: red tint/border
 */
export default function MultipleChoiceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,

  // NEW
  mode = "play", // "play" | "review"
  review = null,
}) {
  const isReview = mode === "review";

  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task?.items) && task.items.length > 0;

  // ---------- Stable seeded shuffle ----------
  function getTeamSalt() {
    try {
      return (
        localStorage.getItem("teamId") ||
        localStorage.getItem("curriculateTeamId") ||
        localStorage.getItem("activeclass_teamId") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function seededShuffle(arr, seedStr) {
    const a = [...arr];

    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) {
      seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    }

    const rand = () => {
      // xorshift32
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed >>>= 0;
      seed ^= seed << 5;
      seed >>>= 0;
      return (seed >>> 0) / 4294967296;
    };

    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }

    return a;
  }

  const taskKey = React.useMemo(() => {
    const id = task?._id || task?.id || task?.taskId || "task";
    const teamSalt = getTeamSalt();
    return `${String(id)}:${teamSalt}`;
  }, [task?._id, task?.id, task?.taskId]);

  // ---------- Helpers (NEW) ----------
  function toCanonicalIndexFromAnyAnswer(baseOptions, answer) {
    // answer may be number (canonical index) or string (option text)
    if (!Array.isArray(baseOptions) || !baseOptions.length) return null;

    if (typeof answer === "number" && Number.isFinite(answer)) {
      return answer >= 0 && answer < baseOptions.length ? answer : null;
    }

    if (typeof answer === "string" && answer.trim()) {
      const idx = baseOptions.findIndex((o) => String(o) === String(answer));
      return idx >= 0 ? idx : null;
    }

    // some drafts/structures
    if (answer && typeof answer === "object") {
      const maybe = answer.baseIndex ?? answer.index ?? answer.value ?? answer.answer ?? null;
      if (typeof maybe === "number") {
        return maybe >= 0 && maybe < baseOptions.length ? maybe : null;
      }
      if (typeof maybe === "string") {
        const idx = baseOptions.findIndex((o) => String(o) === String(maybe));
        return idx >= 0 ? idx : null;
      }
    }

    return null;
  }

  function getReviewPaint({ selected, isCorrect, isWrongChoice }) {
    // Preserve theme for normal selection, but overlay correctness colors in review.
    const borderColorDefault = "rgba(15,23,42,0.12)";

    if (isReview && isCorrect) {
      return {
        background: "#dcfce7", // green-100
        color: "#065f46", // emerald-800
        borderColor: "#16a34a", // green-600
      };
    }

    if (isReview && isWrongChoice) {
      return {
        background: "#fee2e2", // red-100
        color: "#7f1d1d", // red-900-ish
        borderColor: "#dc2626", // red-600
      };
    }

    // not correctness paint; fall back to your existing styles
    return {
      background: selected ? optionSelectedBg : optionBaseBg,
      color: selected ? "#ffffff" : "#111827",
      borderColor: borderColorDefault,
    };
  }

  // ---------- State ----------
  // Single-question mode
  const [singleOptionOrder, setSingleOptionOrder] = React.useState([]);
  const [singleSelectedDisplayIdx, setSingleSelectedDisplayIdx] = React.useState(null);

  // Multi-question mode
  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiSelectedByDisplayIdx, setMultiSelectedByDisplayIdx] = React.useState([]);

  // ---------- Build stable presentation once per task ----------
  React.useEffect(() => {
    if (!task) return;

    if (hasItems) {
      const canonicalItems = Array.isArray(task.items) ? task.items : [];
      const count = canonicalItems.length;

      const questionOrder = seededShuffle(
        Array.from({ length: count }, (_, i) => i),
        `${taskKey}:questions`
      );

      const built = questionOrder.map((canonicalIndex) => {
        const item = canonicalItems[canonicalIndex] || {};
        const baseOptions =
          (Array.isArray(item.options) && item.options.length
            ? item.options
            : Array.isArray(task.options) && task.options.length
            ? task.options
            : []) || [];

        const optionOrder = seededShuffle(
          Array.from({ length: baseOptions.length }, (_, i) => i),
          `${taskKey}:q${canonicalIndex}:opts`
        );

        const displayOptions = optionOrder.map((i) => baseOptions[i]);

        return {
          canonicalIndex,
          prompt:
            (typeof item.prompt === "string" && item.prompt.trim()
              ? item.prompt.trim()
              : typeof task.prompt === "string" && task.prompt.trim()
              ? task.prompt.trim()
              : `Question ${canonicalIndex + 1}`),
          baseOptions,
          optionOrder,
          displayOptions,
        };
      });

      setPresentedItems(built);
      setMultiSelectedByDisplayIdx(new Array(built.length).fill(null));
    } else {
      const baseOptions = Array.isArray(task.options) ? task.options : [];
      const order = seededShuffle(
        Array.from({ length: baseOptions.length }, (_, i) => i),
        `${taskKey}:single:opts`
      );
      setSingleOptionOrder(order);
      setSingleSelectedDisplayIdx(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey, hasItems]);

  // ---------- Optional: rehydrate selection from answerDraft ----------
  React.useEffect(() => {
    if (!task || disabled) return;

    if (hasItems) {
      if (typeof answerDraft !== "string" || !answerDraft.trim()) return;
      let parsed = null;
      try {
        parsed = JSON.parse(answerDraft);
      } catch {
        return;
      }
      if (!parsed || parsed.kind !== "multi-mc" || !Array.isArray(parsed.answers)) return;

      const canonicalAnswers = parsed.answers;

      // Map canonical answers -> displayed indices
      const next = presentedItems.map((pItem) => {
        const canonicalOptIdx = canonicalAnswers[pItem.canonicalIndex];
        if (canonicalOptIdx == null) return null;
        const displayIdx = (pItem.optionOrder || []).findIndex((x) => x === canonicalOptIdx);
        return displayIdx >= 0 ? displayIdx : null;
      });

      if (next.length) setMultiSelectedByDisplayIdx(next);
    } else {
      if (typeof answerDraft !== "string" || !answerDraft.trim()) return;

      const baseOptions = Array.isArray(task.options) ? task.options : [];
      const canonicalIdx = baseOptions.findIndex((o) => String(o) === String(answerDraft));
      if (canonicalIdx < 0) return;

      const displayIdx = singleOptionOrder.findIndex((i) => i === canonicalIdx);
      if (displayIdx >= 0) setSingleSelectedDisplayIdx(displayIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey, hasItems, presentedItems.length, singleOptionOrder.length]);

  // ---------- Handlers ----------
  const handleSubmitClick = () => {
    if (disabled || isReview) return;
    if (!task) return;

    if (hasItems && presentedItems.length > 0) {
      const canonicalCount = task.items.length;
      const canonicalAnswers = new Array(canonicalCount).fill(null);

      presentedItems.forEach((pItem, displayIdx) => {
        const selectedDisplayIdx = multiSelectedByDisplayIdx[displayIdx];
        if (selectedDisplayIdx == null) return;

        const optionOrder = pItem.optionOrder || [];
        const canonicalOptionIdx = optionOrder[selectedDisplayIdx];
        if (canonicalOptionIdx == null) return;

        canonicalAnswers[pItem.canonicalIndex] = canonicalOptionIdx;
      });

      const payload = { kind: "multi-mc", answers: canonicalAnswers };
      const payloadString = JSON.stringify(payload);

      if (onAnswerChange) onAnswerChange(payloadString);
      onSubmit(payloadString);
      return;
    }

    // Single-question mode (legacy)
    const baseOptions = Array.isArray(task.options) ? task.options : [];
    if (!baseOptions.length) {
      if (onAnswerChange) onAnswerChange("");
      onSubmit("");
      return;
    }

    if (singleSelectedDisplayIdx == null) {
      if (onAnswerChange) onAnswerChange("");
      onSubmit("");
      return;
    }

    const canonicalIdx = singleOptionOrder[singleSelectedDisplayIdx];
    const value =
      canonicalIdx != null && baseOptions[canonicalIdx] != null
        ? String(baseOptions[canonicalIdx])
        : "";

    if (onAnswerChange) onAnswerChange(value);
    onSubmit(value);
  };

  const handleSingleSelect = (displayIdx) => {
    if (disabled || isReview) return;

    setSingleSelectedDisplayIdx(displayIdx);

    const baseOptions = Array.isArray(task.options) ? task.options : [];
    if (!baseOptions.length) return;

    const canonicalIdx = singleOptionOrder[displayIdx];
    const value =
      canonicalIdx != null && baseOptions[canonicalIdx] != null
        ? String(baseOptions[canonicalIdx])
        : "";

    if (onAnswerChange) onAnswerChange(value);
  };

  const handleMultiSelect = (displayIdx, optionDisplayIdx) => {
    if (disabled || isReview) return;

    setMultiSelectedByDisplayIdx((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[displayIdx] = optionDisplayIdx;
      return next;
    });

    // Optional: you can emit draft here, but it can get noisy. Submit handles it.
  };

  const { cardBg, cardHeaderBg, cardHeaderText, optionBaseBg, optionSelectedBg } =
    getThemeColors(theme);

  // ---------- Render (multi-question) ----------
  if (hasItems && presentedItems.length > 0) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div
          className="rounded-2xl shadow-md"
          style={{
            background: cardBg,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <header
            style={{
              background: cardHeaderBg,
              color: cardHeaderText,
              padding: "10px 14px",
              borderRadius: 14,
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>
              Multiple Choice – Answer all questions
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {task.title || "Quick Check"}
            </div>
          </header>

          <div className="flex-1 flex flex-col gap-3 overflow-y-auto" style={{ paddingRight: 4 }}>
            {presentedItems.map((pItem, displayIdx) => {
              const selectedDisplayOptIdx = multiSelectedByDisplayIdx[displayIdx];

              // Resolve canonical correct answer for this question
              const canonicalItem = Array.isArray(task.items) ? task.items[pItem.canonicalIndex] : null;
              const baseOptions = pItem.baseOptions || [];

              const correctCanonicalIdx =
                // Prefer review.correctAnswers (array by canonical index) if provided
                toCanonicalIndexFromAnyAnswer(
                  baseOptions,
                  Array.isArray(review?.correctAnswers)
                    ? review.correctAnswers[pItem.canonicalIndex]
                    : review?.correctAnswerByIndex?.[pItem.canonicalIndex] // optional future shape
                ) ??
                // Fall back to task.items[].correctAnswer
                toCanonicalIndexFromAnyAnswer(baseOptions, canonicalItem?.correctAnswer);

              const correctDisplayIdx =
                correctCanonicalIdx == null
                  ? null
                  : (pItem.optionOrder || []).findIndex((x) => x === correctCanonicalIdx);

              return (
                <div
                  key={pItem.canonicalIndex}
                  className="rounded-xl border"
                  style={{
                    padding: 10,
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.85)",
                  }}
                >
                  <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 8 }}>
                    <span style={{ display: "inline-block", minWidth: 20, fontWeight: 700, opacity: 0.7 }}>
                      {displayIdx + 1}.
                    </span>{" "}
                    {pItem.prompt}
                  </div>

                  <div className="flex flex-col gap-2">
                    {pItem.displayOptions.map((opt, optIdx) => {
                      const selected = selectedDisplayOptIdx === optIdx;

                      const isCorrect = isReview && correctDisplayIdx != null && optIdx === correctDisplayIdx;
                      const isWrongChoice = isReview && selected && correctDisplayIdx != null && optIdx !== correctDisplayIdx;

                      const paint = getReviewPaint({ selected, isCorrect, isWrongChoice });

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleMultiSelect(displayIdx, optIdx)}
                          disabled={disabled || isReview}
                          className="w-full text-left border rounded-lg px-3 py-2 text-sm"
                          style={{
                            background: paint.background,
                            color: paint.color,
                            opacity: disabled ? 0.6 : 1,
                            borderColor: paint.borderColor,
                            transition: "background 0.15s ease, transform 0.05s ease",
                            transform: selected ? "scale(1.01)" : "scale(1)",
                          }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={disabled || isReview}
            className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
            style={{
              background: disabled || isReview ? "#9ca3af" : "#0ea5e9",
              color: "#fff",
              fontWeight: 600,
              paddingInline: 20,
              cursor: disabled || isReview ? "default" : "pointer",
            }}
          >
            Submit all answers
          </button>
        </div>
      </div>
    );
  }

  // ---------- Render (single-question) ----------
  const baseOptions = Array.isArray(task?.options) ? task.options : [];
  const displayOptions =
    singleOptionOrder.length && baseOptions.length
      ? singleOptionOrder.map((canonicalIdx) => baseOptions[canonicalIdx])
      : baseOptions;

  // Resolve correct answer for single-question
  const correctCanonicalIdx =
    toCanonicalIndexFromAnyAnswer(baseOptions, review?.correctAnswer) ??
    toCanonicalIndexFromAnyAnswer(baseOptions, task?.correctAnswer);

  const correctDisplayIdx =
    correctCanonicalIdx == null
      ? null
      : singleOptionOrder.findIndex((i) => i === correctCanonicalIdx);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div
        className="rounded-2xl shadow-md"
        style={{
          background: cardBg,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <header
          style={{
            background: cardHeaderBg,
            color: cardHeaderText,
            padding: "10px 14px",
            borderRadius: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>Multiple Choice</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
            {task?.title || "Quick Check"}
          </div>
        </header>

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {typeof task?.prompt === "string" && task.prompt.trim()
              ? task.prompt.trim()
              : "Choose the best answer."}
          </div>

          <div className="flex-1 flex flex-col gap-2">
            {displayOptions.map((opt, displayIdx) => {
              const selected = singleSelectedDisplayIdx === displayIdx;

              const isCorrect = isReview && correctDisplayIdx != null && displayIdx === correctDisplayIdx;
              const isWrongChoice = isReview && selected && correctDisplayIdx != null && displayIdx !== correctDisplayIdx;

              const paint = getReviewPaint({ selected, isCorrect, isWrongChoice });

              return (
                <button
                  key={displayIdx}
                  type="button"
                  onClick={() => handleSingleSelect(displayIdx)}
                  disabled={disabled || isReview}
                  className="w-full text-left border rounded-lg px-3 py-2"
                  style={{
                    background: paint.background,
                    color: paint.color,
                    opacity: disabled ? 0.6 : 1,
                    borderColor: paint.borderColor,
                    transition: "background 0.15s ease, transform 0.05s ease",
                    transform: selected ? "scale(1.01)" : "scale(1)",
                  }}
                >
                  {opt}
                </button>
              );
            })}

            {displayOptions.length === 0 && (
              <p className="text-sm text-gray-500">
                (No options provided for this multiple-choice task.)
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={disabled || isReview}
          className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
          style={{
            background: disabled || isReview ? "#9ca3af" : "#0ea5e9",
            color: "#fff",
            fontWeight: 600,
            paddingInline: 20,
            cursor: disabled || isReview ? "default" : "pointer",
          }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function getThemeColors(theme) {
  switch (theme) {
    case "bold":
      return {
        cardBg: "linear-gradient(135deg, #0f172a, #1d4ed8)",
        cardHeaderBg: "rgba(15,23,42,0.9)",
        cardHeaderText: "#f9fafb",
        optionBaseBg: "rgba(15,23,42,0.7)",
        optionSelectedBg: "#f97316",
      };
    case "minimal":
      return {
        cardBg: "#f9fafb",
        cardHeaderBg: "#e5e7eb",
        cardHeaderText: "#111827",
        optionBaseBg: "#ffffff",
        optionSelectedBg: "#0ea5e9",
      };
    default: // "modern"
      return {
        cardBg: "linear-gradient(135deg, #eff6ff, #e0f2fe)",
        cardHeaderBg: "rgba(37,99,235,0.9)",
        cardHeaderText: "#f9fafb",
        optionBaseBg: "rgba(255,255,255,0.95)",
        optionSelectedBg: "#0ea5e9",
      };
  }
}
