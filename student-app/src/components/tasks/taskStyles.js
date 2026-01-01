// student-app/src/components/tasks/taskStyles.js
import React from "react";

/**
 * Curriculate Task UI System
 * - Keep TaskRunner thin.
 * - Give each task a consistent, beautiful frame (cards, pills, buttons).
 *
 * Usage:
 *   import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextInput } from "../taskStyles";
 */

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export const UI = {
  // surfaces
  shell: {
    height: "100%",
    padding: 16,
    display: "grid",
    placeItems: "center",
  },
  // theme tokens
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

export function TaskCardFrame({
  theme = "light",
  title,
  subtitle,
  badge,
  right,
  children,
  maxWidth = 1200,
  showBackground = true,
  style,
}) {
  const t = UI.theme[theme] || UI.theme.light;

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
              backdropFilter: theme === "dark" ? "blur(10px)" : undefined,
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

            {right ? <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{right}</div> : null}
          </div>
        )}

        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export function Pill({ children, subtle = false, theme = "light", style }) {
  const t = UI.theme[theme] || UI.theme.light;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 999,
        border: t.pillBorder,
        background: subtle ? (theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.62)") : t.pillBg,
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

export function PrimaryButton({ children, disabled, onClick, theme = "light", style, type = "button" }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        borderRadius: 18,
        padding: "14px 16px",
        border: "none",
        background:
          "linear-gradient(135deg, rgba(99,102,241,0.96), rgba(56,189,248,0.76))",
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

export function GhostButton({ children, disabled, onClick, theme = "light", style, type = "button" }) {
  const t = UI.theme[theme] || UI.theme.light;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        borderRadius: 18,
        padding: "12px 14px",
        border: t.inputBorder,
        background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.70)",
        color: theme === "dark" ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.92)",
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

export function TextInput({ value, onChange, onKeyDown, placeholder, disabled, theme = "light", style, ...rest }) {
  const t = UI.theme[theme] || UI.theme.light;
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
        color: theme === "dark" ? "#fff" : "#0f172a",
        fontWeight: 850,
        outline: "none",
        width: "100%",
        ...style,
      }}
      {...rest}
    />
  );
}
