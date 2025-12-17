// student-app/src/components/tasks/types/TrueFalseTask.jsx
import React from "react";

/**
 * True/False task (multi-question aware).
 * Deterministic randomization per task (+ team salt) to prevent flipping.
 */
export default function TrueFalseTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task?.items) && task.items.length > 0;

  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiSelectedValues, setMultiSelectedValues] = React.useState([]); // "true" | "false" | null

  const [singleSelected, setSingleSelected] = React.useState(null); // "true" | "false"
  const [singleFirstLabel, setSingleFirstLabel] = React.useState("True");
  const [singleSecondLabel, setSingleSecondLabel] = React.useState("False");

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
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;

    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17; seed >>>= 0;
      seed ^= seed << 5;  seed >>>= 0;
      return (seed >>> 0) / 4294967296;
    };

    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function seededBool(seedStr) {
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17; seed >>>= 0;
    seed ^= seed << 5;  seed >>>= 0;
    return (seed >>> 0) % 2 === 0;
  }

  const taskKey = React.useMemo(() => {
    const id = task?._id || task?.id || task?.taskId || "task";
    const teamSalt = getTeamSalt();
    return `${String(id)}:${teamSalt}`;
  }, [task?._id, task?.id, task?.taskId]);

  React.useEffect(() => {
    if (!task) return;

    if (hasItems) {
      const canonicalItems = Array.isArray(task.items) ? task.items : [];
      const count = canonicalItems.length;

      const order = seededShuffle(
        Array.from({ length: count }, (_, i) => i),
        `${taskKey}:tf:questions`
      );

      const built = order.map((canonicalIndex) => {
        const item = canonicalItems[canonicalIndex] || {};
        const flip = seededBool(`${taskKey}:tf:q${canonicalIndex}:flip`);

        const prompt =
          (typeof item.prompt === "string" && item.prompt.trim()
            ? item.prompt.trim()
            : typeof item.text === "string" && item.text.trim()
            ? item.text.trim()
            : typeof task.prompt === "string" && task.prompt.trim()
            ? task.prompt.trim()
            : `Question ${canonicalIndex + 1}`);

        return {
          canonicalIndex,
          prompt,
          firstLabel: flip ? "False" : "True",
          secondLabel: flip ? "True" : "False",
        };
      });

      setPresentedItems(built);
      setMultiSelectedValues(new Array(built.length).fill(null));
      setSingleSelected(null);
    } else {
      const flip = seededBool(`${taskKey}:tf:single:flip`);
      setSingleFirstLabel(flip ? "False" : "True");
      setSingleSecondLabel(flip ? "True" : "False");
      setSingleSelected(null);
    }
}, [task, taskKey, hasItems]);

  const handleSubmitClick = () => {
    if (disabled) return;
    if (!task) return;

    if (hasItems && presentedItems.length > 0) {
      const canonicalCount = task.items.length;
      const canonicalAnswers = new Array(canonicalCount).fill(null);

      presentedItems.forEach((pItem, displayIdx) => {
        const val = multiSelectedValues[displayIdx];
        if (!val) return;
        canonicalAnswers[pItem.canonicalIndex] = val;
      });

      const payload = { kind: "multi-true-false", answers: canonicalAnswers };
      const payloadString = JSON.stringify(payload);

      if (onAnswerChange) onAnswerChange(payloadString);
      onSubmit(payloadString);
    } else {
      const val = singleSelected || "";
      if (onAnswerChange) onAnswerChange(val);
      onSubmit(val);
    }
  };

  const handleSingleSelect = (label) => {
    if (disabled) return;
    const val = label.toLowerCase() === "true" ? "true" : "false";
    setSingleSelected(val);
    if (onAnswerChange) onAnswerChange(val);
  };

  const handleMultiSelect = (displayIdx, label) => {
    if (disabled) return;
    const val = label.toLowerCase() === "true" ? "true" : "false";
    setMultiSelectedValues((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[displayIdx] = val;
      return next;
    });
  };

  const { cardBg, cardHeaderBg, cardHeaderText, optionBaseBg, optionSelectedBg } =
    getThemeColors(theme);

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
            <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>True / False</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {task.title || "Quick Check"}
            </div>
          </header>

          <div className="flex-1 flex flex-col gap-3 overflow-y-auto" style={{ paddingRight: 4 }}>
            {presentedItems.map((pItem, displayIdx) => {
              const selected = multiSelectedValues[displayIdx];
              return (
                <div
                  key={pItem.canonicalIndex}
                  className="rounded-xl border"
                  style={{
                    padding: 10,
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.9)",
                  }}
                >
                  <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 8 }}>
                    <span style={{ display: "inline-block", minWidth: 20, fontWeight: 700, opacity: 0.7 }}>
                      {displayIdx + 1}.
                    </span>{" "}
                    {pItem.prompt}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleMultiSelect(displayIdx, pItem.firstLabel)}
                      disabled={disabled}
                      className="flex-1 border rounded-lg px-3 py-2"
                      style={{
                        background:
                          selected &&
                          selected === (pItem.firstLabel.toLowerCase() === "true" ? "true" : "false")
                            ? optionSelectedBg
                            : optionBaseBg,
                        color: selected ? "#fff" : "#111827",
                        opacity: disabled ? 0.6 : 1,
                        borderColor: "rgba(15,23,42,0.12)",
                      }}
                    >
                      {pItem.firstLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMultiSelect(displayIdx, pItem.secondLabel)}
                      disabled={disabled}
                      className="flex-1 border rounded-lg px-3 py-2"
                      style={{
                        background:
                          selected &&
                          selected === (pItem.secondLabel.toLowerCase() === "true" ? "true" : "false")
                            ? optionSelectedBg
                            : optionBaseBg,
                        color: selected ? "#fff" : "#111827",
                        opacity: disabled ? 0.6 : 1,
                        borderColor: "rgba(15,23,42,0.12)",
                      }}
                    >
                      {pItem.secondLabel}
                    </button>
                  </div>
                </div>
              );
            })}
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
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>True / False</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
            {task.title || "Quick Check"}
          </div>
        </header>

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {task.prompt}
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => handleSingleSelect(singleFirstLabel)}
              disabled={disabled}
              className="flex-1 border rounded-lg px-3 py-2"
              style={{
                background:
                  singleSelected === (singleFirstLabel.toLowerCase() === "true" ? "true" : "false")
                    ? optionSelectedBg
                    : optionBaseBg,
                color: singleSelected ? "#fff" : "#111827",
                opacity: disabled ? 0.6 : 1,
                borderColor: "rgba(15,23,42,0.12)",
              }}
            >
              {singleFirstLabel}
            </button>
            <button
              type="button"
              onClick={() => handleSingleSelect(singleSecondLabel)}
              disabled={disabled}
              className="flex-1 border rounded-lg px-3 py-2"
              style={{
                background:
                  singleSelected === (singleSecondLabel.toLowerCase() === "true" ? "true" : "false")
                    ? optionSelectedBg
                    : optionBaseBg,
                color: singleSelected ? "#fff" : "#111827",
                opacity: disabled ? 0.6 : 1,
                borderColor: "rgba(15,23,42,0.12)",
              }}
            >
              {singleSecondLabel}
            </button>
          </div>
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
    default:
      return {
        cardBg: "linear-gradient(135deg, #eff6ff, #e0f2fe)",
        cardHeaderBg: "rgba(37,99,235,0.9)",
        cardHeaderText: "#f9fafb",
        optionBaseBg: "rgba(255,255,255,0.95)",
        optionSelectedBg: "#0ea5e9",
      };
  }
}

