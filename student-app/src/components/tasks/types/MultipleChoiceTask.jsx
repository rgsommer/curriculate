import React, { useEffect, useMemo, useState } from "react";
import TaskChrome from "../TaskChrome";
import { CHROME_THEME } from "../taskChrome.theme";
import DesignatedWriter from "../DesignatedWriter";
import { Pill, PrimaryButton, GhostButton } from "../taskStyles";

/**
 * MultipleChoiceTask
 *
 * Fix: Students reported their selected options sometimes "reset" when the intro video
 * finishes (or during other early chrome events). This is typically caused by a brief
 * unmount/remount of the task component. A plain useState() will reset on remount.
 *
 * Solution: keep a small module-level cache keyed by a stable task signature so selections
 * survive remounts during the same run/session, while still resetting cleanly for a new task.
 */
const MC_CACHE = new Map();

/** Build a stable cache key for this task instance. */
function getCacheKey(task) {
  if (!task) return "mc:unknown";
  // Prefer an explicit id if present, otherwise fall back to a composite signature.
  const id = task.id || task.taskId || "";
  const title = task.title || "";
  const type = task.taskType || task.type || "multiple-choice";
  const itemCount = Array.isArray(task.items) ? task.items.length : 0;
  return `mc:${id || `${type}:${title}:${itemCount}`}`;
}

export default function MultipleChoiceTask({ task, onComplete, memberNames = [], xrayActive = false, onXrayConsumed }) {
  const items = Array.isArray(task?.items) ? task.items : [];
  const cacheKey = useMemo(() => getCacheKey(task), [task]);

  // Load cached state (if any) to survive brief unmount/remount cycles.
  const cached = useMemo(() => MC_CACHE.get(cacheKey) || null, [cacheKey]);

  const [qIndex, setQIndex] = useState(() => {
    const idx = cached?.qIndex;
    return Number.isFinite(idx) ? Math.max(0, Math.min(items.length - 1, idx)) : 0;
  });

  const [selectedByIndex, setSelectedByIndex] = useState(() => {
    // selectedByIndex is an object: { [qIndex]: choiceIndex }
    const v = cached?.selectedByIndex;
    return v && typeof v === "object" ? { ...v } : {};
  });

  const [submitLocked, setSubmitLocked] = useState(() => !!cached?.submitLocked);

  const q = items[qIndex] || {};
  const prompt = String(q.prompt || q.question || task?.prompt || "Choose the best answer.").trim();

  const choices = useMemo(() => {
    const raw = Array.isArray(q.choices) ? q.choices : Array.isArray(q.options) ? q.options : [];
    return raw.map((c) => (typeof c === "string" ? c : c?.text || "")).map((s) => String(s).trim()).filter(Boolean);
  }, [q]);

  const correctIndex = useMemo(() => {
    const v = q.correctIndex ?? q.correctAnswer ?? q.answerIndex;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [q]);

  const selectedIdx = selectedByIndex[qIndex];
  const canSubmit = Number.isFinite(selectedIdx) && selectedIdx >= 0 && selectedIdx < choices.length && !submitLocked;

  // Superpower — 👀 X-Ray. When the parent activates X-Ray and the current
  // question has a knowable correctIndex, pick a random WRONG option and
  // remember it per qIndex. The choice below greys+disables that option
  // and calls onXrayConsumed so the parent can clear the armed flag.
  // Stored per-qIndex so switching questions doesn't leak the elimination
  // and a re-visit to the same question shows the same greyed option.
  const [xrayHiddenByQIndex, setXrayHiddenByQIndex] = useState({});
  useEffect(() => {
    if (!xrayActive) return;
    if (xrayHiddenByQIndex[qIndex] !== undefined) return; // already computed
    if (correctIndex == null) return; // can't pick a wrong answer without knowing the right one
    const wrongIndices = choices
      .map((_, i) => i)
      .filter((i) => i !== correctIndex);
    if (wrongIndices.length === 0) return;
    const pick = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
    setXrayHiddenByQIndex((prev) => ({ ...prev, [qIndex]: pick }));
    if (typeof onXrayConsumed === "function") onXrayConsumed();
  }, [xrayActive, qIndex, correctIndex, choices.length, xrayHiddenByQIndex, onXrayConsumed]);
  const xrayHiddenIdx = xrayHiddenByQIndex[qIndex];

  // Persist to cache on every relevant change.
  useEffect(() => {
    MC_CACHE.set(cacheKey, {
      qIndex,
      selectedByIndex,
      submitLocked,
      updatedAt: Date.now(),
    });
  }, [cacheKey, qIndex, selectedByIndex, submitLocked]);

  // When the task changes (new cacheKey), reset submission lock.
  useEffect(() => {
    setSubmitLocked(false);
  }, [cacheKey]);

  const total = items.length || 1;

  function selectChoice(idx) {
    if (submitLocked) return;
    setSelectedByIndex((prev) => ({ ...prev, [qIndex]: idx }));
  }

  function goPrev() {
    if (qIndex <= 0) return;
    setSubmitLocked(false);
    setQIndex((v) => Math.max(0, v - 1));
  }

  function goNext() {
    if (qIndex >= items.length - 1) return;
    setSubmitLocked(false);
    setQIndex((v) => Math.min(items.length - 1, v + 1));
  }

  function handleSubmit() {
    if (!canSubmit) return;

    const isCorrect =
      correctIndex == null
        ? null
        : Number.isFinite(selectedIdx) && Number.isFinite(correctIndex)
          ? selectedIdx === correctIndex
          : null;

    setSubmitLocked(true);

    const payload = {
      selectedIndex: selectedIdx,
      selectedText: choices[selectedIdx],
      isCorrect,
      qIndex,
      totalQuestions: total,
      question: prompt,
    };

    // Tester: 'answer layover should show'.  Hold the post-submit
    // state — which already highlights the correct option green and
    // wrong picks red — for ~3s before passing the result up.  The
    // parent runner is what actually advances the task, so deferring
    // the onComplete call gives the player time to see what was right.
    const delay = correctIndex != null ? 3000 : 0;
    setTimeout(() => {
      onComplete?.(payload);
    }, delay);
  }

  // UI helpers
  const progressPct = Math.round(((qIndex + 1) / total) * 100);

  return (
    <TaskChrome
      task={task}
      theme={CHROME_THEME.multipleChoice}
      // If your TaskChrome supports primary actions, wire them up; if not, harmless extra props.
      primaryActionLabel={qIndex === total - 1 ? "Submit" : "Submit & Next"}
      onPrimaryAction={handleSubmit}
      primaryActionDisabled={!canSubmit}
      // Keep user's selection stable across chrome transitions.
    >
      <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
        <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} taskIndex={task?._taskIndex} role="answerer" />
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: 0.2 }}>
            Multiple Choice
          </div>
          <Pill theme="dark" subtle style={{ whiteSpace: "nowrap" }}>
            Q {qIndex + 1} / {total} • {progressPct}%
          </Pill>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 10,
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            border: "1px solid rgba(255,255,255,0.10)",
            overflow: "hidden",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progressPct))}%`,
              height: "100%",
              borderRadius: 999,
              background: "linear-gradient(90deg, rgba(34,197,94,0.95), rgba(59,130,246,0.95))",
            }}
          />
        </div>

        {/* Prompt */}
        <div
          style={{
            borderRadius: 18,
            padding: 16,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95, marginBottom: 10 }}>
            Question
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.25 }}>
            {prompt}
          </div>
        </div>

        {/* Choices */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {choices.map((choice, idx) => {
            const selected = selectedIdx === idx;
            const isCorrectChoice = correctIndex != null && idx === correctIndex;
            const isWrongPick = submitLocked && selected && correctIndex != null && idx !== correctIndex;
            const showCorrect = submitLocked && isCorrectChoice;
            const isXrayed = !submitLocked && xrayHiddenIdx === idx;

            let bg = selected ? "rgba(59,130,246,0.22)" : "rgba(0,0,0,0.22)";
            let border = selected ? "1px solid rgba(59,130,246,0.55)" : "1px solid rgba(255,255,255,0.14)";
            let badgeBg = selected ? "rgba(59,130,246,0.75)" : "rgba(255,255,255,0.10)";

            if (showCorrect) {
              bg = "rgba(34,197,94,0.25)";
              border = "2px solid rgba(34,197,94,0.7)";
              badgeBg = "rgba(34,197,94,0.75)";
            } else if (isWrongPick) {
              bg = "rgba(239,68,68,0.25)";
              border = "2px solid rgba(239,68,68,0.7)";
              badgeBg = "rgba(239,68,68,0.75)";
            } else if (isXrayed) {
              bg = "rgba(148,163,184,0.10)";
              border = "1px dashed rgba(148,163,184,0.55)";
              badgeBg = "rgba(148,163,184,0.30)";
            }

            return (
              <button
                key={idx}
                type="button"
                data-testid={isXrayed ? `mc-xrayed-${idx}` : undefined}
                onClick={() => selectChoice(idx)}
                disabled={submitLocked || isXrayed}
                title={isXrayed ? "👀 X-Ray eliminated this option" : undefined}
                style={{
                  textAlign: "left",
                  padding: "14px 14px",
                  borderRadius: 18,
                  cursor: submitLocked || isXrayed ? "not-allowed" : "pointer",
                  background: bg,
                  border,
                  color: isXrayed ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)",
                  fontWeight: 900,
                  lineHeight: 1.25,
                  textDecoration: isXrayed ? "line-through" : "none",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  transition: "all 0.3s ease",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 10,
                    display: "inline-grid",
                    placeItems: "center",
                    background: badgeBg,
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: 12,
                    flex: "0 0 auto",
                  }}
                >
                  {showCorrect ? "✓" : isWrongPick ? "✗" : String.fromCharCode(65 + idx)}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{choice}</span>
              </button>
            );
          })}
        </div>

        {/* Answer overlay after submit */}
        {submitLocked && correctIndex != null && (
          <div style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 14,
            background: selectedIdx === correctIndex
              ? "rgba(34,197,94,0.18)"
              : "rgba(239,68,68,0.18)",
            border: `1px solid ${selectedIdx === correctIndex ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
            fontWeight: 800,
            fontSize: 15,
            textAlign: "center",
          }}>
            {selectedIdx === correctIndex
              ? "✅ Correct!"
              : `❌ The correct answer was: ${String.fromCharCode(65 + correctIndex)}. ${choices[correctIndex]}`}
          </div>
        )}

        {/* Controls — migrated to shared PrimaryButton / GhostButton from
            taskStyles.jsx. theme="dark" matches MC's surrounding dark visuals
            (translucent dark cards on the page bg). Submit uses the canonical
            indigo→sky PrimaryButton gradient; Back/Next use the dark-theme
            GhostButton. The flex sizing is preserved via the style override. */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <GhostButton
            theme="dark"
            onClick={goPrev}
            disabled={qIndex === 0}
            style={{ flex: "1 1 140px" }}
          >
            ◀ Back
          </GhostButton>

          <PrimaryButton
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ flex: "2 1 240px" }}
          >
            Submit
          </PrimaryButton>

          <GhostButton
            theme="dark"
            onClick={goNext}
            disabled={qIndex === items.length - 1}
            style={{ flex: "1 1 140px" }}
          >
            Next ▶
          </GhostButton>
        </div>
      </div>
    </TaskChrome>
  );
}