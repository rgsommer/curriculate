// ============================================================
// Campfire Live — TypeScript Types
// ============================================================

export type EngagementType =
  | "poll"
  | "challenge"
  | "truth_or_dare"
  | "photo_pose"
  | "share"
  | "accountability"
  | "game"
  | "instant"
  | "anonymous_judge"
  | "guess"
  | "surprise"
  | "advice"
  | "voice_response"
  | "two_truths"
  | "baby_reveal"
  | "most_likely"
  | "scavenger_hunt"
  | "birthday"
  | "care"
  | "signup";

// A Sign-up slot: a label + how many people can claim it.
export type SignupSlot = { label: string; capacity: number };

// A Care Check-in question: a prompt + how people answer it.
export type CareQuestion = { prompt: string; kind: "text" | "star" };

// config.questions for a Care Check-in may be the new {prompt,kind} objects or a
// legacy string[] (treated as text). Normalise to CareQuestion[].
export function parseCareQuestions(config: unknown): CareQuestion[] {
  const raw = (config as { questions?: unknown })?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q): CareQuestion =>
      typeof q === "string"
        ? { prompt: q, kind: "text" }
        : {
            prompt: String((q as { prompt?: unknown })?.prompt ?? ""),
            kind: (q as { kind?: unknown })?.kind === "star" ? "star" : "text",
          }
    )
    .filter((q) => q.prompt.trim());
}

export type EngagementStatus = "active" | "sealed" | "revealed" | "expired";
export type RevealMode = "sealed" | "all_at_once" | "first_in" | "as_they_come" | "instant";
export type MemberRole = "admin" | "member" | "spectator";

// ── Row types ──
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  trial_ends_at: string;
  is_premium: boolean;
  stripe_customer_id: string | null;
  allow_random_guest: boolean;
  adult_content: boolean;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  creator_id: string;
  avatar_emoji: string;
  created_at: string;
  allow_member_invites?: boolean; // members (not just host) may invite others
  notify_on_response?: boolean; // member daily "new responses" digest (default on)
  notify_host?: boolean; // host-only daily digest of ALL activity (default on)
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  display_name?: string | null; // per-group name override (falls back to profile)
}

export interface Engagement {
  id: string;
  group_id: string;
  creator_id: string;
  type: EngagementType;
  title: string;
  description: string | null;
  config: Record<string, unknown>;
  deadline: string | null;
  reveal: RevealMode;
  is_blind: boolean;
  status: EngagementStatus;
  total_expected: number;
  recurrence_rule: string | null;
  parent_id: string | null;
  chain_next_creator_id: string | null;
  created_at: string;
  launched_at?: string | null; // null = draft (only the creator can see it)
  notify?: boolean; // email the group when launched
  hold_until_deadline?: boolean; // wait for the deadline to reveal (don't reveal early)
  wait_for_all_invited?: boolean; // wait until everyone invited has joined + responded
  allow_member_invites?: boolean; // members (not just host) may invite others to this
  excluded_user_ids?: string[]; // surprise: hidden from these members until reveal
  excluded_emails?: string[]; // surprise: exclude not-yet-joined people by email
  cover_image_url?: string | null; // the currently-shown cover (random from the pool)
  cover_image_urls?: string[]; // pool of covers — a random one is shown
  scheduled_open_at?: string | null; // auto-launch a draft at this time (birthday)
  lead_days?: number; // birthday: open this many days before the date
  birth_year?: number | null; // birthday: for the {age} title token
  share_code?: string | null; // short code for the friendly /c/<code> card link
  private_to_host?: boolean; // responses visible only to the author + the host
  allow_anon_replies?: boolean; // members may post replies/comments anonymously
  gift_enabled?: boolean; // collecting a group gift (chip-in toward a gift card)
  gift_recipient_email?: string | null;
  gift_recipient_name?: string | null;
  gift_issued_at?: string | null;
  lies_revealed_at?: string | null; // two_truths: phase-2 (lies + scores) revealed
  paused?: boolean; // host paused it: no emails go out + cron skips it until resumed
  // Joined: the originator's display name (for "Name's Type" headers)
  creator?: { display_name: string } | null;
}

export interface Response {
  id: string;
  engagement_id: string;
  user_id: string;
  content: Record<string, unknown>;
  rating: number | null;
  created_at: string;
  // Per-response visibility override: true = share with the group, false = keep
  // host-only, null/undefined = follow the engagement's private_to_host default.
  share_to_group?: boolean | null;
  // When shared to the group, hide the author's name from other members (the host
  // still sees it). UI-level only, like is_blind.
  anonymous?: boolean | null;
}

// Care Check-in: one row per answered question, each with its own visibility so a
// single prompt can be kept host-only while another is shared with the group.
export interface CareAnswer {
  id: string;
  engagement_id: string;
  response_id: string;
  user_id: string;
  q_index: number;
  value: string;
  // true = group-visible, false = host-only, null = follow engagement default.
  share_to_group?: boolean | null;
  // UI-level name mask for other group members (host + author still see the name).
  anonymous?: boolean | null;
  created_at: string;
  profile?: { display_name?: string };
}

export interface Reaction {
  id: string;
  response_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Comment {
  id: string;
  engagement_id: string;
  response_id: string | null;
  user_id: string;
  content: string;
  anonymous?: boolean;
  created_at: string;
}

export interface Nudge {
  id: string;
  engagement_id: string;
  from_user_id: string;
  to_user_id: string;
  created_at: string;
}

export interface Streak {
  user_id: string;
  group_id: string;
  current_streak: number;
  longest_streak: number;
  last_participated: string | null;
}

export interface Milestone {
  id: string;
  group_id: string;
  type: string;
  value: number;
  reached_at: string;
}

export interface Favourite {
  user_id: string;
  engagement_id: string;
  created_at: string;
}

// ── Enriched types (with joins) ──
export interface GroupWithMembers extends Group {
  members: (GroupMember & { profile: Profile })[];
  member_count: number;
}

export interface EngagementWithResponses extends Engagement {
  responses: (Response & { profile: Profile })[];
  response_count: number;
  creator: Profile;
}

export interface Rating {
  id: string;
  response_id: string;
  engagement_id: string;
  rater_id: string;
  score: number;
  created_at: string;
}

export interface RevealAnswer {
  engagement_id: string;
  answer: string;
}

export interface LieAnswer {
  engagement_id: string;
  response_id: string;
  lie_index: number;
}

export interface LieGuess {
  id: string;
  engagement_id: string;
  response_id: string;
  guesser_id: string;
  guess_index: number | null;
  author_guess?: string | null; // guessed author (user_id) — anonymous mode
}

export interface Invitation {
  id: string;
  group_id: string;
  email: string;
  name: string | null;
  invited_by: string | null;
  status: "pending" | "joined" | "revoked";
  created_at: string;
  joined_at: string | null;
  last_nudged_at: string | null;
  last_emailed_at?: string | null;
  nudge_count: number;
}

// ── Engagement type metadata ──
// `description` = factual (used in the create flow).
// `hook` = a short, enticing one-liner shown on cards to pull people in.
export const ENGAGEMENT_TYPES: Record<
  EngagementType,
  { icon: string; label: string; description: string; hook: string; color: string }
> = {
  poll: { icon: "📊", label: "Poll", description: "Multiple choice, yes/no, or open questions", hook: "Cast your vote — nobody sees the tally until everyone's in.", color: "bg-blue-50 text-blue-700" },
  challenge: { icon: "🏆", label: "Challenge", description: "Video, photo, or task-based challenges with deadlines", hook: "Show us what you've got — entries stay hidden until the big reveal.", color: "bg-amber-50 text-amber-700" },
  truth_or_dare: { icon: "🎯", label: "Truth or Dare", description: "Classic game with optional real stakes", hook: "Truth or dare? Lock in your answer before anyone else can peek.", color: "bg-red-50 text-red-700" },
  photo_pose: { icon: "📸", label: "Photo Pose", description: "Request a picture in a specific scenario", hook: "Strike the pose and snap it — every photo drops at the same moment.", color: "bg-pink-50 text-pink-700" },
  share: { icon: "💬", label: "Share", description: "Request a favourite recipe, memory, or anything meaningful", hook: "Share yours — everyone's reveals together, all at once.", color: "bg-green-50 text-green-700" },
  accountability: { icon: "🙏", label: "Accountability", description: "Structured check-in questions for distance groups", hook: "A quick, honest check-in — answers unlock together, no peeking.", color: "bg-violet-50 text-violet-700" },
  game: { icon: "♟️", label: "Game", description: "Turn-based games: chess, word games, spelling bees", hook: "Your move — jump in and play.", color: "bg-indigo-50 text-indigo-700" },
  instant: { icon: "🧠", label: "Instant", description: "Trivia, math, Pictionary — quick-fire fun", hook: "Quick-fire round — think fast and lock it in!", color: "bg-cyan-50 text-cyan-700" },
  anonymous_judge: { icon: "⚖️", label: "Anonymous Judge", description: "Submit entries anonymously, group rates blind", hook: "Submit anonymously and let the group judge blind.", color: "bg-slate-50 text-slate-700" },
  guess: { icon: "🔍", label: "Guess", description: "Post a mystery photo for the group to guess", hook: "Can you crack it? Take your guess before the reveal.", color: "bg-orange-50 text-orange-700" },
  surprise: { icon: "🎉", label: "Surprise", description: "Coordinate greetings hidden from the recipient", hook: "Add your bit to a surprise they'll never see coming. 🤫", color: "bg-yellow-50 text-yellow-700" },
  advice: { icon: "💡", label: "Advice", description: "Ask your group for counsel", hook: "Weigh in — the group wants your honest take.", color: "bg-teal-50 text-teal-700" },
  voice_response: { icon: "🎤", label: "Voice Response", description: "Leave voice notes instead of text", hook: "Say it out loud — drop a quick voice note.", color: "bg-rose-50 text-rose-700" },
  two_truths: { icon: "🕵️", label: "Two Truths & a Lie", description: "Everyone shares 3 statements — 2 true, 1 lie — then the group guesses the lie", hook: "Two truths and a lie — can the group spot your fib?", color: "bg-purple-50 text-purple-700" },
  baby_reveal: { icon: "🍼", label: "Baby Reveal", description: "Set the choices (Boy/Girl, name, date…); everyone guesses, and it unseals on the big day with winners", hook: "Place your guess — all is revealed on the big day!", color: "bg-sky-50 text-sky-700" },
  most_likely: { icon: "🏆", label: "Most Likely To…", description: "A set of awards — everyone votes a group-mate for each, sealed until the reveal, then crown the winners", hook: "Vote the awards — winners crowned at the reveal!", color: "bg-amber-50 text-amber-700" },
  scavenger_hunt: { icon: "🔍", label: "Scavenger Hunt", description: "List items/clues; players answer each with a photo or text, in any order. Sealed until you reveal", hook: "On the hunt — snap a photo or type your answer for each!", color: "bg-lime-50 text-lime-700" },
  signup: { icon: "📋", label: "Sign-up", description: "List slots (bring drinks, plates, music…); everyone claims what they'll cover. Live — see who's got what. Great for parties, potlucks, field trips", hook: "Claim a slot — see what's still needed!", color: "bg-cyan-50 text-cyan-700" },
  birthday: { icon: "🎂", label: "Birthday", description: "A surprise card everyone signs — hidden from the birthday person, opens before the day and reveals on it. Runs every year", hook: "Sign the card — it opens on the big day! 🎂", color: "bg-pink-50 text-pink-700" },
  care: { icon: "🤝", label: "Care Check-in", description: "One form with several sections — how you're doing, prayer requests, praise, reflection. Fill in any or all. Can be kept private to the host", hook: "Share what you'd like — fill any or all sections.", color: "bg-teal-50 text-teal-700" },
};

// Ordinal: 28 -> "28th", 21 -> "21st".
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Resolve a {age} token in a title from the stored birth year + the (reveal) date.
// "Happy {age} Birthday, Dad!" -> "Happy 28th Birthday, Dad!". With no birth year,
// the token is dropped cleanly ("Happy Birthday, Dad!").
export function resolveTitle(
  title: string,
  birthYear?: number | null,
  deadline?: string | null
): string {
  if (!title.includes("{age}")) return title;
  if (birthYear && deadline) {
    const age = new Date(deadline).getFullYear() - birthYear;
    if (age > 0) return title.replace(/\{age\}/g, ordinal(age));
  }
  return title.replace(/\{age\}\s*/g, "").replace(/\s{2,}/g, " ").trim();
}

// ── "Nth weekday of a month" dates (Mother's Day = 2nd Sun May, etc.) ──
// week: 1-4, or 5/-1 = "last". weekday: 0=Sun … 6=Sat. month: 1-12.
export type NthWeekday = { week: number; weekday: number; month: number };

export function nthWeekdayOfMonth(
  year: number,
  week: number,
  weekday: number,
  month: number,
  hour = 8
): Date {
  if (week === 5 || week === -1) {
    // Last <weekday> of the month.
    const last = new Date(year, month, 0); // day 0 of next month = last day
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month - 1, last.getDate() - offset, hour, 0, 0, 0);
  }
  const firstDow = new Date(year, month - 1, 1).getDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (week - 1) * 7;
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

// The next occurrence on or after `from` (this year if it hasn't passed, else next).
export function nextNthWeekday(p: NthWeekday, from: Date = new Date(), hour = 8): Date {
  const thisYear = nthWeekdayOfMonth(from.getFullYear(), p.week, p.weekday, p.month, hour);
  return thisYear.getTime() >= from.getTime()
    ? thisYear
    : nthWeekdayOfMonth(from.getFullYear() + 1, p.week, p.weekday, p.month, hour);
}

export const ORDINAL_WEEK = ["", "1st", "2nd", "3rd", "4th", "last"];
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function describeNthWeekday(p: NthWeekday): string {
  return `${ORDINAL_WEEK[p.week] || `${p.week}th`} ${WEEKDAY_NAMES[p.weekday]} of ${MONTH_NAMES[p.month]}`;
}

// The right emoji for an engagement: 🎂 only for an actual birthday; a holiday
// celebration card uses its preset emoji (💐/👔) or a generic 🎉.
export function engagementIcon(e: {
  type: string;
  config?: { occasion?: string } | null;
}): string {
  if (e.type === "birthday") {
    const occ = e.config?.occasion;
    if (!occ) return "🎂"; // a real birthday
    if (occ === "Anniversary") return "💍";
    const preset = Object.values(HOLIDAY_PRESETS).find((p) => p.label === occ);
    return preset ? preset.emoji : "🎉"; // preset holiday, else a generic celebration
  }
  return (
    (ENGAGEMENT_TYPES as Record<string, { icon: string }>)[e.type]?.icon ?? "🔥"
  );
}

// Built-in floating holidays (US/Canada).
export const HOLIDAY_PRESETS: Record<
  string,
  { label: string; emoji: string; nth: NthWeekday; titleHint: string }
> = {
  mothers_day: {
    label: "Mother's Day",
    emoji: "💐",
    nth: { week: 2, weekday: 0, month: 5 },
    titleHint: "Happy Mother's Day, Mom! 💐",
  },
  fathers_day: {
    label: "Father's Day",
    emoji: "👔",
    nth: { week: 3, weekday: 0, month: 6 },
    titleHint: "Happy Father's Day, Dad! 👔",
  },
};

// ── Supabase Database type (simplified — use supabase gen types for full version) ──
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; display_name: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      groups: {
        Row: Group;
        Insert: Partial<Group> & { name: string; creator_id: string };
        Update: Partial<Group>;
        Relationships: [];
      };
      group_members: {
        Row: GroupMember;
        Insert: GroupMember;
        Update: Partial<GroupMember>;
        Relationships: [];
      };
      engagements: {
        Row: Engagement;
        Insert: Partial<Engagement> & { group_id: string; creator_id: string; type: EngagementType; title: string };
        Update: Partial<Engagement>;
        Relationships: [];
      };
      responses: {
        Row: Response;
        Insert: Partial<Response> & { engagement_id: string; user_id: string; content: Record<string, unknown> };
        Update: Partial<Response>;
        Relationships: [];
      };
      reactions: {
        Row: Reaction;
        Insert: Partial<Reaction> & { response_id: string; user_id: string; emoji: string };
        Update: Partial<Reaction>;
        Relationships: [];
      };
      comments: {
        Row: Comment;
        Insert: Partial<Comment> & { engagement_id: string; user_id: string; content: string };
        Update: Partial<Comment>;
        Relationships: [];
      };
      nudges: {
        Row: Nudge;
        Insert: Partial<Nudge> & { engagement_id: string; from_user_id: string; to_user_id: string };
        Update: Partial<Nudge>;
        Relationships: [];
      };
      streaks: {
        Row: Streak;
        Insert: Streak;
        Update: Partial<Streak>;
        Relationships: [];
      };
      milestones: {
        Row: Milestone;
        Insert: Partial<Milestone> & { group_id: string; type: string; value: number };
        Update: Partial<Milestone>;
        Relationships: [];
      };
      favourites: {
        Row: Favourite;
        Insert: Favourite;
        Update: Partial<Favourite>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      engagement_type: EngagementType;
      engagement_status: EngagementStatus;
      reveal_mode: RevealMode;
    };
    CompositeTypes: Record<string, never>;
  };
}
