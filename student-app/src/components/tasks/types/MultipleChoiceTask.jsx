import React, { useEffect, useMemo, useState } from "react";
import TaskChrome from "../TaskChrome";
import { CHROME_THEME } from "../taskChrome.theme";
import DesignatedWriter from "../DesignatedWriter";

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

export default function MultipleChoiceTask({ task, onComplete, memberNames = [] }) {
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

    // Keep payload compatible with typical runner expectations:
    // - selectedIndex
    // - isCorrect if available
    // - per-question and overall
    const payload = {
      selectedIndex: selectedIdx,
      selectedText: choices[selectedIdx],
      isCorrect,
      qIndex,
      totalQuestions: total,
      question: prompt,
    };

    // If your platform advances on "onComplete", keep that.
    // If it advances elsewhere, this still provides correct scoring payload.
    onComplete?.(payload);
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
        <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} role="answerer" />
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
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.14)",
              whiteSpace: "nowrap",
            }}
          >
            Q {qIndex + 1} / {total} • {progressPct}%
          </div>
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
            return (
              <button
                key={idx}
                type="button"
                onClick={() => selectChoice(idx)}
                disabled={submitLocked}
                style={{
                  textAlign: "left",
                  padding: "14px 14px",
                  borderRadius: 16,
                  cursor: submitLocked ? "not-allowed" : "pointer",
                  background: selected ? "rgba(59,130,246,0.22)" : "rgba(0,0,0,0.22)",
                  border: selected
                    ? "1px solid rgba(59,130,246,0.55)"
                    : "1px solid rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.92)",
                  fontWeight: 900,
                  lineHeight: 1.25,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 10,
                    display: "inline-grid",
                    placeItems: "center",
                    background: selected ? "rgba(59,130,246,0.75)" : "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: 12,
                    flex: "0 0 auto",
                  }}
                >
                  {String.fromCharCode(65 + idx)}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{choice}</span>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={qIndex === 0}
            style={{
              flex: "1 1 140px",
              padding: "12px 14px",
              borderRadius: 14,
              fontWeight: 900,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.92)",
              cursor: qIndex === 0 ? "not-allowed" : "pointer",
            }}
          >
            ◀ Back
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              flex: "2 1 240px",
              padding: "12px 14px",
              borderRadius: 14,
              fontWeight: 950,
              border: "1px solid rgba(255,255,255,0.16)",
              background: canSubmit
                ? "linear-gradient(90deg, rgba(34,197,94,0.95), rgba(59,130,246,0.95))"
                : "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.98)",
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            Submit
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={qIndex === items.length - 1}
            style={{
              flex: "1 1 140px",
              padding: "12px 14px",
              borderRadius: 14,
              fontWeight: 900,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.92)",
              cursor: qIndex === items.length - 1 ? "not-allowed" : "pointer",
            }}
          >
            Next ▶
          </button>
        </div>
      </div>
    </TaskChrome>
  );
}