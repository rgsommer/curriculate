import type { EngagementType, RevealMode, CareQuestion } from "./types";

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
    | "once";
  onceLabel?: string;
}

export interface TemplatePack {
  id: string;
  name: string;
  emoji: string;
  templates: EngagementTemplate[];
}

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
        name: "Celebration Card 🎉",
        type: "birthday",
        title: "Happy {age} Birthday! 🎂",
        description:
          "A surprise card everyone signs — birthday, anniversary, Mother's/Father's Day. Hidden from the recipient, opens on the special day.",
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
    ],
  },
];
