// teacher-app/src/components/ui/Checkbox.jsx
//
// Shared checkbox primitive for the teacher app. Audit found ~10 hand-rolled
// <label style={{display:"flex", alignItems:"center", gap:8, cursor:"pointer"}}>
//   <input type="checkbox" checked={x} onChange={fn} />
//   <span>Label text</span>
// </label>
// pairs across TaskSets / AiTasksetGenerator / LiveSession. Standardize.
//
// Usage:
//   <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
//     Enable feature
//   </Checkbox>
//
//   <Checkbox checked={x} onChange={...} description="Helper text below">
//     Bold label
//   </Checkbox>

import React from "react";
import { COLORS, TYPE } from "./tokens";

export default function Checkbox({
  checked,
  onChange,
  children,
  description,
  disabled = false,
  style,
  id,
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: description ? "flex-start" : "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        onChange={onChange}
        disabled={disabled}
        style={{
          width: 16,
          height: 16,
          cursor: disabled ? "not-allowed" : "pointer",
          accentColor: COLORS.primary,
          flexShrink: 0,
          marginTop: description ? 2 : 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: TYPE.bodySize,
            fontWeight: 600,
            color: COLORS.textSecondary,
            lineHeight: 1.35,
          }}
        >
          {children}
        </span>
        {description && (
          <div
            style={{
              fontSize: TYPE.hintSize,
              color: COLORS.textMuted,
              marginTop: 2,
              fontWeight: 400,
              lineHeight: 1.4,
            }}
          >
            {description}
          </div>
        )}
      </span>
    </label>
  );
}
