import type { EngagementType, RevealMode, CareQuestion, NthWeekday } from "./types";

// Ready-made engagements so a host can start one in a tap.
export interface EngagementTemplate {
  id: string;
  name: string;
  type: EngagementType;
  title: string;
  description?: string;
  options?: string[]; // poll choices
  questions?: string[]; // accountability / most-likely / scavenger items
  careQuestions?: CareQuestion[]; // Care Check-in: prompt + response type per question
  reveal?: RevealMode; // override the default reveal mode (e.g. host-triggered)
  // For card (type "birthday") templates: which occasion to pre-select, and the
  // free-text label for a one-time card (e.g. "Year-End").
  occasion?:
    | "birthday"
    | "anniversary"
    | "mothers_day"
    | "fathers_day"
    | "custom"
    | "once"
    | "wedding";
  onceLabel?: string;
  // A one-time-style card that should come back every year on the same date
  // (e.g. Pastor Appreciation) — pre-ticks "Repeat every year".
  repeatsYearly?: boolean;
  // The note SIGNERS see on the card ("Note to signers"). `description` is written for
  // the host picking a template (it can list uses + tips like "paste the link in
  // Edsby"); this is the short, card-specific instruction everyone else reads.
  note?: string;
  // Sign-up templates: pre-filled claimable slots + optional party type.
  slots?: { label: string; capacity: number }[];
  partyKind?: string;
  // Pre-enable a gift exchange (Secret Santa) on a sign-up.
  giftExchange?: { byGender?: boolean; assign?: "self" | "person" | "gender" };
  // Pre-enable a Raffle Challenge: the chip-in pool goes to the voted winner.
  raffle?: boolean;
}

export interface TemplatePack {
  id: string;
  name: string;
  emoji: string;
  templates: EngagementTemplate[];
}

// If we're in a card "season", suggest the matching preset (surfaced on the
// dashboard). Returns null outside any window.
export function seasonalCardPrompt(
  now: Date = new Date()
): { templateId: string; emoji: string; headline: string } | null {
  const m = now.getMonth() + 1; // 1–12
  const d = now.getDate();
  if ((m === 11 && d >= 25) || (m === 12 && d <= 25))
    return {
      templateId: "christmas-card",
      emoji: "🎄",
      headline: "Christmas card season — sign one for someone special",
    };
  if (m === 4 && d >= 15)
    return {
      templateId: "admin-appreciation",
      emoji: "💐",
      headline: "Administrative Professionals Day is coming — start a card for your office staff",
    };
  if (m === 10 && d <= 14)
    return {
      templateId: "pastor-appreciation",
      emoji: "🙏",
      headline: "It's Pastor Appreciation Month — start a card for your pastor",
    };
  if (m === 5 && d <= 10)
    return {
      templateId: "teacher-appreciation",
      emoji: "🍎",
      headline: "Teacher Appreciation Week — start a class card",
    };
  if ((m === 5 && d >= 20) || m === 6)
    return {
      templateId: "thank-you-card",
      emoji: "💌",
      headline: "Year-end is here — start a thank-you card for a teacher or coach",
    };
  return null;
}

// Card-specific "note to signers", by occasion — what people read when they sign. One
// table so the create form, templates and old-data repair all agree. Never a list of
// every occasion: each card speaks only to its own.
const CARD_NOTES = {
  birthday: "Write your birthday wishes — they stay hidden until the card opens on the big day! 🎂",
  anniversary: "Write your anniversary wishes — they stay hidden until the card opens on the day. 💍",
  mothers_day: "Write your Mother's Day wishes — they stay hidden until the card opens on the day. 💐",
  fathers_day: "Write your Father's Day wishes — they stay hidden until the card opens on the day. 👔",
  wedding: "Write your wishes for the couple — they stay hidden until the wedding day. 💒",
  teacher:
    "Tell your teacher what you appreciate — a favourite lesson, something they helped you with, or simply thank you. It stays hidden until the card opens. 🍎",
  thanks: "Write a thank-you note — what you're grateful for this year. It stays hidden until the card opens. 💌",
  coach:
    "Thank your coach for the season — a favourite moment or something they taught you. It stays hidden until the card opens. 🏆",
  christmas: "Write your Christmas wishes — they stay hidden until the card opens on the day. 🎄",
  getwell:
    "Send your get-well wishes — they stay hidden until the card opens, then arrive all at once to lift their spirits. 🌻",
  farewell:
    "Write your goodbye — a favourite memory or a wish for what's next. It stays hidden until the card opens. 👋",
  pastor:
    "Thank your pastor — a sermon that stayed with you, a time he was there for you, or simply what he means to the church. It stays hidden until the card opens. 🙏",
  admin:
    "Thank them for everything they keep running — a time they helped you out, or what they make easier every day. It stays hidden until the card opens. 💐",
  staff:
    "Say thank you for the work that keeps the school going — a kindness you noticed or something they do every day. It stays hidden until the card opens. 🙌",
  volunteer:
    "Thank them for giving their time — something they did that made a difference. It stays hidden until the card opens. 🤝",
  class:
    "Add your note to the card — a thank-you, a favourite memory, or a kind wish. Just your name, no account needed. Only they'll see it, when the card opens. 💌",
  general: "Write your note — it stays hidden until the card opens on the day. 🎉",
} as const;

// Every default note (current + the old generic type default), so callers can tell a
// note the host hasn't touched from one they wrote themselves.
export const DEFAULT_CARD_NOTES: string[] = [
  ...Object.values(CARD_NOTES),
  "Sign the card with your birthday wishes — it opens on the big day!",
];

// The right signer note for a card, from its occasion (and the one-time label / title
// when the occasion is a free-form "once" card).
export function cardNoteFor(
  occasion: string | null | undefined,
  label?: string | null,
  title?: string | null
): string {
  switch (occasion) {
    case "birthday":
      return CARD_NOTES.birthday;
    case "anniversary":
      return CARD_NOTES.anniversary;
    case "mothers_day":
      return CARD_NOTES.mothers_day;
    case "fathers_day":
      return CARD_NOTES.fathers_day;
    case "wedding":
      return CARD_NOTES.wedding;
  }
  const t = `${label ?? ""} ${title ?? ""}`;
  if (/father'?s day/i.test(t)) return CARD_NOTES.fathers_day;
  if (/mother'?s day/i.test(t)) return CARD_NOTES.mothers_day;
  if (/birthday/i.test(t)) return CARD_NOTES.birthday;
  if (/anniversar/i.test(t)) return CARD_NOTES.anniversary;
  if (/pastor|clergy|minister|reverend|\bpriest/i.test(t)) return CARD_NOTES.pastor;
  if (/secretar|administrative|\badmin\b|office (staff|manager|team)/i.test(t)) return CARD_NOTES.admin;
  if (/custodian|caretaker|bus driver|lunch (staff|hero)|crossing guard|support staff|educational assistant|\bEAs?\b|librarian/i.test(t))
    return CARD_NOTES.staff;
  if (/volunteer/i.test(t)) return CARD_NOTES.volunteer;
  if (/teacher|\bmr\.?\s|\bmrs\.?\s|\bms\.?\s|\bmiss\s/i.test(t)) return CARD_NOTES.teacher;
  if (/coach|season/i.test(t)) return CARD_NOTES.coach;
  if (/christmas|holiday/i.test(t)) return CARD_NOTES.christmas;
  if (/get well|recover/i.test(t)) return CARD_NOTES.getwell;
  if (/farewell|miss you|goodbye|retire/i.test(t)) return CARD_NOTES.farewell;
  if (/year-?end|thank/i.test(t)) return CARD_NOTES.thanks;
  if (/class/i.test(t)) return CARD_NOTES.class;
  return CARD_NOTES.general;
}

// One-tap starts for a ?start=<template> link. Everything is preset (date, privacy,
// yearly repeat) — the person types only their group and the honoree's name, and the
// card opens live, ready to share. "More options" falls back to the full editor.
export interface QuickStart {
  templateId: string;
  emoji: string;
  heading: string;
  groupLabel: string;
  groupPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailHint: string;
  occasion: string; // config.occasion
  nth: NthWeekday; // reveals on the next one of these, at 8:00 AM
  dateLabel: string; // "the 2nd Sunday of October"
  title: (name: string) => string;
  note: string;
  ctaLabel: string;
}

export const QUICK_STARTS: Record<string, QuickStart> = {
  "pastor-appreciation": {
    templateId: "pastor-appreciation",
    emoji: "🙏",
    heading: "Start a thank-you card for your pastor",
    groupLabel: "Your church or small group",
    groupPlaceholder: "e.g. Grace Community Church",
    nameLabel: "Your pastor's name",
    namePlaceholder: "e.g. Pastor Bill",
    emailLabel: "His email (optional)",
    emailHint: "So he gets the card on the day. No email? Skip it — you can send him the card link yourself.",
    occasion: "Pastor Appreciation",
    nth: { week: 2, weekday: 0, month: 10 },
    dateLabel: "the 2nd Sunday of October",
    title: (name) => `Thank you, ${name}! 🙏`,
    note:
      "Thank your pastor — a sermon that stayed with you, a time he was there for you, or simply what he means to the church. It stays hidden until the card opens. 🙏",
    ctaLabel: "🙏 Create the card",
  },
};

// Wording for "invite others to start their OWN card" shares (a ?start=<template>
// link), per card template — who it's for and what they'd name their group.
export function startShareCopy(templateId: string): {
  heading: string;
  forWhom: string; // "your pastor"
  groupExample: string; // "your church or small group"
  emoji: string;
} {
  const m: Record<string, { what: string; forWhom: string; group: string; emoji: string }> = {
    "pastor-appreciation": { what: "a Pastor Appreciation card for your church", forWhom: "your pastor", group: "your church or small group", emoji: "🙏" },
    "teacher-appreciation": { what: "a Teacher Appreciation card for your class", forWhom: "your teacher", group: "your class", emoji: "🍎" },
    "admin-appreciation": { what: "a thank-you card for your school office staff", forWhom: "your office staff", group: "your school or staff room", emoji: "💐" },
    "school-staff-appreciation": { what: "a thank-you card for your school staff", forWhom: "them", group: "your class or school", emoji: "🙌" },
    "volunteer-appreciation": { what: "a thank-you card for a volunteer", forWhom: "your volunteer", group: "your team, club or church", emoji: "🤝" },
    "coach-gift": { what: "a thank-you card for your coach", forWhom: "your coach", group: "your team", emoji: "🏆" },
    "get-well-card": { what: "a get-well card", forWhom: "them", group: "your family or friends", emoji: "🌻" },
    "farewell-card": { what: "a farewell card", forWhom: "them", group: "your workplace or friends", emoji: "👋" },
    "christmas-card": { what: "a Christmas card", forWhom: "them", group: "your family or friends", emoji: "🎄" },
  };
  const c = m[templateId] ?? { what: "a group thank-you card", forWhom: "them", group: "your group", emoji: "💌" };
  return {
    heading: `Start ${c.what} ${c.emoji}`,
    forWhom: c.forWhom,
    groupExample: c.group,
    emoji: c.emoji,
  };
}

// "Pass it on" — the card to suggest right after someone signs or receives one. In a
// card season (Teacher Appreciation Week, year-end, December) it's that season's card,
// with stronger copy; otherwise it matches what they just signed (teacher → teacher
// card, coach → coach card, anything else → a thank-you card). Used by the activity
// page and the card emails, so both suggest the same thing.
export function passItOnCard(
  title: string,
  now: Date = new Date()
): { templateId: string; emoji: string; seasonLine: string | null } {
  // Match the card they just signed first — a teacher card suggests a teacher card
  // even in Pastor Appreciation season. The season line still shows when the matched
  // card IS the seasonal one; unmatched cards fall back to the season's card.
  const season = seasonalCardPrompt(now);
  const pick = (templateId: string, emoji: string) => ({
    templateId,
    emoji,
    seasonLine: season && season.templateId === templateId ? season.headline : null,
  });
  if (/\bcoach/i.test(title)) return pick("coach-gift", "🏆");
  if (/pastor|clergy|minister|reverend/i.test(title)) return pick("pastor-appreciation", "🙏");
  if (/secretar|administrative|office staff/i.test(title)) return pick("admin-appreciation", "💐");
  if (/\bteach|\bclass\b|\bmr\.?\s|\bmrs\.?\s|\bms\.?\s|\bmiss\s|\bmadame?\b|\bsir\b/i.test(title))
    return pick("teacher-appreciation", "🍎");
  if (season) return { templateId: season.templateId, emoji: season.emoji, seasonLine: season.headline };
  return pick("thank-you-card", "💌");
}

// Teacher Appreciation card — listed in both the Classroom pack (where teachers look)
// and the Cards pack; one definition so they never drift apart.
const TEACHER_APPRECIATION_CARD: EngagementTemplate = {
  id: "teacher-appreciation",
  note:
    "Tell your teacher what you appreciate — a favourite lesson, something they helped you with, or simply thank you. It stays hidden until the card opens. 🍎",
  name: "Teacher Appreciation 🍎",
  type: "birthday",
  title: "Thank you for all you do! 🍎",
  description:
    "A surprise thank-you card the class signs for a teacher. Paste the join link in Edsby — students add a note with just their name, and each one stays hidden until it opens. Add a group gift so everyone can chip in.",
  occasion: "once",
  onceLabel: "Teacher Appreciation",
  reveal: "sealed",
};

const PASTOR_APPRECIATION_CARD: EngagementTemplate = {
  id: "pastor-appreciation",
  note:
    "Thank your pastor — a sermon that stayed with you, a time he was there for you, or simply what he means to the church. It stays hidden until the card opens. 🙏",
  name: "Pastor Appreciation 🙏",
  type: "birthday",
  title: "Thank you, Pastor! 🙏",
  description:
    "A surprise card the congregation signs for your pastor — perfect for Pastor Appreciation Month (October). Share one link; each note stays hidden until it opens. Add a group gift so everyone can chip in.",
  occasion: "once",
  onceLabel: "Pastor Appreciation",
  repeatsYearly: true,
  reveal: "sealed",
};

const ADMIN_APPRECIATION_CARD: EngagementTemplate = {
  id: "admin-appreciation",
  note:
    "Thank them for everything they keep running — a time they helped you out, or what they make easier every day. It stays hidden until the card opens. 💐",
  name: "Secretary & Office Staff 💐",
  type: "birthday",
  title: "Thank you for keeping it all running! 💐",
  description:
    "A surprise thank-you card for your school secretary or office staff — great for Administrative Professionals Day (late April). Staff and students sign from one link; notes stay hidden until it opens.",
  occasion: "once",
  onceLabel: "Office Staff Appreciation",
  reveal: "sealed",
};

const SCHOOL_STAFF_CARD: EngagementTemplate = {
  id: "school-staff-appreciation",
  note:
    "Say thank you for the work that keeps the school going — a kindness you noticed or something they do every day. It stays hidden until the card opens. 🙌",
  name: "School Staff 🙌",
  type: "birthday",
  title: "Thank you for all you do for our school! 🙌",
  description:
    "A surprise thank-you card for the people who keep the school going — a custodian, bus driver, educational assistant or lunch staff. Paste the link in Edsby; notes stay hidden until it opens.",
  occasion: "once",
  onceLabel: "Staff Appreciation",
  reveal: "sealed",
};

const VOLUNTEER_APPRECIATION_CARD: EngagementTemplate = {
  id: "volunteer-appreciation",
  note:
    "Thank them for giving their time — something they did that made a difference. It stays hidden until the card opens. 🤝",
  name: "Volunteer Appreciation 🤝",
  type: "birthday",
  title: "Thank you for giving your time! 🤝",
  description:
    "A surprise card the group signs for a volunteer — at church, school, a team or a club. Great for National Volunteer Week (April). Each note stays hidden until it opens.",
  occasion: "once",
  onceLabel: "Volunteer Appreciation",
  reveal: "sealed",
};

export const TEMPLATE_PACKS: TemplatePack[] = [
  {
    id: "icebreaker",
    name: "Icebreakers",
    emoji: "🧊",
    templates: [
      {
        id: "two-truths",
        name: "Two Truths & a Lie",
        type: "two_truths",
        title: "Two truths and a lie — what are yours?",
        description:
          "Share three statements about yourself — two true, one a lie. We'll all guess the lie!",
      },
      {
        id: "wyr",
        name: "Would You Rather",
        type: "poll",
        title: "Would you rather…?",
        description: "Pick one!",
        options: ["Option A", "Option B"],
      },
      {
        id: "one-word",
        name: "One Word",
        type: "share",
        title: "Describe your week in one word.",
      },
    ],
  },
  {
    id: "classroom",
    name: "Classroom",
    emoji: "🎓",
    templates: [
      {
        id: "exit-ticket",
        name: "Exit Ticket",
        type: "share",
        title: "What's one thing you learned today?",
        description: "A quick exit ticket — answer before you leave.",
      },
      {
        id: "muddiest",
        name: "Muddiest Point",
        type: "share",
        title: "What's still confusing you?",
        description: "Tell me the muddiest point so I can clear it up.",
      },
      {
        id: "quick-check",
        name: "Understanding Check",
        type: "poll",
        title: "How well do you understand today's topic?",
        options: ["Got it!", "Mostly", "Still fuzzy", "Lost"],
      },
      {
        id: "math-quickfire",
        name: "Quick-Fire",
        type: "instant",
        title: "Solve: what is 7 × 8?",
        description: "First in with the right answer wins!",
      },
      {
        id: "scavenger",
        name: "Scavenger Hunt 🔎",
        type: "scavenger_hunt",
        title: "Classroom scavenger hunt 🔎",
        description:
          "Find each item and snap a photo or type your answer — sealed until we reveal together.",
        questions: [
          "Something red",
          "A right angle in the room",
          "A word with 4 syllables",
          "Something older than you",
        ],
      },
      {
        id: "read-aloud",
        name: "Read Aloud 🎤",
        type: "voice_response",
        title: "Record your answer 🎤",
        description: "Leave a quick voice note instead of typing it out.",
      },
      TEACHER_APPRECIATION_CARD,
      ADMIN_APPRECIATION_CARD,
      SCHOOL_STAFF_CARD,
      {
        id: "class-card",
        note:
          "Add your note to the card — a thank-you, a favourite memory, or a kind wish. Just your name, no account needed. Only they'll see it, when the card opens. 💌",
        name: "Class Card 💌",
        type: "birthday",
        title: "A card from the class 💌",
        description:
          "The class signs a surprise card together — for a teacher, a classmate's birthday, a farewell, or a get-well. Paste the join link in Edsby and students add their note with just a name — each message stays hidden until it opens.",
        occasion: "once",
        onceLabel: "Class Card",
        reveal: "sealed",
      },
    ],
  },
  {
    id: "family",
    name: "Family Night",
    emoji: "🎮",
    templates: [
      {
        id: "silly-face",
        name: "Photo Challenge",
        type: "photo_pose",
        title: "Snap your silliest face!",
      },
      {
        id: "memory",
        name: "Favourite Memory",
        type: "share",
        title: "Share a favourite family memory.",
      },
      {
        id: "dinner-vote",
        name: "Dinner Vote",
        type: "poll",
        title: "What's for dinner this weekend?",
        options: ["Pizza", "Tacos", "Pasta", "BBQ"],
      },
      {
        id: "birthday-card",
        note:
          "Write your birthday wishes — they stay hidden until the card opens on the big day! 🎂",
        name: "Celebration Card 🎉",
        type: "birthday",
        title: "Happy {age} Birthday! 🎂",
        description:
          "A surprise card everyone signs — birthday, anniversary, Mother's/Father's Day. Hidden from the recipient, opens on the special day.",
      },
      {
        id: "party-potluck",
        name: "Party Sign-up 📋",
        type: "signup",
        title: "What can you bring? 🎉",
        description:
          "Everyone claims what they'll bring — see what's still needed, live. Ask AI to fill in plates, cups, and more as people sign up.",
        partyKind: "Potluck",
        slots: [
          { label: "Main dish", capacity: 2 },
          { label: "Side / salad", capacity: 2 },
          { label: "Dessert", capacity: 2 },
          { label: "Drinks", capacity: 1 },
        ],
      },
      {
        id: "christmas-party",
        name: "Christmas Party + Secret Santa 🎄🎁",
        type: "signup",
        title: "Christmas party! 🎄",
        description:
          "Plan the Christmas party — claim what to bring, RSVP who's coming, and run a Secret Santa. Each person's assignment stays secret until the host reveals it.",
        partyKind: "Snacks",
        slots: [
          { label: "Treats / cookies", capacity: 2 },
          { label: "Drinks / juice", capacity: 2 },
          { label: "Cups & plates", capacity: 1 },
          { label: "Decorations", capacity: 1 },
        ],
        // Secret Santa by default; the host can switch to by-gender on the page.
        giftExchange: { assign: "person" },
      },
      {
        id: "baby-guesses",
        name: "Baby Name Guesses 🍼",
        type: "baby_reveal",
        title: "Guess our baby's name + gender 🍼",
        description:
          "Suggest a boy name and a girl name, and guess the gender — sealed until the big reveal! Just for fun (set the reveal date next).",
      },
    ],
  },
  {
    id: "faith",
    name: "Bible Study",
    emoji: "📖",
    templates: [
      {
        id: "verse-reflection",
        name: "Verse Reflection",
        type: "share",
        title: "What stood out to you in this week's passage?",
      },
      {
        id: "accountability",
        name: "Accountability Check-in",
        type: "accountability",
        title: "Weekly accountability check-in",
        description:
          "Answer honestly — you can set responses to blind.\n\n1. Have you kept up with daily prayer/reading?\n2. Have you guarded your heart and eyes this week?\n3. Have you invested in your closest relationships?",
      },
      {
        id: "gratitude",
        name: "Gratitude",
        type: "share",
        title: "What are you thankful for this week?",
      },
      {
        id: "ask-counsel",
        name: "Ask the Group 💡",
        type: "advice",
        title: "I'd value your counsel on…",
        description:
          "Share something you're weighing — the group offers honest, caring input.",
      },
      PASTOR_APPRECIATION_CARD,
    ],
  },
  {
    id: "group-care",
    name: "Group Care",
    emoji: "🤝",
    templates: [
      {
        id: "care-checkin",
        name: "Care Check-in",
        type: "care",
        title: "Weekly care check-in 🤝",
        description:
          "Fill in any or all below — a quick rating plus space to share as much or as little as you'd like.",
        // A mix: a star rating + free-text sections.
        careQuestions: [
          { prompt: "How are you doing this week? (1 = struggling, 5 = thriving)", kind: "star" },
          { prompt: "How is your walk with the Lord? (1–5)", kind: "star" },
          { prompt: "Anything you'd value prayer or support for?", kind: "text" },
          { prompt: "A praise — where have you seen God at work?", kind: "text" },
        ],
        // Surfaces as people respond so the host can follow up right away.
        reveal: "as_they_come",
      },
      {
        id: "wellness-pulse",
        name: "Wellness Pulse",
        type: "poll",
        title: "How are you doing this week?",
        options: ["🔥 Thriving", "🙂 Good", "😐 Surviving", "😔 Struggling", "🆘 Need support"],
      },
      {
        id: "thank-you-card",
        note:
          "Write a thank-you note — what you're grateful for this year. It stays hidden until the card opens. 💌",
        name: "Thank-You Card 💌",
        type: "birthday",
        title: "Thank you so much! 💌",
        description:
          "A surprise card the whole group signs — perfect for year-end, Christmas, or saying thanks to a teacher, coach, or leader. Each note stays hidden from them until it opens. Add a group gift to chip in together.",
        occasion: "once",
        onceLabel: "Year-End",
        // A card holds until the date and opens for the recipient then.
        reveal: "sealed",
      },
      TEACHER_APPRECIATION_CARD,
      PASTOR_APPRECIATION_CARD,
      ADMIN_APPRECIATION_CARD,
      VOLUNTEER_APPRECIATION_CARD,
      {
        id: "celebration-card",
        note:
          "Write your wishes — they stay hidden until the card opens on the day. 🎉",
        name: "Celebration Card 🎂",
        type: "birthday",
        title: "A card for someone special 🎉",
        description:
          "Everyone secretly signs the card — each wish stays private until it opens on the day. Add a group gift to chip in together.",
        occasion: "birthday",
        reveal: "sealed",
      },
      {
        id: "coach-gift",
        note:
          "Thank your coach for the season — a favourite moment or something they taught you. It stays hidden until the card opens. 🏆",
        name: "Coach Thank-You 🏆",
        type: "birthday",
        title: "Thanks for a great season, Coach! 🏆",
        description:
          "An end-of-season surprise card the team signs for their coach. Add a group gift so the team can chip in together.",
        occasion: "once",
        onceLabel: "End of Season",
        reveal: "sealed",
      },
      {
        id: "christmas-card",
        note:
          "Write your Christmas wishes — they stay hidden until the card opens on the day. 🎄",
        name: "Christmas Card 🎄",
        type: "birthday",
        title: "Merry Christmas! 🎄",
        description:
          "A surprise Christmas card the group signs for someone special — opens on the day. Add a group gift to send a gift card together.",
        occasion: "once",
        onceLabel: "Christmas",
        reveal: "sealed",
      },
      {
        id: "wedding-card",
        note:
          "Write your wishes for the couple — they stay hidden until the wedding day. 💒",
        name: "Wedding Card 💒",
        type: "birthday",
        title: "Wishing you every happiness! 💒",
        description:
          "A surprise card the group signs for a couple's wedding — perfect for coworkers and friends, especially anyone who can't make it. Notes stay hidden until the wedding day. Add a group gift so everyone can chip in together, attending or not.",
        occasion: "wedding",
        reveal: "sealed",
      },
      {
        id: "get-well-card",
        note:
          "Send your get-well wishes — they stay hidden until the card opens, then arrive all at once to lift their spirits. 🌻",
        name: "Get Well Card 🌻",
        type: "birthday",
        title: "Get well soon! 🌻",
        description:
          "A surprise card the group signs for someone who's unwell or recovering — each note stays hidden until it opens, then arrives all at once to lift their spirits. Add a group gift to send flowers or a gift card together.",
        occasion: "once",
        onceLabel: "Get Well",
        reveal: "sealed",
      },
      {
        id: "farewell-card",
        note:
          "Write your goodbye — a favourite memory or a wish for what's next. It stays hidden until the card opens. 👋",
        name: "Farewell Card 👋",
        type: "birthday",
        title: "We'll miss you! 👋",
        description:
          "A surprise send-off card the group signs for someone moving on — a coworker, classmate, or friend who's leaving or relocating. Notes stay hidden until it opens. Add a group gift so everyone can chip in for a parting gift.",
        occasion: "once",
        onceLabel: "Farewell",
        reveal: "sealed",
      },
      {
        id: "meal-train",
        name: "Meal Train 🍲",
        type: "signup",
        title: "Bring a meal 🍲",
        description:
          "Rally the group to bring meals for someone who needs support (a new baby, illness, loss). People claim a day — see what's still open, live.",
        partyKind: "Full meal",
        slots: [
          { label: "Meal — day 1", capacity: 1 },
          { label: "Meal — day 2", capacity: 1 },
          { label: "Meal — day 3", capacity: 1 },
          { label: "Meal — day 4", capacity: 1 },
        ],
      },
      {
        id: "secret-greeting",
        name: "Secret Greeting 🤫",
        type: "surprise",
        title: "Add a secret note 🤫",
        description:
          "Everyone adds a greeting hidden from the recipient — it all opens for them at the reveal. Use 'Hide from…' next to pick who it's a surprise for.",
      },
    ],
  },
  {
    id: "games-awards",
    name: "Games & Awards",
    emoji: "🎲",
    templates: [
      {
        id: "hall-of-fame",
        name: "Hall of Fame Superlatives 🏅",
        type: "hall_of_fame",
        title: "Hall of Fame Superlatives 🏅",
        description:
          "Vote a group-mate for each award — sealed until the reveal, then a graph crowns every winner.",
        questions: [
          "Best Dressed",
          "Funniest",
          "Kindest",
          "Best Hair",
          "Best Smile",
          "Class Clown",
          "Most Creative",
          "Most Likely to Be Famous",
        ],
      },
      {
        id: "most-likely",
        name: "Most Likely To…",
        type: "hall_of_fame",
        title: "Most Likely To… 🏆",
        description: "Vote a group-mate for each — sealed until the reveal!",
        questions: [
          "Most likely to change the world",
          "Most likely to become famous",
          "Most likely to start a business",
          "Always makes everyone laugh",
          "The friend you can always count on",
          "Most likely to win a reality show",
        ],
      },
      {
        id: "guess-who",
        name: "Mystery Photo 🔍",
        type: "guess",
        title: "Guess what this is 🔍",
        description:
          "Post a close-up or mystery shot — everyone takes their best guess before the reveal.",
      },
      {
        id: "truth-or-dare",
        name: "Truth or Dare 🎯",
        type: "truth_or_dare",
        title: "Truth or Dare?",
        description:
          "Pick truth or dare before you see the prompt — then everyone reveals together.",
      },
      {
        id: "blind-vote",
        name: "Blind Talent Vote ⚖️",
        type: "anonymous_judge",
        title: "Submit your entry — judged blind ⚖️",
        description:
          "Everyone submits anonymously; the group rates them with no names attached. Best entry wins.",
      },
      {
        id: "leaderboard",
        name: "Game-Night Leaderboard ⛳",
        type: "tournament",
        title: "Score leaderboard ⛳",
        description:
          "Enter your score each round — lowest (golf) or highest total wins. Add a prize if you like!",
        questions: ["Round 1", "Round 2", "Round 3"],
      },
      {
        id: "group-game",
        name: "Group Game ♟️",
        type: "game",
        title: "Let's play ♟️",
        description: "A turn-based game for the group — jump in and take your move.",
      },
    ],
  },
  {
    id: "prize-challenges",
    name: "Prize & Fundraisers",
    emoji: "🏆",
    templates: [
      {
        id: "raffle-challenge",
        name: "Raffle Challenge",
        type: "challenge",
        title: "Best photo of your catch this season 🎣",
        description:
          "Post your best entry. Everyone chips in to the pot all season — when it closes, the group votes and the winner takes the gift card.",
        raffle: true,
      },
      {
        id: "raffle-draw",
        name: "Raffle Draw",
        type: "raffle_draw",
        title: "Family Raffle 🎟️",
        description:
          "Chip in for a chance to win the pot — a winner is drawn at the end!",
      },
      {
        id: "pledge-drive",
        name: "Pledge Drive",
        type: "pledge_drive",
        title: "Read-A-Thon 🎗️",
        description:
          "Sponsor my challenge! Pledge a lump sum or per page — you only pay for what's achieved.",
      },
    ],
  },
];
