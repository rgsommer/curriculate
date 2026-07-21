// Campfire Premium ("Campfire Plus") — single source of truth for the free/paid split.
//
// Principle: HOSTS pay; members and guests are always free. Gate scale and power
// (more groups, bigger groups, recurrence, analytics), never the core magic
// (weekly prompts + sealed reveals) — that's the viral hook.
//
// NOTE: enforcement is gated on `hasPremiumAccess` = is_premium OR an active trial.
// Everyone gets a trial on signup, so these limits are inert during the trial window
// and only start converting once a host's trial expires.

import type { Profile } from "./types";

// ── Free-tier limits (per host) ──
export const FREE_MAX_GROUPS = 1; // main conversion lever — teachers have several classes
export const FREE_MAX_MEMBERS_PER_GROUP = 40; // covers a full class; big teams convert

// ── Pricing (display only; real charge is the Stripe Price) ──
export const PLUS_PRICE_MONTHLY = "$4.99";
export const PLUS_PRICE_YEARLY = "$39.99";

// What Campfire Plus unlocks, in honest, enforceable terms.
export const PLUS_FEATURES: string[] = [
  "Unlimited groups (Free includes 1)",
  `Unlimited members per group (Free up to ${FREE_MAX_MEMBERS_PER_GROUP})`,
  "Recurring & scheduled engagements (weekly, monthly, auto-repeat)",
  "Advanced engagement types + early access to new ones",
  "Group analytics — participation & streaks",
  "Export to social media",
  "Remove Campfire branding",
  "Priority support",
];

// True when the host has full (paid or trial) access. Members/guests are never gated,
// so callers only apply this to host-side actions (creating groups, growing them, etc.).
export function hasPremiumAccess(
  profile: Pick<Profile, "is_premium" | "trial_ends_at"> | null | undefined
): boolean {
  if (!profile) return false;
  if (profile.is_premium) return true;
  if (profile.trial_ends_at) {
    return new Date(profile.trial_ends_at).getTime() > Date.now();
  }
  return false;
}
