// student-app/src/components/tasks/types/SortTask.jsx
import React, { useState } from "react";

export default function SortTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  // -------------------------------
  // Normalise config
  // -------------------------------
  const config = task?.config || {};

  // Buckets can come from:
  // - task.config.buckets
  // - task.buckets
  const rawBuckets = Array.isArray(config.buckets)
    ? config.buckets
    : Array.isArray(task?.buckets)
    ? task.buckets
    : [];

  // Normalise buckets to an array of display strings
  const buckets = rawBuckets.map((b) => {
    if (typeof b === "string") return b;
    if (b && typeof b === "object") {
      return b.label || b.name || b.title || String(b);
    }
    return String(b);
  });

  // Items can come from:
  // - task.config.items
  // - task.items
  const rawItems = Array.isArray(config.items)
    ? config.items
    : Array.isArray(task?.items)
    ? task.items
    : [];

  // Normalise items to objects with { id, text }
  const items = rawItems.map((it, idx) => {
    if (typeof it === "string") {
      return { id: idx, text: it };
    }
    if (it && typeof it === "object") {
      return {
        id: it.id ?? idx,
        text:
          it.text ??
          it.label ??
          it.name ??
          it.prompt ??
          `Item ${idx + 1}`,
      };
    }
    return { id: idx, text: String(it) };
  });

  // -------------------------------
  // State: assignments
  // -------------------------------
  // assignments = [{ itemId, bucketIndex }]
  const initialAssignments = () => {
    if (answerDraft && Array.isArray(answerDraft.assignments)) {
      // Expecting the same shape we emit on submit: { itemIndex, bucketIndex }
      return answerDraft.assignments.map((a, idx) => ({
        itemIndex: typeof a.itemIndex === "number" ? a.itemIndex : idx,
        bucketIndex:
          typeof a.bucketIndex === "number" ? a.bucketIndex : null,
      }));
    }
    return items.map((_, idx) => ({ itemIndex: idx, bucketIndex: null }));
  };

  const [assignments, setAssignments] = useState(initialAssignments);

  const pushDraft = (nextAssignments) => {
    if (onAnswerChange) {
      onAnswerChange({ assignments: nextAssignments });
    }
  };

  const setBucket = (itemIndex, bucketIndex) => {
    if (disabled) return;
    setAssignments((prev) => {
      const next = prev.map((a) =>
        a.itemIndex === itemIndex ? { ...a, bucketIndex } : a
      );
      pushDraft(next);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!onSubmit) return;
    if (assignments.some((a) => a.bucketIndex === null)) return;
    onSubmit({ assignments });
  };

  // -------------------------------
  // Misconfiguration guard
  // -------------------------------
  if (!buckets.length || !items.length) {
    return (
      <div style={{ padding: 16, fontSize: "0.9rem", color: "#4b5563" }}>
        This sort/categorize task is not fully configured yet
        (missing buckets or items).
      </div>
    );
  }

  // -------------------------------
  // Render
  // -------------------------------
  return (
    <div style={{ padding: 16 }}>
      {task?.prompt && (
        <h2
          style={{
            fontWeight: 700,
            fontSize: "1.1rem",
            marginBottom: 12,
          }}
        >
          {task.prompt}
        </h2>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {items.map((item, idx) => {
          const assign = assignments.find((a) => a.itemIndex === idx);
          const value = assign?.bucketIndex ?? "";

          return (
            <div
              key={item.id ?? idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 12,
                background: "rgba(255,255,255,0.9)",
                boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
              }}
            >
              <span style={{ flex: 1 }}>{item.text}</span>
              <select
                disabled={disabled}
                value={value}
                onChange={(e) =>
                  setBucket(
                    idx,
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                style={{
                  minWidth: 140,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.9)",
                  background: disabled ? "#f3f4f6" : "#ffffff",
                  fontSize: "0.85rem",
                }}
              >
                <option value="">Choose…</option>
                {buckets.map((b, bIdx) => (
                  <option key={bIdx} value={bIdx}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={
          disabled || assignments.some((a) => a.bucketIndex === null)
        }
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 999,
          border: "none",
          fontWeight: 700,
          fontSize: "0.95rem",
          cursor:
            disabled || assignments.some((a) => a.bucketIndex === null)
              ? "not-allowed"
              : "pointer",
          background:
            disabled || assignments.some((a) => a.bucketIndex === null)
              ? "rgba(148,163,184,0.6)"
              : "#0ea5e9",
          color: "#ffffff",
          boxShadow: "0 2px 6px rgba(15,23,42,0.25)",
        }}
      >
        Submit
      </button>
    </div>
  );
}
