// teacher-app/src/components/ui/Field.jsx
//
// Shared form primitives for the teacher app. Audit found textarea padding
// 8 vs 10, borderRadius 8 vs 10, borders 1px vs 1.5px, etc. Standardize.
//
// Components:
//   <Field label="Topic" hint="One sentence." required>
//     <TextInput value={topic} onChange={...} />
//   </Field>
//
//   <Field label="Vocabulary">
//     <TextArea value={vocab} onChange={...} rows={6} />
//   </Field>
//
// The Field wrapper owns the label + hint + spacing; the inner control
// (TextInput / TextArea) owns just the input.

import React from "react";
import { COLORS, RADII, SPACING, TYPE } from "./tokens";

const inputBase = {
  width: "100%",
  padding: "10px 12px",
  fontSize: TYPE.bodySize,
  fontFamily: "inherit",
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: RADII.md,
  background: COLORS.bg,
  color: COLORS.textPrimary,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const focusStyle = `1px solid ${COLORS.primary}`;
const focusShadow = "0 0 0 3px rgba(37,99,235,0.15)";

function applyFocus(e) {
  e.target.style.border = focusStyle;
  e.target.style.boxShadow = focusShadow;
}
function clearFocus(e) {
  e.target.style.border = inputBase.border;
  e.target.style.boxShadow = "none";
}

export function TextInput({ value, onChange, placeholder, disabled, style, type = "text", ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...inputBase,
        background: disabled ? COLORS.bgMuted : COLORS.bg,
        // Disabled text stays readable — avoid the old opacity-0.4 trick that
        // pushed contrast to ~2:1.
        color: disabled ? COLORS.textMuted : COLORS.textPrimary,
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
      {...rest}
    />
  );
}

export function TextArea({ value, onChange, placeholder, disabled, rows = 4, style, ...rest }) {
  return (
    <textarea
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...inputBase,
        background: disabled ? COLORS.bgMuted : COLORS.bg,
        color: disabled ? COLORS.textMuted : COLORS.textPrimary,
        cursor: disabled ? "not-allowed" : "text",
        resize: "vertical",
        minHeight: 80,
        lineHeight: 1.5,
        ...style,
      }}
      {...rest}
    />
  );
}

export function Select({ value, onChange, disabled, children, style, ...rest }) {
  return (
    <select
      value={value ?? ""}
      onChange={onChange}
      disabled={disabled}
      onFocus={applyFocus}
      onBlur={clearFocus}
      style={{
        ...inputBase,
        appearance: "none",
        background: disabled
          ? COLORS.bgMuted
          : `${COLORS.bg} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='%236b7280' d='M6 8L0 0h12z'/></svg>") no-repeat right 12px center`,
        paddingRight: 32,
        color: disabled ? COLORS.textMuted : COLORS.textPrimary,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export default function Field({ label, hint, required, htmlFor, children, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: TYPE.labelSize,
            fontWeight: 600,
            color: COLORS.textSecondary,
            marginBottom: 2,
          }}
        >
          {label}
          {required && <span style={{ color: COLORS.danger, marginLeft: 4 }} aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && (
        <div
          style={{
            fontSize: TYPE.hintSize,
            color: COLORS.textMuted,
            marginTop: 2,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
