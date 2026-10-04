import { createHmac } from "crypto";
import { QUICK_STARTS, quickStartDate } from "./templates";

// Dormant-group nudges (server only). Once a group has gone quiet, a few of its
// members are invited to start something — with one specific, seasonal idea and a
// one-tap link — instead of the host carrying the group alone.
//
// State lives in auth app_metadata (server-writable only, no schema change):
//   member: app_metadata.cf_nudge = { at, group, off? }  — last ask + "don't ask again"
//   host:   app_metadata.cf_nudge_off_groups = [groupId]   — groups the host opted out

export type NudgeMeta = { at?: string; group?: string; off?: boolean };

export const NUDGE_QUIET_DAYS = 30; // no responses / new activities for this long
export const NUDGE_GROUP_EVERY_DAYS = 30; // a group is nudged at most monthly
export const NUDGE_MEMBER_EVERY_DAYS = 90; // a person is asked at most once a quarter
export const NUDGE_SHARE = 0.075; // ~5–10% of members per round
export const NUDGE_MAX_PER_GROUP = 3;

// Signed one-tap "stop these suggestions" link — keyed to the user, server secret.
export function nudgeSig(userId: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "";
  return createHmac("sha256", key).update(`cf-nudge-optout:${userId}`).digest("base64url").slice(0, 32);
}

export type GroupKind = "church" | "school" | "general";

export function groupKind(g: { name: string; school?: string | null; description?: string | null }): GroupKind {
  if (g.school && g.school.trim()) return "school";
  const t = `${g.name} ${g.description ?? ""}`;
  if (/church|chapel|bible|small group|fellowship|ministry|parish|congregation|prayer|elders?\b|worship|youth group|sunday school/i.test(t))
    return "church";
  if (/class|school|grade|homeroom|staff room|teachers?\b|students?\b|PTA\b|PAC\b/i.test(t)) return "school";
  return "general";
}

export type Suggestion = {
  emoji: string;
  idea: string; // "a thank-you card for your pastor"
  why: string; // "Pastor Appreciation Sunday is Sunday, October 11."
  templateId?: string;
  quick?: boolean; // templateId has a one-tap start (QUICK_STARTS)
  type?: string; // fallback: a plain activity type (?type=)
  cta: string;
};

const mmdd = (d: Date) => (d.getMonth() + 1) * 100 + d.getDate();
const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

function quick(id: string, idea: string, why: (date: string) => string, cta: string): Suggestion {
  const q = QUICK_STARTS[id];
  return {
    emoji: q?.emoji ?? "💌",
    idea,
    why: why(q ? fmtDay(quickStartDate(q)) : ""),
    templateId: id,
    quick: !!q,
    cta,
  };
}

// One seasonal idea for this kind of group, today. Falls back to a quick poll.
export function dormantSuggestion(kind: GroupKind, now: Date = new Date()): Suggestion {
  const d = mmdd(now);
  const between = (a: number, b: number) => d >= a && d <= b;
  const christmas: Suggestion = {
    emoji: "🎄",
    idea: "a group Christmas card",
    why: "Everyone signs one card from a single link — perfect for someone who's had a hard year, or a thank-you to the whole group.",
    templateId: "christmas-card",
    cta: "🎄 Start a Christmas card",
  };
  if (kind === "church") {
    if (between(901, 1010))
      return quick(
        "pastor-appreciation",
        "a thank-you card for your pastor",
        (date) => `October is Pastor Appreciation Month — Pastor Appreciation Sunday is ${date}.`,
        "🙏 Start a card for your pastor"
      );
    if (between(1101, 1220)) return christmas;
    if (between(315, 418))
      return quick(
        "volunteer-appreciation",
        "a thank-you card for your volunteers",
        (date) => `National Volunteer Week starts ${date} — a great time to thank the people who serve.`,
        "🤝 Start a card for your volunteers"
      );
  }
  if (kind === "school") {
    if (between(915, 1005))
      return {
        emoji: "🙌",
        idea: "a thank-you card for your school staff",
        why: "World Teachers' Day is October 5 — thank a teacher, custodian, bus driver or EA.",
        templateId: "school-staff-appreciation",
        cta: "🙌 Start a thank-you card",
      };
    if (between(1101, 1220)) return christmas;
    if (between(310, 420))
      return quick(
        "admin-appreciation",
        "a thank-you card for your school office",
        (date) => `Administrative Professionals Day is ${date}.`,
        "💐 Start a card for the office"
      );
    if (between(421, 506))
      return quick(
        "teacher-appreciation",
        "a Teacher Appreciation card",
        (date) => `Teacher Appreciation Week starts ${date}.`,
        "🍎 Start a card for your teacher"
      );
    if (between(525, 625))
      return {
        emoji: "💌",
        idea: "a year-end thank-you card",
        why: "The school year's nearly done — everyone signs one card from a single link.",
        templateId: "thank-you-card",
        cta: "💌 Start a thank-you card",
      };
  }
  if (between(1101, 1220)) return christmas;
  return {
    emoji: "📊",
    idea: "a quick poll",
    why: "Ask the group something easy — where to meet next, a favourite memory, or what everyone's up to.",
    type: "poll",
    cta: "📊 Start a quick poll",
  };
}

// The one-tap link for a suggestion, pre-pointed at this group.
export function suggestionUrl(base: string, groupId: string, s: Suggestion): string {
  if (s.templateId && s.quick)
    return `${base}/campfirelive?start=${encodeURIComponent(s.templateId)}&group=${encodeURIComponent(groupId)}`;
  if (s.templateId)
    return `${base}/campfirelive/group/${groupId}/engagement/new?template=${encodeURIComponent(s.templateId)}`;
  return `${base}/campfirelive/group/${groupId}/engagement/new?type=${encodeURIComponent(s.type ?? "poll")}`;
}
