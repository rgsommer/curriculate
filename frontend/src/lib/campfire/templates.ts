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
    | "once"
    | "wedding";
  onceLabel?: string;
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
      {
        id: "teacher-appreciation",
        name: "Teacher Appreciation 🍎",
        type: "birthday",
        title: "Thank you for all you do! 🍎",
        description:
          "A surprise card the class signs for a teacher during Teacher Appreciation Week. Notes stay hidden until it opens — add a group gift so everyone can chip in for a thank-you.",
        occasion: "once",
        onceLabel: "Teacher Appreciation",
        reveal: "sealed",
      },
      {
        id: "celebration-card",
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
        name: "Wedding Card 💒",
        type: "birthday",
        title: "Wishing you every happiness! 💒",
        description:
          "A surprise card the group signs for a couple's wedding — perfect for coworkers and friends, especially anyone who can't make it. Notes stay hidden until the wedding day. Add a group gift so everyone can chip in together, attending or not.",
        occasion: "wedding",
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
