// Shared Compass UI primitives — one Card, one Button, one input class, so the
// teacher app stops re-inventing (and drifting on) radius/padding/shadow/focus.
import React from "react";

// ── Card ─────────────────────────────────────────────────────────────────────
export const cardCls = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`${cardCls} ${className}`.trim()}>{children}</section>;
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";

// ── Button ───────────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  success: "bg-green-700 text-white hover:bg-green-800",
  ghost: "text-slate-600 hover:text-slate-900",
};
const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

// Class string for cases where a <Link> or non-button needs to look like a button.
export function btnCls(variant: Variant = "primary", size: Size = "md", extra = "") {
  return [
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-400",
    SIZES[size], VARIANTS[variant], extra,
  ].join(" ").trim();
}

export function Button({
  variant = "primary", size = "md", className = "", type = "button", children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button type={type} className={btnCls(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
