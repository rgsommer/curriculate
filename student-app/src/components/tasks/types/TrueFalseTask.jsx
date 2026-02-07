// student-app/src/components/tasks/types/TrueFalseTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

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

  const instructions =
    "How to play: Read the statement. Decide if it is TRUE or FALSE. " +
    "Tap your answer. Then press Submit.";

  function safeText(val, fallback = "") {
    if (val == null) return fallback;
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    // common backend shapes
    if (typeof val === "object") {
      if (typeof val.text === "string") return val.text;
      if (typeof val.prompt === "string") return val.prompt;
      if (typeof val.title === "string") return val.title;
      if (typeof val.value === "string") return val.value;
    }
    return fallback;
  }

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
    for (let i = 0; i < seedStr.length; i++)
      seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;

    const rand = () => {
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

  function seededBool(seedStr) {
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++)
      seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed >>>= 0;
    seed ^= seed << 5;
    seed >>>= 0;
    return (seed >>> 0) % 2 === 0;
  }

  const taskKey = React.useMemo(() => {
    const id = task?._id || task?.id || task?.taskId || "task";
    const teamSalt = getTeamSalt();
    return `${String(id)}:${teamSalt}`;
  }, [task?._id, task?.id, task?.taskId]);


  // Prevent draft-change reruns from wiping answers (common when parent echoes payload back)
  const initKeyRef = useRef(null);

  function parseDraft(draftStr) {
    if (!draftStr || typeof draftStr !== "string") return null;
    try {
      const obj = JSON.parse(draftStr);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  React.useEffect(() => {
    if (!task) return;

    const isNewTask = initKeyRef.current !== taskKey;
    if (isNewTask) initKeyRef.current = taskKey;

    const draftObj = parseDraft(answerDraft);

    // Single T/F
    if (!hasItems) {
      if (!isNewTask) return;

      // Deterministic flip so "True" isn't always on the same side.
      const flipSingle = seededBool(`${taskKey}:tf:flip:single`);
      setSingleFirstLabel(flipSingle ? "False" : "True");
      setSingleSecondLabel(flipSingle ? "True" : "False");

      // Deterministic label flip (prevents students from always tapping the same side).
      const flip = seededBool(`${taskKey}:tf:single:flip`);
      setSingleFirstLabel(flip ? "False" : "True");
      setSingleSecondLabel(flip ? "True" : "False");

      const draftVal =
        (typeof answerDraft === "string" && (answerDraft.toLowerCase() === "true" || answerDraft.toLowerCase() === "false"))
          ? answerDraft.toLowerCase()
          : draftObj?.answer && (String(draftObj.answer).toLowerCase() === "true" || String(draftObj.answer).toLowerCase() === "false")
            ? String(draftObj.answer).toLowerCase()
            : null;

      if (draftVal) setSingleSelected(draftVal);
      else setSingleSelected(null);

      setPresentedItems([]);
      setMultiSelectedValues([]);
      return;
    }

    // Multi-item T/F
    if (!isNewTask) return;

    const canonicalItems = Array.isArray(task.items) ? task.items : [];
    const count = canonicalItems.length;

    const order = seededShuffle(
      Array.from({ length: count }, (_, i) => i),
      `${taskKey}:tf:questions`
    );

    // deterministic flip per question
    const built = order.map((canonicalIndex) => {
      const item = canonicalItems[canonicalIndex] || {};
      const flip = seededBool(`${taskKey}:tf:flip:${canonicalIndex}`);
      const prompt =
        safeText(item.prompt, "").trim() ||
        safeText(item.text, "").trim() ||
        safeText(task.prompt, "").trim() ||
        `Question ${canonicalIndex + 1}`;

      return {
        canonicalIndex,
        prompt,
        firstLabel: flip ? "False" : "True",
        secondLabel: flip ? "True" : "False",
        flip,
      };
    });

    setPresentedItems(built);

    // Restore canonical answers from draft if present
    const canonicalAnswers =
      Array.isArray(draftObj?.answers) ? draftObj.answers : Array.isArray(draftObj?.answer) ? draftObj.answer : null;

    const restoredDisplay = new Array(built.length).fill(null);
    if (canonicalAnswers && canonicalAnswers.length) {
      built.forEach((pItem, displayIdx) => {
        const v = canonicalAnswers[pItem.canonicalIndex];
        if (!v) return;
        const vv = String(v).toLowerCase();
        if (vv === "true" || vv === "false") restoredDisplay[displayIdx] = vv;
      });
    }

    setMultiSelectedValues(restoredDisplay);
  }, [task, taskKey, hasItems, answerDraft]);

  const multiAllAnswered = hasItems
    ? presentedItems.length > 0 &&
      Array.isArray(multiSelectedValues) &&
      multiSelectedValues.length === presentedItems.length &&
      multiSelectedValues.every((v) => v === "true" || v === "false")
    : false;

  const singleCanSubmit = !hasItems && !!singleSelected && !disabled;

  const handleSubmitClick = () => {
    if (disabled) return;
    if (!task) return;

    if (hasItems && presentedItems.length > 0) {
      const allAnswered =
        Array.isArray(multiSelectedValues) &&
        multiSelectedValues.length === presentedItems.length &&
        multiSelectedValues.every((v) => v === "true" || v === "false");
      if (!allAnswered) return;

      const canonicalCount = Array.isArray(task.items) ? task.items.length : 0;
      const canonicalAnswers = new Array(canonicalCount).fill(null);

      presentedItems.forEach((pItem, displayIdx) => {
        const val = multiSelectedValues[displayIdx];
        if (!val) return;
        canonicalAnswers[pItem.canonicalIndex] = val;
      });

      const payload = { kind: "multi-true-false", kind2: "true-false", answers: canonicalAnswers };
      const payloadString = JSON.stringify(payload);

      if (onAnswerChange) onAnswerChange(payloadString);
      onSubmit(payloadString);
    } else {
      if (!singleSelected) return;
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

  const safeTitle = safeText(task?.title, "").trim() || "Quick Check";
  const safePrompt =
    safeText(task?.prompt, "").trim() || safeText(task?.text, "").trim() || "";

  if (hasItems && presentedItems.length > 0) {
    const answeredCount = Array.isArray(multiSelectedValues)
      ? multiSelectedValues.filter((v) => v === "true" || v === "false").length
      : 0;
    const totalCount = presentedItems.length;
    const allAnswered = totalCount > 0 && answeredCount === totalCount;

    return (
      <div className="flex flex-col h-full p-3 gap-3" style={{ paddingTop: 18 }}>
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
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{safeTitle}</div>
          </header>

          <div className="text-sm" style={{ color: "rgba(15,23,42,0.78)", fontWeight: 700, marginBottom: 10 }}>
            {instructions} <span style={{ marginLeft: 8, opacity: 0.85 }}>({answeredCount}/{totalCount} answered)</span>
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-y-auto" style={{ paddingRight: 4 }}>
            {presentedItems.map((pItem, displayIdx) => {
              const selected = multiSelectedValues[displayIdx];
              const firstVal = pItem.firstLabel.toLowerCase() === "true" ? "true" : "false";
              const secondVal = pItem.secondLabel.toLowerCase() === "true" ? "true" : "false";
              const isFirstSelected = selected === firstVal;
              const isSecondSelected = selected === secondVal;

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

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleMultiSelect(displayIdx, pItem.firstLabel)}
                      disabled={disabled}
                      className="flex-1 border rounded-lg px-3 py-2"
                      style={{
                        background: isFirstSelected ? optionSelectedBg : optionBaseBg,
                        color: isFirstSelected ? "#fff" : "#111827",
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
                        background: isSecondSelected ? optionSelectedBg : optionBaseBg,
                        color: isSecondSelected ? "#fff" : "#111827",
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
            disabled={disabled || !allAnswered}
            className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
            style={{
              background: disabled ? "#9ca3af" : "#0ea5e9",
              color: "#fff",
              fontWeight: 600,
              paddingInline: 20,
            }}
          >
            {allAnswered ? "Submit all answers" : "Answer all, then submit"}
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
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{safeTitle}</div>
        </header>

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {safePrompt || " "}
          </div>

          <div className="text-sm" style={{ color: "rgba(15,23,42,0.78)", fontWeight: 700 }}>
            {instructions}
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
          disabled={!singleCanSubmit}
          className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
          style={{
            background: singleCanSubmit ? "#0ea5e9" : "#9ca3af",
            color: "#fff",
            fontWeight: 600,
            paddingInline: 20,
          }}
        >
          {singleCanSubmit ? "Submit" : "Pick True or False"}
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
