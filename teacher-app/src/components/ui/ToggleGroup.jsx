// teacher-app/src/components/ui/ToggleGroup.jsx
//
// Shared selected/unselected pill-toggle primitive. Replaces the
// hand-rolled "selected pill borderColor #X bg #Y vs unselected white" UI
// found across TaskSets (📄 New copy / ♻️ Replace original), AiTasksetGenerator
// (party themes, event modes, task-type filters), and LiveSession.
//
// Two flavours:
//   - <ToggleGroup value={x} onChange={fn} options={[{value, label, tip?}]} />
//     Single-select; one pill highlighted at a time.
//   - <ToggleGroup multi value={[a,b]} onChange={fn} options={...} />
//     Multi-select; multiple pills can be highlighted.
//
// Accent colour is themeable via the `accent` prop ("primary" default,
// or any hex). For semantic toggles (e.g. party/event-mode), pass an
// accent matching the existing brand colour so the migration is a no-op
// visually.

import React from "react";
import { COLORS, RADII } from "./tokens";

const SIZE_CONFIG = {
  sm: { padding: "5px 10px", fontSize: "0.78rem" },
  md: { padding: "8px 14px", fontSize: "0.88rem" },
  lg: { padding: "10px 18px", fontSize: "0.95rem" },
};

export default function ToggleGroup({
  value,
  onChange,
  options,
  multi = false,
  size = "md",
  accent,
  disabled = false,
  ariaLabel,
  style,
}) {
  const accentColor = accent || COLORS.primary;
  const sz = SIZE_CONFIG[size] || SIZE_CONFIG.md;

  const selectedSet = multi
    ? new Set(Array.isArray(value) ? value.map(String) : [])
    : new Set(value != null ? [String(value)] : []);

  function toggle(optValue) {
    if (disabled) return;
    if (multi) {
      const current = Array.isArray(value) ? value.map(String) : [];
      const isSelected = current.includes(String(optValue));
      const next = isSelected
        ? current.filter((v) => v !== String(optValue))
        : [...current, String(optValue)];
      onChange?.(next);
    } else {
      onChange?.(optValue);
    }
  }

  return (
    <div
      role={multi ? "group" : "radiogroup"}
      aria-label={ariaLabel}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        ...style,
      }}
    >
      {(options || []).map((opt) => {
        const isSelected = selectedSet.has(String(opt.value));
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => toggle(opt.value)}
            disabled={disabled || opt.disabled}
            title={opt.tip}
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            aria-pressed={isSelected}
            style={{
              ...sz,
              borderRadius: RADII.pill,
              border: `1.5px solid ${isSelected ? accentColor : COLORS.borderStrong}`,
              background: isSelected ? withAlpha(accentColor, 0.08) : COLORS.bg,
              color: isSelected ? withAlpha(accentColor, 1) : COLORS.textSecondary,
              fontWeight: isSelected ? 800 : 600,
              cursor: disabled || opt.disabled ? "not-allowed" : "pointer",
              opacity: disabled || opt.disabled ? 0.55 : 1,
              transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Convert any "#rrggbb" or "rgba(...)" / "rgb(...)" string to "rgba(...,a)".
// Used to keep the selected pill's fill in the same hue as its border.
function withAlpha(color, alpha) {
  if (typeof color !== "string") return color;
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
    const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
    const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // rgb() / rgba() — replace any existing alpha with the new value.
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim()).slice(0, 3);
    return `rgba(${parts.join(", ")}, ${alpha})`;
  }
  return color;
}
