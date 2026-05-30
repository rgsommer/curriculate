// teacher-app/src/components/ui/Button.jsx
//
// Shared button primitive for the teacher app. Replaces 8+ hand-rolled
// button styles spread across TaskSets, AiTasksetGenerator, LiveSession, etc.
//
// Variants:
//   primary  — blue solid, white text. The main CTA on a page.
//   ghost    — white bg with gray border. Secondary actions (Cancel, Back).
//   danger   — light red bg + red text. Destructive actions (Delete).
//   subtle   — transparent, gray hover. Tertiary actions (links, "Show more").
//
// Sizes:
//   sm | md (default) | lg
//
// Usage:
//   <Button onClick={fn}>Save</Button>
//   <Button variant="ghost" size="sm" onClick={fn}>Cancel</Button>
//   <Button variant="danger" disabled={busy}>Delete</Button>

import React from "react";
import { COLORS, RADII, SHADOWS } from "./tokens";

const SIZES = {
  sm: { padding: "6px 12px", fontSize: "0.85rem", radius: RADII.sm },
  md: { padding: "10px 16px", fontSize: "0.95rem", radius: RADII.md },
  lg: { padding: "12px 22px", fontSize: "1rem", radius: RADII.md },
};

const VARIANTS = {
  primary: {
    background: COLORS.primary,
    color: "#ffffff",
    border: `1px solid ${COLORS.primary}`,
    fontWeight: 700,
    boxShadow: SHADOWS.sm,
  },
  ghost: {
    background: "#ffffff",
    color: COLORS.textSecondary,
    border: `1px solid ${COLORS.borderStrong}`,
    fontWeight: 600,
  },
  danger: {
    background: COLORS.dangerBg,
    color: COLORS.danger,
    border: `1px solid ${COLORS.dangerBorder}`,
    fontWeight: 700,
  },
  subtle: {
    background: "transparent",
    color: COLORS.textSecondary,
    border: "1px solid transparent",
    fontWeight: 600,
  },
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  onClick,
  type = "button",
  style,
  title,
  ...rest
}) {
  const sz = SIZES[size] || SIZES.md;
  const vs = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{
        ...vs,
        padding: sz.padding,
        fontSize: sz.fontSize,
        borderRadius: sz.radius,
        lineHeight: 1.2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        whiteSpace: "nowrap",
        transition: "background 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
