// student-app/src/components/tasks/TaskInstructions.jsx
//
// Shared "How to play" / "Instructions" block for task components.
//
// Replaces three different ad-hoc patterns the codebase had grown:
//   (A) StepCircle + numbered text in hand-rolled markup (DrawMime, PaperPhotoSubmit, etc.)
//   (B) numbered <div>s with manual "1.", "2." prefixes (MC, Sequence)
//   (C) parseStepsFromPrompt() splitting `prompt` on \n / numbers (BodyBreak, MotionMission)
//
// Goal: every numbered/bulleted instruction list in a task component should
// look the same to students. Theme-aware (light/dark/eager/bold/dyno) via the
// shared UI tokens in taskStyles.jsx, so it fits inside any TaskCardFrame
// without color clashes.
//
// API:
//   <TaskInstructions steps={["Read", "Spot the details", "Answer"]} />
//   <TaskInstructions steps={[{ text: "Stretch", seconds: 10, icon: "🤸" }, ...]} />
//   <TaskInstructions text={task.prompt} />          // auto-parse from prompt string
//   <TaskInstructions label="How to play" steps={…} />   // custom heading
//   <TaskInstructions theme="dark" steps={…} />          // override auto-theme
//
// Drop the component in directly — no wrapping <div> needed.

import React from "react";
import StepCircle from "./StepCircle";
import { useThemeMode } from "../../utils/ThemeModeContext.js";
import { UI } from "./taskStyles";

// Parse a free-form prompt string into a steps array. Mirrors the various
// per-component implementations that existed before this shared component.
// Returns [{ text }] objects. Handles "1. …", "1) …", bullet lines, semicolons,
// and label prefixes ("BODY BREAK (45s): 1) … 2) …" → [step 1, step 2, …]).
export function parseStepsFromText(text) {
  const t = String(text || "").trim();
  if (!t) return [];

  const numbered = /(^|\s)\d+[\)\.]\s/.test(t);
  if (numbered) {
    const firstIdx = t.search(/\d+[\)\.]\s/);
    const numberedPart = firstIdx >= 0 ? t.slice(firstIdx) : t;
    const normalized = numberedPart.replace(/(\d+)[\)\.]\s*/g, "\n$1) ");
    return normalized
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\d+[\)\.]\s*/, "").trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }

  const lines = t
    .split(/\n|;|•|·/g)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length <= 1) return t ? [{ text: t }] : [];
  return lines.map((text) => ({ text }));
}

// Resolve theme tokens the same way taskStyles.jsx does so colors match the
// surrounding TaskCardFrame without the caller having to pass anything.
function useResolvedTheme(themeProp) {
  const contextTheme = useThemeMode();
  const themeKey = themeProp || contextTheme || "light";
  const palette = UI.theme[themeKey] || UI.theme.light;
  return { themeKey, palette };
}

export default function TaskInstructions({
  steps,
  text,
  label = "How to play",
  showLabel = true,
  theme,
  style,
  compact = false,
}) {
  const { palette } = useResolvedTheme(theme);

  // Normalize the input into a uniform shape: array of { text, icon?, seconds? }.
  let items = [];
  if (Array.isArray(steps)) {
    items = steps
      .map((s) => {
        if (typeof s === "string") return { text: s.trim() };
        if (s && typeof s === "object") {
          const itemText = String(s.text || s.instruction || s.label || "").trim();
          if (!itemText) return null;
          return {
            text: itemText,
            icon: s.icon || s.emoji || null,
            seconds: Number.isFinite(s.seconds) ? s.seconds : null,
          };
        }
        return null;
      })
      .filter(Boolean);
  } else if (typeof text === "string") {
    items = parseStepsFromText(text);
  }

  if (items.length === 0) return null;

  const pad = compact ? "10px 12px" : "14px 16px";
  const gap = compact ? 10 : 14;
  const rowGap = compact ? 8 : 10;

  return (
    <div
      style={{
        background: palette.cardBg || palette.pillBg,
        border: palette.border || "1px solid rgba(15,23,42,0.10)",
        borderRadius: 16,
        padding: pad,
        color: palette.text,
        display: "flex",
        flexDirection: "column",
        gap,
        ...style,
      }}
      data-task-instructions=""
    >
      {showLabel && label && (
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 900,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: palette.subtext,
          }}
        >
          {label}
        </div>
      )}

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: rowGap,
        }}
      >
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              lineHeight: 1.35,
            }}
          >
            <StepCircle n={i + 1} size={compact ? 22 : 26} />
            <span style={{ flex: 1, color: palette.text, fontSize: compact ? "0.92rem" : "0.98rem", fontWeight: 600 }}>
              {item.icon && <span style={{ marginRight: 6 }} aria-hidden="true">{item.icon}</span>}
              {item.text}
              {item.seconds != null && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: palette.pillBg,
                    border: palette.pillBorder,
                    color: palette.subtext,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.seconds}s
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
