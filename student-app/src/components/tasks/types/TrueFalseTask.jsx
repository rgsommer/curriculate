// student-app/src/components/tasks/types/TrueFalseTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import DesignatedWriter from "../DesignatedWriter";
import { PrimaryButton } from "../taskStyles";

// Inline animation styles
const animationStyles = `
  @keyframes slideInDown {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0) rotate(0deg); }
    10% { transform: translateX(-5px) rotate(-1deg); }
    20% { transform: translateX(5px) rotate(1deg); }
    30% { transform: translateX(-5px) rotate(-1deg); }
    40% { transform: translateX(5px) rotate(1deg); }
    50% { transform: translateX(-5px) rotate(-1deg); }
    60% { transform: translateX(5px) rotate(1deg); }
    70% { transform: translateX(-5px) rotate(-1deg); }
    80% { transform: translateX(5px) rotate(1deg); }
    90% { transform: translateX(-5px) rotate(-1deg); }
  }

  @keyframes correctGlow {
    0% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
    }
    70% {
      box-shadow: 0 0 0 15px rgba(34, 197, 94, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
    }
  }

  @keyframes incorrectRed {
    0%, 100% { background-color: #fecaca; }
    50% { background-color: #fca5a5; }
  }

  @keyframes confetti {
    0% {
      opacity: 1;
      transform: translate(0, 0) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate(var(--tx), var(--ty)) rotate(360deg);
    }
  }

  @keyframes scorePopup {
    0% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-50px) scale(1.5);
    }
  }

  @keyframes progressFill {
    from { width: 0; }
    to { width: 100%; }
  }
`;

// Inject animation styles into document
if (typeof document !== "undefined") {
  const styleId = "tf-task-animations";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = animationStyles;
    document.head.appendChild(style);
  }
}

/**
 * True/False task (multi-question aware).
 * Deterministic randomization per task (+ team salt) to prevent flipping.
 */
export default function TrueFalseTask({
  task: taskProp,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  memberNames = [],
}) {
  // Accept statements[] (and config variants) as a synonym for items[]. Some
  // generated/stored true-false tasks keep the questions under "statements",
  // which previously rendered as "no questions to do". (Tester: michael, 2026.)
  const task = React.useMemo(() => {
    if (!taskProp || typeof taskProp !== "object") return taskProp;
    if (Array.isArray(taskProp.items) && taskProp.items.length) return taskProp;
    const alt =
      (Array.isArray(taskProp.statements) && taskProp.statements) ||
      (Array.isArray(taskProp.questions) && taskProp.questions) ||
      (Array.isArray(taskProp.config?.items) && taskProp.config.items) ||
      (Array.isArray(taskProp.config?.statements) && taskProp.config.statements) ||
      null;
    return alt ? { ...taskProp, items: alt } : taskProp;
  }, [taskProp]);
  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task?.items) && task.items.length > 0;

  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiSelectedValues, setMultiSelectedValues] = React.useState([]); // "true" | "false" | null

  const [singleSelected, setSingleSelected] = React.useState(null); // "true" | "false"
  const [singleFirstLabel, setSingleFirstLabel] = React.useState("True");
  const [singleSecondLabel, setSingleSecondLabel] = React.useState("False");

  // Gaming experience state
  const [score, setScore] = React.useState(0);
  const [streak, setStreak] = React.useState(0);
  const [feedbackState, setFeedbackState] = React.useState(null); // { type: "correct"|"incorrect", itemIdx?: number }
  const [showCelebration, setShowCelebration] = React.useState(false);
  const [scorePopups, setScorePopups] = React.useState([]);
  const [confettiPieces, setConfettiPieces] = React.useState([]);

  // Answer-reveal overlay (tester: "no answer overlay"). After submitting we
  // reveal which statements were true/false BEFORE advancing; onSubmit is
  // deferred until the player taps Continue.
  const [revealed, setRevealed] = React.useState(false);
  const pendingPayloadRef = useRef(null);

  // Correct value ("true"/"false") for a canonical item index, or null if the
  // task didn't ship an answer key (then we can't grade and skip the overlay).
  const correctValForCanonical = React.useCallback(
    (canonicalIndex) => {
      const it = (Array.isArray(task?.items) ? task.items : [])[canonicalIndex];
      const raw =
        it?.correct ?? it?.answer ?? it?.isTrue ?? it?.correctAnswer ?? null;
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "boolean") return raw ? "true" : "false";
      const s = String(raw).trim().toLowerCase();
      if (s === "true" || s === "t" || s === "1" || s === "yes") return "true";
      if (s === "false" || s === "f" || s === "0" || s === "no") return "false";
      return null;
    },
    [task]
  );
  const singleCorrectVal = React.useMemo(() => {
    const raw =
      task?.correctAnswer ?? task?.correct ?? task?.answer ?? task?.isTrue ?? null;
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "boolean") return raw ? "true" : "false";
    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes") return "true";
    if (s === "false" || s === "f" || s === "0" || s === "no") return "false";
    return null;
  }, [task]);

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

      // Random flip on every play/render (tester: "randomize answer placement on
      // every play, so on render") — True isn't pinned to one side.
      const flip = Math.random() < 0.5;
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

    // Fresh random question order + True/False side per play/render (tester:
    // "randomize answer placement on every play").
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const built = order.map((canonicalIndex) => {
      const item = canonicalItems[canonicalIndex] || {};
      const flip = Math.random() < 0.5;
      const prompt =
        safeText(item.statement, "").trim() ||
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

  // Whether we have an answer key to reveal (so the overlay is meaningful).
  const canRevealAnswers = hasItems
    ? presentedItems.some((p) => correctValForCanonical(p.canonicalIndex) != null)
    : singleCorrectVal != null;

  const fireSubmit = () => {
    if (pendingPayloadRef.current == null) return;
    const { payloadString, onChangeVal } = pendingPayloadRef.current;
    pendingPayloadRef.current = null;
    if (onAnswerChange) onAnswerChange(onChangeVal ?? payloadString);
    onSubmit(payloadString);
  };

  const handleSubmitClick = () => {
    if (disabled) return;
    if (!task) return;

    triggerCelebration();

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

      pendingPayloadRef.current = { payloadString, onChangeVal: payloadString };
      if (canRevealAnswers) {
        setRevealed(true); // reveal correctness; Continue fires onSubmit
      } else {
        fireSubmit();
      }
    } else {
      if (!singleSelected) return;
      const val = singleSelected || "";
      pendingPayloadRef.current = { payloadString: val, onChangeVal: val };
      if (canRevealAnswers) {
        setRevealed(true);
      } else {
        fireSubmit();
      }
    }
  };

  // Play sound effect
  const playSound = React.useCallback((soundType) => {
    try {
      const soundPath = soundType === "correct" ? "/sounds/yay.mp3" : "/sounds/buzz.mp3";
      const audio = new Audio(soundPath);
      audio.volume = 0.5;
      audio.play().catch(() => {
        // Sound playback failed silently
      });
    } catch (e) {
      // Audio not available
    }
  }, []);

  // Trigger celebration effect
  const triggerCelebration = React.useCallback(() => {
    setShowCelebration(true);
    playSound("correct");

    // Create confetti pieces
    const pieces = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      duration: 2 + Math.random() * 0.5,
      tx: (Math.random() - 0.5) * 200,
      ty: -200 - Math.random() * 100,
    }));
    setConfettiPieces(pieces);

    setTimeout(() => setShowCelebration(false), 3000);
  }, [playSound]);

  // Show feedback with animation
  const showFeedback = React.useCallback((isCorrect, itemIdx) => {
    setFeedbackState({ type: isCorrect ? "correct" : "incorrect", itemIdx });

    if (isCorrect) {
      playSound("correct");
      setScore((s) => s + 10);
      setStreak((s) => s + 1);

      // Add score popup
      const popupId = Date.now();
      setScorePopups((prev) => [...prev, { id: popupId, text: "+10 🎉" }]);
      setTimeout(() => {
        setScorePopups((prev) => prev.filter((p) => p.id !== popupId));
      }, 1500);
    } else {
      playSound("incorrect");
      setStreak(0);
    }

    setTimeout(() => setFeedbackState(null), 1500);
  }, [playSound]);

  const handleSingleSelect = (label) => {
    if (disabled || revealed) return;
    const val = label.toLowerCase() === "true" ? "true" : "false";
    setSingleSelected(val);
    if (onAnswerChange) onAnswerChange(val);
  };

  const handleMultiSelect = (displayIdx, label) => {
    if (disabled || revealed) return;
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

  // If the task has items, NEVER fall through to the single-T/F render —
  // that path shows only `safePrompt` ("Test your knowledge!") with two
  // big True/False buttons and no statement to evaluate.  Tester
  // (Amelia): "What are we trueing or falseing".  Even if
  // presentedItems hasn't been built yet (initial render before
  // useEffect runs), stay in this branch and show a brief loading
  // placeholder so the user never sees naked T/F buttons.
  if (hasItems && presentedItems.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "200px",
          padding: 16,
          color: "#475569",
          fontWeight: 600,
        }}
      >
        Loading {(task?.items || []).length} statement{(task?.items || []).length === 1 ? "" : "s"}…
      </div>
    );
  }

  if (hasItems && presentedItems.length > 0) {
    const answeredCount = Array.isArray(multiSelectedValues)
      ? multiSelectedValues.filter((v) => v === "true" || v === "false").length
      : 0;
    const totalCount = presentedItems.length;
    const allAnswered = totalCount > 0 && answeredCount === totalCount;
    const progressPercent = (answeredCount / totalCount) * 100;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "16px",
          gap: "12px",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #f0f9ff 0%, #f0fdff 100%)",
        }}
      >
        <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} taskIndex={task?._taskIndex} role="answerer" />
        {/* Celebration overlay */}
        {showCelebration && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: "none",
              zIndex: 999,
            }}
          >
            {confettiPieces.map((piece) => (
              <div
                key={piece.id}
                style={{
                  position: "absolute",
                  width: "8px",
                  height: "8px",
                  background: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"][
                    Math.floor(Math.random() * 5)
                  ],
                  borderRadius: "50%",
                  left: piece.left + "%",
                  top: "-10px",
                  "--tx": piece.tx + "px",
                  "--ty": piece.ty + "px",
                  animation: `confetti ${piece.duration}s ease-in forwards`,
                  animationDelay: piece.delay + "s",
                }}
              />
            ))}
          </div>
        )}

        {/* Header with score and streak */}
        <div
          style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)",
            borderRadius: "20px",
            padding: "16px",
            color: "#fff",
            animation: "slideInDown 0.5s ease-out",
            boxShadow: "0 8px 16px rgba(59, 130, 246, 0.2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <div style={{ fontSize: "0.75rem", opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                ✨ True / False Challenge
              </div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, marginTop: "4px" }}>{safeTitle}</div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  background: "rgba(255,255,255,0.2)",
                  padding: "8px 12px",
                  borderRadius: "12px",
                  backdropFilter: "blur(10px)",
                }}
              >
                <div style={{ fontSize: "0.7rem", opacity: 0.9 }}>SCORE</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{score}</div>
              </div>
              {streak > 0 && (
                <div
                  style={{
                    textAlign: "center",
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    padding: "8px 12px",
                    borderRadius: "12px",
                    animation: "pulse 1s infinite",
                  }}
                >
                  <div style={{ fontSize: "0.7rem", opacity: 0.9 }}>🔥 STREAK</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{streak}</div>
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: "8px", height: "8px", overflow: "hidden" }}>
            <div
              style={{
                background: "linear-gradient(90deg, #34d399, #10b981)",
                height: "100%",
                width: progressPercent + "%",
                animation: "progressFill 0.6s ease-out",
                borderRadius: "8px",
              }}
            />
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              marginTop: "6px",
              opacity: 0.9,
              fontWeight: 600,
            }}
          >
            {answeredCount} of {totalCount} answered
          </div>
        </div>

        {/* Questions container */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            paddingRight: "4px",
          }}
        >
          {presentedItems.map((pItem, displayIdx) => {
            const selected = multiSelectedValues[displayIdx];
            const firstVal = pItem.firstLabel.toLowerCase() === "true" ? "true" : "false";
            const secondVal = pItem.secondLabel.toLowerCase() === "true" ? "true" : "false";
            const isFirstSelected = selected === firstVal;
            const isSecondSelected = selected === secondVal;
            const isAnswered = selected !== null && selected !== undefined;

            // Answer reveal (after submit)
            const correctVal = revealed ? correctValForCanonical(pItem.canonicalIndex) : null;
            const gotIt = revealed && correctVal != null && selected === correctVal;
            const missedIt = revealed && correctVal != null && selected !== correctVal;
            const revealBorder = gotIt ? "#16a34a" : missedIt ? "#dc2626" : "#3b82f6";

            return (
              <div
                key={pItem.canonicalIndex}
                style={{
                  background: "#fff",
                  borderRadius: "16px",
                  padding: "14px",
                  boxShadow: isAnswered ? "0 4px 12px rgba(59, 130, 246, 0.15)" : "0 2px 8px rgba(0,0,0,0.08)",
                  border: "2px solid " + (revealed ? revealBorder : isAnswered ? "#3b82f6" : "#e5e7eb"),
                  animation: `slideInDown 0.5s ease-out ${displayIdx * 0.1}s backwards`,
                  transition: "all 0.3s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginBottom: "12px",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      background: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
                      color: "#fff",
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      flexShrink: 0,
                    }}
                  >
                    {displayIdx + 1}
                  </div>
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "#1f2937",
                      flex: 1,
                      lineHeight: 1.4,
                    }}
                  >
                    {pItem.prompt}
                  </div>
                  {isAnswered && (
                    <div
                      style={{
                        fontSize: "1.2rem",
                        animation: "bounce 0.5s ease",
                      }}
                    >
                      ✓
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => handleMultiSelect(displayIdx, pItem.firstLabel)}
                    disabled={disabled}
                    style={{
                      flex: 1,
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      cursor: disabled ? "not-allowed" : "pointer",
                      transition: "all 0.3s ease",
                      background: isFirstSelected
                        ? firstVal === "true"
                          ? "linear-gradient(135deg, #3b82f6, #0ea5e9)"
                          : "linear-gradient(135deg, #ef4444, #dc2626)"
                        : "#f3f4f6",
                      color: isFirstSelected ? "#fff" : "#374151",
                      boxShadow: isFirstSelected ? "0 4px 12px rgba(59, 130, 246, 0.3)" : "none",
                      transform: isFirstSelected ? "scale(1.02)" : "scale(1)",
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    {firstVal === "true" ? "✅ " : "❌ "}
                    {pItem.firstLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMultiSelect(displayIdx, pItem.secondLabel)}
                    disabled={disabled}
                    style={{
                      flex: 1,
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      cursor: disabled ? "not-allowed" : "pointer",
                      transition: "all 0.3s ease",
                      background: isSecondSelected
                        ? secondVal === "true"
                          ? "linear-gradient(135deg, #3b82f6, #0ea5e9)"
                          : "linear-gradient(135deg, #ef4444, #dc2626)"
                        : "#f3f4f6",
                      color: isSecondSelected ? "#fff" : "#374151",
                      boxShadow: isSecondSelected ? "0 4px 12px rgba(59, 130, 246, 0.3)" : "none",
                      transform: isSecondSelected ? "scale(1.02)" : "scale(1)",
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    {secondVal === "true" ? "✅ " : "❌ "}
                    {pItem.secondLabel}
                  </button>
                </div>

                {/* Answer reveal line */}
                {revealed && correctVal != null && (
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: "0.9rem",
                      fontWeight: 700,
                      color: gotIt ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {gotIt
                      ? "✓ Correct!"
                      : `✗ The answer is ${correctVal === "true" ? "TRUE" : "FALSE"}.`}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit / Continue button — post-reveal uses the shared
            PrimaryButton (canonical indigo→sky), pre-submit keeps its
            semantic green/gray "ready vs not ready" state-coloring. */}
        {revealed ? (
          <PrimaryButton onClick={fireSubmit}>
            {(() => {
              const correctCount = presentedItems.reduce((n, p, i) => {
                const cv = correctValForCanonical(p.canonicalIndex);
                return n + (cv != null && multiSelectedValues[i] === cv ? 1 : 0);
              }, 0);
              const gradable = presentedItems.filter(
                (p) => correctValForCanonical(p.canonicalIndex) != null
              ).length;
              return `Continue ▶  (${correctCount}/${gradable} correct)`;
            })()}
          </PrimaryButton>
        ) : (
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={disabled || !allAnswered}
            style={{
              padding: "16px 24px",
              borderRadius: "16px",
              border: "none",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: allAnswered && !disabled ? "pointer" : "not-allowed",
              background: allAnswered && !disabled ? "linear-gradient(135deg, #10b981, #059669)" : "#9ca3af",
              color: "#fff",
              boxShadow: allAnswered && !disabled ? "0 8px 16px rgba(16, 185, 129, 0.3)" : "none",
              transition: "all 0.3s ease",
              transform: allAnswered && !disabled ? "scale(1)" : "scale(0.98)",
              opacity: disabled ? 0.6 : 1,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {allAnswered ? "🎉 Submit All Answers!" : "📝 Answer All Questions"}
          </button>
        )}

        {/* Score popups */}
        {scorePopups.map((popup) => (
          <div
            key={popup.id}
            style={{
              position: "fixed",
              bottom: "50px",
              right: "20px",
              fontSize: "1.2rem",
              fontWeight: 700,
              color: "#10b981",
              animation: "scorePopup 1.5s ease-out forwards",
              pointerEvents: "none",
            }}
          >
            {popup.text}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        gap: "16px",
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, #f0f9ff 0%, #f0fdff 100%)",
      }}
    >
      <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} taskIndex={task?._taskIndex} role="answerer" />
      {/* Celebration overlay */}
      {showCelebration && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 999,
          }}
        >
          {confettiPieces.map((piece) => (
            <div
              key={piece.id}
              style={{
                position: "absolute",
                width: "10px",
                height: "10px",
                background: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"][
                  Math.floor(Math.random() * 5)
                ],
                borderRadius: "50%",
                left: piece.left + "%",
                top: "-10px",
                "--tx": piece.tx + "px",
                "--ty": piece.ty + "px",
                animation: `confetti ${piece.duration}s ease-in forwards`,
                animationDelay: piece.delay + "s",
              }}
            />
          ))}
        </div>
      )}

      {/* Header with score */}
      <div
        style={{
          background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)",
          borderRadius: "20px",
          padding: "20px",
          color: "#fff",
          animation: "slideInDown 0.5s ease-out",
          boxShadow: "0 8px 16px rgba(59, 130, 246, 0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              ✨ True / False
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "4px" }}>{safeTitle}</div>
          </div>
          <div
            style={{
              textAlign: "center",
              background: "rgba(255,255,255,0.2)",
              padding: "10px 14px",
              borderRadius: "12px",
              backdropFilter: "blur(10px)",
            }}
          >
            <div style={{ fontSize: "0.7rem", opacity: 0.9 }}>SCORE</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>{score}</div>
          </div>
        </div>

        {streak > 0 && (
          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "8px 12px",
              borderRadius: "10px",
              fontSize: "0.9rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              animation: "pulse 1s infinite",
            }}
          >
            🔥 {streak} streak!
          </div>
        )}
      </div>

      {/* Statement card */}
      <div
        style={{
          background: "#fff",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 8px 24px rgba(59, 130, 246, 0.15)",
          border: "2px solid #e5e7eb",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          animation: "fadeIn 0.6s ease-out",
        }}
      >
        <div style={{ marginBottom: "16px", color: "#6b7280", fontSize: "0.9rem", fontWeight: 600 }}>
          Read the statement carefully:
        </div>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "#1f2937",
            lineHeight: 1.6,
            marginBottom: "20px",
            textAlign: "center",
            letterSpacing: "0.3px",
          }}
        >
          {safePrompt || "Is this statement true or false?"}
        </div>
        <div style={{ fontSize: "0.85rem", color: "#6b7280", textAlign: "center", fontStyle: "italic" }}>
          {instructions}
        </div>
      </div>

      {/* Decision buttons - BIG and satisfying */}
      <div style={{ display: "flex", gap: "12px", flexDirection: "column" }}>
        <button
          type="button"
          onClick={() => handleSingleSelect(singleFirstLabel)}
          disabled={disabled}
          style={{
            padding: "20px",
            borderRadius: "16px",
            border: "none",
            fontWeight: 700,
            fontSize: "1.2rem",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            background:
              singleSelected === (singleFirstLabel.toLowerCase() === "true" ? "true" : "false")
                ? singleFirstLabel.toLowerCase() === "true"
                  ? "linear-gradient(135deg, #3b82f6, #0ea5e9)"
                  : "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #f3f4f6, #e5e7eb)",
            color:
              singleSelected === (singleFirstLabel.toLowerCase() === "true" ? "true" : "false")
                ? "#fff"
                : "#374151",
            boxShadow:
              singleSelected === (singleFirstLabel.toLowerCase() === "true" ? "true" : "false")
                ? singleFirstLabel.toLowerCase() === "true"
                  ? "0 8px 20px rgba(59, 130, 246, 0.4)"
                  : "0 8px 20px rgba(239, 68, 68, 0.4)"
                : "0 4px 12px rgba(0, 0, 0, 0.1)",
            transform:
              singleSelected === (singleFirstLabel.toLowerCase() === "true" ? "true" : "false")
                ? "scale(1.02)"
                : "scale(1)",
            opacity: disabled ? 0.6 : 1,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {singleFirstLabel.toLowerCase() === "true" ? "✅ " : "❌ "}
          {singleFirstLabel}
        </button>
        <button
          type="button"
          onClick={() => handleSingleSelect(singleSecondLabel)}
          disabled={disabled}
          style={{
            padding: "20px",
            borderRadius: "16px",
            border: "none",
            fontWeight: 700,
            fontSize: "1.2rem",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            background:
              singleSelected === (singleSecondLabel.toLowerCase() === "true" ? "true" : "false")
                ? singleSecondLabel.toLowerCase() === "true"
                  ? "linear-gradient(135deg, #3b82f6, #0ea5e9)"
                  : "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #f3f4f6, #e5e7eb)",
            color:
              singleSelected === (singleSecondLabel.toLowerCase() === "true" ? "true" : "false")
                ? "#fff"
                : "#374151",
            boxShadow:
              singleSelected === (singleSecondLabel.toLowerCase() === "true" ? "true" : "false")
                ? singleSecondLabel.toLowerCase() === "true"
                  ? "0 8px 20px rgba(59, 130, 246, 0.4)"
                  : "0 8px 20px rgba(239, 68, 68, 0.4)"
                : "0 4px 12px rgba(0, 0, 0, 0.1)",
            transform:
              singleSelected === (singleSecondLabel.toLowerCase() === "true" ? "true" : "false")
                ? "scale(1.02)"
                : "scale(1)",
            opacity: disabled ? 0.6 : 1,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {singleSecondLabel.toLowerCase() === "true" ? "✅ " : "❌ "}
          {singleSecondLabel}
        </button>
      </div>

      {/* Answer reveal (single) */}
      {revealed && singleCorrectVal != null && (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: "16px",
            fontWeight: 700,
            fontSize: "1.05rem",
            textAlign: "center",
            color: "#fff",
            background:
              singleSelected === singleCorrectVal
                ? "linear-gradient(135deg, #16a34a, #15803d)"
                : "linear-gradient(135deg, #dc2626, #b91c1c)",
          }}
        >
          {singleSelected === singleCorrectVal
            ? "✓ Correct!"
            : `✗ The answer is ${singleCorrectVal === "true" ? "TRUE" : "FALSE"}.`}
        </div>
      )}

      {/* Submit / Continue button — post-reveal uses shared PrimaryButton. */}
      {revealed ? (
        <PrimaryButton onClick={fireSubmit}>Continue ▶</PrimaryButton>
      ) : singleSelected ? (
        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={disabled || !singleCanSubmit}
          style={{
            padding: "16px 24px",
            borderRadius: "16px",
            border: "none",
            fontWeight: 700,
            fontSize: "1rem",
            cursor: singleCanSubmit && !disabled ? "pointer" : "not-allowed",
            background:
              singleCanSubmit && !disabled
                ? "linear-gradient(135deg, #10b981, #059669)"
                : "#9ca3af",
            color: "#fff",
            boxShadow:
              singleCanSubmit && !disabled
                ? "0 8px 16px rgba(16, 185, 129, 0.3)"
                : "none",
            transition: "all 0.3s ease",
            transform: singleCanSubmit && !disabled ? "scale(1)" : "scale(0.98)",
            opacity: disabled ? 0.6 : 1,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            animation: "slideInDown 0.4s ease-out",
          }}
        >
          🎉 Submit Answer!
        </button>
      ) : null}

      {/* Score popups */}
      {scorePopups.map((popup) => (
        <div
          key={popup.id}
          style={{
            position: "fixed",
            bottom: "50px",
            right: "20px",
            fontSize: "1.3rem",
            fontWeight: 700,
            color: "#10b981",
            animation: "scorePopup 1.5s ease-out forwards",
            pointerEvents: "none",
          }}
        >
          {popup.text}
        </div>
      ))}
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
