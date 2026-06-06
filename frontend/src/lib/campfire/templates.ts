import type { EngagementType } from "./types";

// Ready-made engagements so a host can start one in a tap.
export interface EngagementTemplate {
  id: string;
  name: string;
  type: EngagementType;
  title: string;
  description?: string;
  options?: string[]; // poll choices
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
];
