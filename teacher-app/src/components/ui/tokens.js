// teacher-app/src/components/ui/tokens.js
//
// Design tokens for the teacher app. Single source of truth so every page
// stops hand-rolling its own colors / radii / shadows. Values picked to match
// the most-used existing inline styles (so adopting these tokens is largely a
// visual no-op, not a re-skin).
//
// Usage:
//   import { COLORS, RADII, SHADOWS, SPACING } from "./tokens";
//   style={{ background: COLORS.primary, borderRadius: RADII.md }}

export const COLORS = {
  // Text — graded for use on white/light backgrounds.
  textPrimary: "#111827",   // gray-900: body / headings
  textSecondary: "#374151", // gray-700: labels, secondary copy
  textMuted: "#6b7280",     // gray-500: muted hint text (still WCAG AA on white at 14px+)
  textDisabled: "#9ca3af",  // gray-400: ONLY for backgrounds darker than #f3f4f6

  // Surfaces
  bg: "#ffffff",
  bgSubtle: "#f9fafb",       // page sections
  bgMuted: "#f3f4f6",        // disabled / inactive panels
  bgOverlay: "rgba(15,23,42,0.55)", // modal backdrop

  // Borders
  border: "#e5e7eb",         // default 1px borders
  borderStrong: "#d1d5db",   // form-field borders
  borderSubtle: "#f3f4f6",   // very subtle dividers

  // Accents (semantic)
  primary: "#2563eb",        // blue-600 — main CTA
  primaryHover: "#1d4ed8",
  primaryBgSoft: "#eff6ff",  // for selected/active soft fills

  success: "#16a34a",
  successBg: "#f0fdf4",

  warning: "#d97706",
  warningBg: "#fffbeb",

  danger: "#b91c1c",         // red-700
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",
};

export const RADII = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
};

export const SHADOWS = {
  sm: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
  md: "0 4px 12px rgba(15,23,42,0.08)",
  lg: "0 12px 32px rgba(15,23,42,0.12)",
  modal: "0 24px 64px rgba(15,23,42,0.22)",
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const TYPE = {
  // Common label / hint sizes used across forms.
  labelSize: "0.85rem",
  hintSize: "0.78rem",
  bodySize: "0.95rem",
};
