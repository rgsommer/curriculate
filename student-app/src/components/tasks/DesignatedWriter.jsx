// student-app/src/components/tasks/DesignatedWriter.jsx
// Shows which team member should type/dictate for writing tasks.
// Uses a simple hash of the task title to pick consistently.
import React, { useMemo } from "react";

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export default function DesignatedWriter({ memberNames = [], taskTitle = "" }) {
  const names = useMemo(
    () => (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []),
    [memberNames]
  );

  const chosen = useMemo(() => {
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    const idx = simpleHash(taskTitle || "task") % names.length;
    return names[idx];
  }, [names, taskTitle]);

  if (!chosen) return null;

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
      <span style={{ fontSize: 18 }}>🖊️</span>
      <span>
        <strong>{chosen}</strong> — you're the writer!
        {names.length > 1 && (
          <span style={{ fontWeight: 400, color: "#6366f1", marginLeft: 4 }}>
            (team: help them out!)
          </span>
        )}
      </span>
    </div>
  );
}
