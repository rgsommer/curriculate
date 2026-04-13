// student-app/src/components/tasks/DesignatedWriter.jsx
// Shows which team member's turn it is for the current task.
// Uses a simple hash of the task title to rotate consistently.
import React, { useMemo } from "react";

export function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Given member names and a task index, return who is designated.
 * Uses simple round-robin by index for predictable rotation.
 * Exported so other components (e.g. handoff prompt) can compute this
 * without rendering the banner.
 */
export function getDesignatedName(memberNames, taskIndex) {
  const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  const idx = typeof taskIndex === "number" ? taskIndex : simpleHash(String(taskIndex || "task"));
  return names[Math.abs(idx) % names.length];
}

const ROLE_PRESETS = {
  writer:   { emoji: "🖊️", action: "you're the writer!" },
  answerer: { emoji: "👆", action: "your turn to answer!" },
  reader:   { emoji: "📖", action: "read this one aloud!" },
  speaker:  { emoji: "🎤", action: "your turn to speak!" },
  photo:    { emoji: "📸", action: "your turn to snap the photo!" },
  default:  { emoji: "⭐", action: "it's your turn!" },
};

export default function DesignatedWriter({ memberNames = [], taskTitle = "", taskIndex, role = "writer" }) {
  const names = useMemo(
    () => (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []),
    [memberNames]
  );

  const chosen = useMemo(() => {
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    // Prefer taskIndex for consistent rotation; fall back to title hash
    if (typeof taskIndex === "number" && taskIndex >= 0) {
      return names[taskIndex % names.length];
    }
    const idx = simpleHash(taskTitle || "task") % names.length;
    return names[idx];
  }, [names, taskTitle, taskIndex]);

  if (!chosen) return null;

  const preset = ROLE_PRESETS[role] || ROLE_PRESETS.default;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        marginBottom: 12,
        borderRadius: 10,
        background: "linear-gradient(135deg, #ede9fe 0%, #dbeafe 100%)",
        border: "1px solid #c4b5fd",
        fontSize: 14,
        fontWeight: 600,
        color: "#4338ca",
      }}
    >
      <span style={{ fontSize: 18 }}>{preset.emoji}</span>
      <span>
        <strong>{chosen}</strong> — {preset.action}
        {names.length > 1 && (
          <span style={{ fontWeight: 400, color: "#6366f1", marginLeft: 4 }}>
            (team: help them out!)
          </span>
        )}
      </span>
    </div>
  );
}
