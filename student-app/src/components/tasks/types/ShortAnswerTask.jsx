// student-app/src/components/tasks/types/ShortAnswerTask.jsx
import React from "react";

/**
 * Short answer task (multi-question aware, per-team randomization).
 *
 * Modes:
 *  - Single question: one textarea.
 *  - Multi-question: task.items as an array of { prompt }.
 *
 * We randomize item order per team and submit canonical-ordered answers
 * as a JSON string payload.
 */
export default function ShortAnswerTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task.items) && task.items.length > 0;

  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiAnswersByDisplayIdx, setMultiAnswersByDisplayIdx] = React.useState([]);

  const [singleAnswer, setSingleAnswer] = React.useState("");

  React.useEffect(() => {
    if (!task) return;

    if (hasItems) {
      const canonicalItems = Array.isArray(task.items) ? task.items : [];
      const count = canonicalItems.length;
      const order = Array.from({ length: count }, (_, i) => i);
      shuffleArray(order);

      const built = order.map((canonicalIndex) => {
        const item = canonicalItems[canonicalIndex] || {};
        return {
          canonicalIndex,
          prompt: item.prompt || task.prompt || `Question ${canonicalIndex + 1}`,
        };
      });

      setPresentedItems(built);
      setMultiAnswersByDisplayIdx(new Array(built.length).fill(""));
      setSingleAnswer("");
    } else {
      const initial =
        typeof answerDraft === "string" && answerDraft.length ? answerDraft : "";
      setSingleAnswer(initial);
      setPresentedItems([]);
      setMultiAnswersByDisplayIdx([]);
    }
  }, [task, hasItems, answerDraft]);

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
      const canonicalAnswers = new Array(canonicalCount).fill("");

      presentedItems.forEach((pItem, displayIdx) => {
        const val = multiAnswersByDisplayIdx[displayIdx] || "";
        canonicalAnswers[pItem.canonicalIndex] = val;
      });

      const payload = {
        kind: "multi-short-answer",
        answers: canonicalAnswers,
      };

      const payloadString = JSON.stringify(payload);
      if (onAnswerChange) onAnswerChange(payloadString);
      onSubmit(payloadString);
    } else {
      if (onAnswerChange) onAnswerChange(singleAnswer);
      onSubmit(singleAnswer);
    }
  };

  const handleSingleChange = (e) => {
    const value = e.target.value;
    setSingleAnswer(value);
    if (onAnswerChange) onAnswerChange(value);
  };

  const handleMultiChange = (displayIdx, e) => {
    const value = e.target.value;
    setMultiAnswersByDisplayIdx((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[displayIdx] = value;
      return next;
    });
  };

  const { cardBg, cardHeaderBg, cardHeaderText } = getThemeColors(theme);

  // Multi-question mode
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
            <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>Short Answer</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {task.title || "Explain your thinking"}
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
                  background: "rgba(255,255,255,0.9)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    marginBottom: 6,
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

                <textarea
                  className="border rounded-lg p-2 w-full text-sm resize-none"
                  rows={3}
                  value={multiAnswersByDisplayIdx[displayIdx] || ""}
                  onChange={(e) => handleMultiChange(displayIdx, e)}
                  disabled={disabled}
                  placeholder="Type your answer here…"
                  style={{ borderColor: "rgba(148,163,184,0.8)" }}
                />
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

  // Single-question mode
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
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>Short Answer</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
            {task.title || "Explain your thinking"}
          </div>
        </header>

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {task.prompt}
          </div>

          <textarea
            className="border rounded-lg p-2 flex-1 resize-none text-sm"
            value={singleAnswer}
            onChange={handleSingleChange}
            disabled={disabled}
            placeholder="Type your answer here…"
            style={{ borderColor: "rgba(148,163,184,0.8)" }}
          />
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
      };
    case "minimal":
      return {
        cardBg: "#f9fafb",
        cardHeaderBg: "#e5e7eb",
        cardHeaderText: "#111827",
      };
    default:
      return {
        cardBg: "linear-gradient(135deg, #eff6ff, #e0f2fe)",
        cardHeaderBg: "rgba(37,99,235,0.9)",
        cardHeaderText: "#f9fafb",
      };
  }
}
