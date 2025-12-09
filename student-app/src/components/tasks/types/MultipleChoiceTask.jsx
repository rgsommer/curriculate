// student-app/src/components/tasks/types/MultipleChoiceTask.jsx
import React from "react";

/**
 * Multiple choice task (multi-question aware, per-team randomization).
 *
 * Modes:
 *  - Single question (legacy): uses task.prompt + task.options.
 *  - Multi-question: if task.items is an array of { prompt, options }.
 *
 * In multi-question mode:
 *  - Question order is shuffled per team.
 *  - Options within each question are shuffled per team.
 *  - Before submission, answers are mapped back to canonical order (B1).
 *  - Submission payload is a JSON string so backend can evolve scoring later.
 */
export default function MultipleChoiceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const theme = task?.uiTheme || "modern";

  const hasItems = Array.isArray(task.items) && task.items.length > 0;

  // For single-question mode
  const [singleOptionOrder, setSingleOptionOrder] = React.useState([]);
  const [singleSelectedDisplayIdx, setSingleSelectedDisplayIdx] = React.useState(null);

  // For multi-question mode
  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiSelectedByDisplayIdx, setMultiSelectedByDisplayIdx] = React.useState([]);

  // Rebuild shuffle state whenever the task changes
  React.useEffect(() => {
    if (!task) return;

    if (hasItems) {
      const canonicalItems = Array.isArray(task.items) ? task.items : [];
      const count = canonicalItems.length;
      const order = Array.from({ length: count }, (_, i) => i);
      shuffleArray(order);

      const built = order.map((canonicalIndex) => {
        const item = canonicalItems[canonicalIndex] || {};
        const baseOptions = Array.isArray(item.options) && item.options.length
          ? item.options
          : Array.isArray(task.options) && task.options.length
          ? task.options
          : [];

        const optionOrder = Array.from({ length: baseOptions.length }, (_, i) => i);
        shuffleArray(optionOrder);
        const displayOptions = optionOrder.map((i) => baseOptions[i]);

        return {
          canonicalIndex,
          prompt: item.prompt || task.prompt || `Question ${canonicalIndex + 1}`,
          baseOptions,
          optionOrder,
          displayOptions,
        };
      });

      setPresentedItems(built);
      setMultiSelectedByDisplayIdx(new Array(built.length).fill(null));
    } else {
      const baseOptions = Array.isArray(task.options) ? task.options.slice() : [];
      const order = Array.from({ length: baseOptions.length }, (_, i) => i);
      shuffleArray(order);
      setSingleOptionOrder(order);
      setSingleSelectedDisplayIdx(null);
    }
  }, [task, hasItems]);

  // Helper – Fisher-Yates shuffle (in-place)
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  const handleSubmitClick = () => {
    if (disabled) return;
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

      const payload = {
        kind: "multi-mc",
        answers: canonicalAnswers,
      };

      const payloadString = JSON.stringify(payload);
      if (onAnswerChange) {
        onAnswerChange(payloadString);
      }
      onSubmit(payloadString);
    } else {
      const baseOptions = Array.isArray(task.options) ? task.options : [];
      if (!baseOptions.length) {
        if (onAnswerChange) onAnswerChange("");
        onSubmit("");
        return;
      }

      if (singleSelectedDisplayIdx == null) {
        // No selection – treat as blank
        if (onAnswerChange) onAnswerChange("");
        onSubmit("");
        return;
      }

      const canonicalIdx = singleOptionOrder[singleSelectedDisplayIdx];
      const value =
        canonicalIdx != null && baseOptions[canonicalIdx] != null
          ? String(baseOptions[canonicalIdx])
          : "";

      if (onAnswerChange) {
        onAnswerChange(value);
      }
      onSubmit(value);
    }
  };

  const handleSingleSelect = (displayIdx) => {
    if (disabled) return;
    setSingleSelectedDisplayIdx(displayIdx);

    const baseOptions = Array.isArray(task.options) ? task.options : [];
    if (!baseOptions.length) return;

    const canonicalIdx = singleOptionOrder[displayIdx];
    const value =
      canonicalIdx != null && baseOptions[canonicalIdx] != null
        ? String(baseOptions[canonicalIdx])
        : "";

    if (onAnswerChange) {
      onAnswerChange(value);
    }
  };

  const handleMultiSelect = (displayIdx, optionDisplayIdx) => {
    if (disabled) return;

    setMultiSelectedByDisplayIdx((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[displayIdx] = optionDisplayIdx;
      return next;
    });
  };

  const { cardBg, cardHeaderBg, cardHeaderText, optionBaseBg, optionSelectedBg } =
    getThemeColors(theme);

  // -------------------------
  // Render multi-question mode
  // -------------------------
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

          <div
            className="flex-1 flex flex-col gap-3 overflow-y-auto"
            style={{ paddingRight: 4 }}
          >
            {presentedItems.map((pItem, displayIdx) => (
              <div
                key={pItem.canonicalIndex}
                className="rounded-xl border"
                style={{
                  padding: 10,
                  borderColor: "rgba(15,23,42,0.08)",
                  background: "rgba(255,255,255,0.85)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      minWidth: 20,
                      fontWeight: 700,
                      opacity: 0.7,
                    }}
                  >
                    {displayIdx + 1}.
                  </span>{" "}
                  {pItem.prompt}
                </div>

                <div className="flex flex-col gap-2">
                  {pItem.displayOptions.map((opt, optIdx) => {
                    const selected = multiSelectedByDisplayIdx[displayIdx] === optIdx;
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleMultiSelect(displayIdx, optIdx)}
                        disabled={disabled}
                        className="w-full text-left border rounded-lg px-3 py-2 text-sm"
                        style={{
                          background: selected ? optionSelectedBg : optionBaseBg,
                          color: selected ? "#ffffff" : "#111827",
                          opacity: disabled ? 0.6 : 1,
                          borderColor: "rgba(15,23,42,0.12)",
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
            ))}
          </div>

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={disabled}
            className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
            style={{
              background: disabled ? "#9ca3af" : "#0ea5e9",
              color: "#fff",
              fontWeight: 600,
              paddingInline: 20,
            }}
          >
            Submit all answers
          </button>
        </div>
      </div>
    );
  }

  // -------------------------
  // Legacy single-question mode (still randomized options)
  // -------------------------
  const baseOptions = Array.isArray(task.options) ? task.options : [];

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
            {task.title || "Quick Check"}
          </div>
        </header>

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {task.prompt}
          </div>

          <div className="flex-1 flex flex-col gap-2">
            {baseOptions.map((opt, canonicalIdx) => {
              const displayIdx = singleOptionOrder.indexOf(canonicalIdx);
              const selected = singleSelectedDisplayIdx === displayIdx;

              return (
                <button
                  key={canonicalIdx}
                  type="button"
                  onClick={() => handleSingleSelect(displayIdx)}
                  disabled={disabled}
                  className="w-full text-left border rounded-lg px-3 py-2"
                  style={{
                    background: selected ? optionSelectedBg : optionBaseBg,
                    color: selected ? "#ffffff" : "#111827",
                    opacity: disabled ? 0.6 : 1,
                    borderColor: "rgba(15,23,42,0.12)",
                    transition: "background 0.15s ease, transform 0.05s ease",
                    transform: selected ? "scale(1.01)" : "scale(1)",
                  }}
                >
                  {opt}
                </button>
              );
            })}

            {baseOptions.length === 0 && (
              <p className="text-sm text-gray-500">
                (No options provided for this multiple-choice task.)
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={disabled}
          className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            cursor: disabled ? "default" : "pointer",
            background:
              showCorrect
                ? option === task.correctAnswer
                  ? "#4ade80"   // GREEN for correct
                  : answer === option
                  ? "#f87171"   // RED for wrong selection
                  : "#ffffff"
                : answer === option
                ? "#bfdbfe"     // normal selection blue
                : "#ffffff",
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
