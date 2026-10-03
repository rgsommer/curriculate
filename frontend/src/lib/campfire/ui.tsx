// Campfire's small design system — the one place button, chip and field styling lives.
// Rules: every button is a pill; ONE primary recipe (the brand gradient); default size
// is 44px tall (a comfortable tap target); "sm" is for secondary actions inside rows.
// Use the class constants on any element (button, Link, a) or the components below.

import type { ButtonHTMLAttributes, ReactNode } from "react";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2";

const sizes = {
  md: "px-5 py-3 text-sm", // ≈44px tall
  sm: "px-3.5 py-2 text-xs",
} as const;

const variants = {
  primary: "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm hover:opacity-90",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
} as const;

export type CfVariant = keyof typeof variants;
export type CfSize = keyof typeof sizes;

export function cfBtn(variant: CfVariant = "primary", size: CfSize = "md"): string {
  return `${base} ${sizes[size]} ${variants[variant]}`;
}

// Prebuilt strings for static classNames (`className={`${CF_PRIMARY} w-full`}`).
export const CF_PRIMARY = cfBtn("primary", "md");
export const CF_PRIMARY_SM = cfBtn("primary", "sm");
export const CF_SECONDARY = cfBtn("secondary", "md");
export const CF_SECONDARY_SM = cfBtn("secondary", "sm");

// Text fields: 16px on phones (no iOS zoom), one border/focus treatment.
export const CF_INPUT =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base sm:text-sm text-slate-900 " +
  "placeholder:text-slate-400 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500";

export function CfButton({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: CfVariant; size?: CfSize }) {
  return <button type={type} className={`${cfBtn(variant, size)} ${className}`} {...rest} />;
}

// Status chips — one shape, a few meaningful tones (50 background, 700 text).
const tones = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  brand: "bg-orange-50 text-orange-700 border-orange-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  special: "bg-violet-50 text-violet-700 border-violet-200",
} as const;
export type ChipTone = keyof typeof tones;

export function chipClass(tone: ChipTone = "neutral"): string {
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`;
}

export function Chip({
  tone = "neutral",
  className = "",
  children,
  title,
}: {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={`${chipClass(tone)} ${className}`}>
      {children}
    </span>
  );
}
