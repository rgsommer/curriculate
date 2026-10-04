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

// Earned groups: free hosts unlock extra groups by running activities people actually
// answer. An activity "qualifies" once it's launched and has QUALIFYING_RESPONSES+
// responses (so empty activities can't be farmed). Each tier adds one group; capped at
// FREE_MAX_GROUPS + EARNED_GROUP_TIERS.length (3) — beyond that it's Campfire Plus.
export const QUALIFYING_RESPONSES = 3;
export const EARNED_GROUP_TIERS = [5, 15]; // qualifying activities for the 2nd, 3rd group

export function freeGroupAllowance(qualifying: number): {
  allowed: number; // groups a free host may host right now
  nextAt: number | null; // qualifying activities needed for the next one (null = maxed)
} {
  const earned = EARNED_GROUP_TIERS.filter((t) => qualifying >= t).length;
  const next = EARNED_GROUP_TIERS.find((t) => qualifying < t) ?? null;
  return { allowed: FREE_MAX_GROUPS + earned, nextAt: next };
}

// Flip to true once Campfire Plus checkout actually works. Until then every upgrade
// surface (trial banners, the Settings upgrade card) stays hidden — showing an
// "Upgrade" button that leads nowhere breaks trust.
export const CHECKOUT_LIVE = false;

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
