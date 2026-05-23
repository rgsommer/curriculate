// student-app/src/components/tasks/taskStyles.jsx
import React from "react";
import { useThemeMode } from "../../utils/ThemeModeContext.js";
import { THEMES, isDarkTheme } from "../../utils/themeHelpers.js";

/**
 * Curriculate Task UI System
 * Goal: keep TaskRunner thin while giving every task a consistent, beautiful frame.
 *
 * CANONICAL FRAME FOR NEW TASKS:
 * - Wrap the task in <TaskCardFrame> (header/title/badge + themed card).
 * - Use <PrimaryButton> for the main submit/continue action and <GhostButton>
 *   for secondary actions — do NOT hand-roll bespoke gradient buttons.
 * - Use <WaitingPill> for "waiting for others / next task" states.
 * These are opt-in: existing tasks are not being retrofitted, but new task
 * types should adopt them so the student-facing frame stays consistent.
 *
 * IMPORTANT:
 * - This file contains JSX, so it MUST be .jsx (or .tsx). If you use .js, Vite/Rollup may error.
 *
 * Usage:
 *   import { TaskCardFrame, Pill, WaitingPill, PrimaryButton, GhostButton, TextInput, TextArea } from "../taskStyles";
 */

export const UI = {
  shell: {
    height: "100%",
    padding: 16,
    display: "grid",
    placeItems: "center",
  },
  theme: {
    light: {
      pageBg:
        "radial-gradient(1000px 520px at 18% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(900px 480px at 86% 20%, rgba(99,102,241,0.18), transparent 60%), linear-gradient(135deg, rgba(248,250,252,1), rgba(255,255,255,1))",
      cardBg:
        "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,255,255,0.82))",
      border: "1px solid rgba(15,23,42,0.12)",
      shadow: "0 26px 80px rgba(15,23,42,0.14)",
      text: "#0f172a",
      subtext: "rgba(15,23,42,0.72)",
      topBorder: "1px solid rgba(15,23,42,0.08)",
      pillBg: "rgba(255,255,255,0.80)",
      pillBorder: "1px solid rgba(15,23,42,0.10)",
      inputBg: "rgba(255,255,255,0.92)",
      inputBorder: "1px solid rgba(15,23,42,0.14)",
    },
    dark: {
      pageBg:
        "radial-gradient(1000px 520px at 18% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(900px 480px at 86% 20%, rgba(99,102,241,0.18), transparent 60%), linear-gradient(135deg, rgba(15,23,42,1), rgba(2,6,23,1))",
      cardBg: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      shadow: "0 26px 80px rgba(0,0,0,0.35)",
      text: "#ffffff",
      subtext: "rgba(226,232,240,0.80)",
      topBorder: "1px solid rgba(255,255,255,0.10)",
      pillBg: "rgba(255,255,255,0.10)",
      pillBorder: "1px solid rgba(255,255,255,0.16)",
      inputBg: "rgba(2,6,23,0.55)",
      inputBorder: "1px solid rgba(255,255,255,0.12)",
    },
  },
};

/**
 * Build a per-theme palette by taking the light/dark base (which owns the
 * polished gradients/shadows) and overriding the *color identity* from the
 * single source of truth in themeHelpers.THEMES. This is what unifies the two
 * theme systems: themeHelpers owns the colors; taskStyles owns the structure.
 * Bold (violet) and Dyno (cyan) therefore look different inside tasks even
 * though both are "dark" mode. "light"/"dark" remain as back-compat aliases.
 */
function buildThemePalette(key) {
  const tk = THEMES[key];
  const dark = isDarkTheme(key);
  const base = dark ? UI.theme.dark : UI.theme.light;
  if (!tk) return base;
  const fallbackBorder = dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.12)";
  return {
    ...base,
    text: tk.text || base.text,
    subtext: tk.textMuted || base.subtext,
    border: `1px solid ${tk.surfaceBorder || fallbackBorder}`,
    topBorder: `1px solid ${tk.surfaceBorder || fallbackBorder}`,
    pillBorder: `1px solid ${tk.surfaceBorder || fallbackBorder}`,
    inputBg: tk.inputBg || base.inputBg,
    inputBorder: `1px solid ${tk.inputBorder || fallbackBorder}`,
    accent: tk.accent || undefined,
  };
}

UI.theme.eager = buildThemePalette("eager");
UI.theme.bold = buildThemePalette("bold");
UI.theme.dyno = buildThemePalette("dyno");

export function TaskCardFrame({
  theme: themeProp,
  title,
  subtitle,
  badge,
  right,
  children,
  maxWidth = 1200,
  showBackground = true,
  style,
  contentStyle,
  fullBleed = false,
  contentPadding = 16,
}) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);

  if (fullBleed) {
    // For "full screen" tasks (e.g., Draw/Mime). Still "uses TaskCardFrame" but doesn't constrain width.
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          position: "relative",
          background: showBackground ? t.pageBg : undefined,
          ...style,
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        ...UI.shell,
        background: showBackground ? t.pageBg : undefined,
      }}
    >
      <div
        style={{
          width: `min(${maxWidth}px, 94vw)`,
          borderRadius: 28,
          border: t.border,
          background: t.cardBg,
          boxShadow: t.shadow,
          overflow: "hidden",
          color: t.text,
          ...style,
        }}
      >
        {(title || subtitle || badge || right) && (
          <div
            style={{
              padding: 16,
              borderBottom: t.topBorder,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              backdropFilter: isDarkTheme(theme) ? "blur(10px)" : undefined,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {badge ? <Pill theme={theme}>{badge}</Pill> : null}
                {subtitle ? <Pill theme={theme} subtle>{subtitle}</Pill> : null}
              </div>
              {title ? (
                <div
                  style={{
                    fontSize: "clamp(22px, 2.2vw, 34px)",
                    fontWeight: 1100,
                    letterSpacing: -0.2,
                    lineHeight: 1.08,
                  }}
                >
                  {title}
                </div>
              ) : null}
            </div>

            {right ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {right}
              </div>
            ) : null}
          </div>
        )}

        <div style={{ padding: contentPadding, ...contentStyle }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Lightweight "building blocks" some tasks import directly.
 * TaskChrome is the preferred wrapper, but exporting these keeps older
 * task implementations compatible.
 */

export function TaskPanel({ children, style }) {
  const t = UI.theme;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 16,
        background: t.surface,
        border: `1px solid ${t.border}`,
        boxShadow: t.shadowSoft,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function TaskTitle({ children, style }) {
  const t = UI.theme;
  return (
    <div
      style={{
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: "-0.01em",
        color: t.text,
        lineHeight: 1.15,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function TaskSubtitle({ children, style }) {
  const t = UI.theme;
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 13,
        fontWeight: 700,
        color: t.muted,
        lineHeight: 1.25,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function TaskBodyText({ children, style }) {
  const t = UI.theme;
  return (
    <div
      style={{
        fontSize: 14,
        color: t.text,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ children, subtle = false, theme: themeProp, style }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 999,
        border: t.pillBorder,
        background: subtle
          ? isDarkTheme(theme)
            ? "rgba(255,255,255,0.06)"
            : "rgba(255,255,255,0.62)"
          : t.pillBg,
        fontWeight: 950,
        fontSize: 12,
        letterSpacing: subtle ? 0 : 0.6,
        textTransform: subtle ? "none" : "uppercase",
        color: subtle ? t.subtext : t.text,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * WaitingPill
 * Presentational "waiting for others / next task" indicator with a subtle
 * pulsing dot. Theme-aware. Opt-in — the caller decides when to render it
 * based on its own (often socket-driven) state; this component owns no logic.
 */
export function WaitingPill({ children = "Waiting…", theme: themeProp, style }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        border: t.pillBorder,
        background: isDarkTheme(theme) ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.62)",
        color: t.subtext,
        fontWeight: 850,
        fontSize: 13,
        ...style,
      }}
      role="status"
      aria-live="polite"
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "currentColor",
          opacity: 0.85,
          animation: "curricWaitingPulse 1.2s ease-in-out infinite",
        }}
      />
      <span>{children}</span>
      <style>{`
        @keyframes curricWaitingPulse {
          0%, 100% { opacity: 0.25; transform: scale(0.85); }
          50%      { opacity: 0.9;  transform: scale(1); }
        }
      `}</style>
    </span>
  );
}

export function Divider({ theme: themeProp, style }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <div
      style={{
        height: 1,
        width: "100%",
        background:
          isDarkTheme(theme)
            ? "rgba(255,255,255,0.14)"
            : "rgba(15,23,42,0.14)",
        margin: "16px 0",
        ...style,
      }}
    />
  );
}

export function HelpText({ children, theme: themeProp, style }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <div
      style={{
        fontSize: 12.5,
        fontWeight: 750,
        lineHeight: 1.35,
        color: t.subtext,
        opacity: isDarkTheme(theme) ? 0.92 : 0.9,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({ children, disabled, onClick, style, type = "button" }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        borderRadius: 18,
        padding: "14px 16px",
        border: "none",
        background: "linear-gradient(135deg, rgba(99,102,241,0.96), rgba(56,189,248,0.76))",
        color: "#0b1220",
        fontWeight: 1100,
        cursor: disabled ? "default" : "pointer",
        boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, disabled, onClick, theme: themeProp, style, type = "button" }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        borderRadius: 18,
        padding: "12px 14px",
        border: t.inputBorder,
        background: isDarkTheme(theme) ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.70)",
        color: isDarkTheme(theme) ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.92)",
        fontWeight: 1000,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function TextInput({ value, onChange, onKeyDown, placeholder, disabled, theme: themeProp, style, ...rest }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <input
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        height: 52,
        borderRadius: 18,
        padding: "0 14px",
        border: t.inputBorder,
        background: t.inputBg,
        color: isDarkTheme(theme) ? "#fff" : "#0f172a",
        fontWeight: 850,
        outline: "none",
        width: "100%",
        ...style,
      }}
      {...rest}
    />
  );
}

export function TextArea({ value, onChange, placeholder, disabled, rows = 6, theme: themeProp, style, ...rest }) {
  const contextTheme = useThemeMode();
  const theme = themeProp || contextTheme || "light";
  const t = UI.theme[theme] || (isDarkTheme(theme) ? UI.theme.dark : UI.theme.light);
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      style={{
        width: "100%",
        padding: 12,
        borderRadius: 18,
        border: t.inputBorder,
        background: t.inputBg,
        color: isDarkTheme(theme) ? "#fff" : "#0f172a",
        fontWeight: 800,
        fontSize: "0.98rem",
        outline: "none",
        resize: "vertical",
        ...style,
      }}
      {...rest}
    />
  );
}
