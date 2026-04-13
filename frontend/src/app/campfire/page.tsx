"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──
type EngType =
  | "poll"
  | "challenge"
  | "truth-dare"
  | "photo"
  | "share"
  | "accountability"
  | "game"
  | "trivia"
  | "judge"
  | "guess"
  | "surprise"
  | "advice";

type Screen =
  | "home"
  | "group"
  | "poll"
  | "challenge"
  | "truth-dare"
  | "photo"
  | "share"
  | "accountability"
  | "game"
  | "trivia"
  | "judge"
  | "guess"
  | "surprise"
  | "advice"
  | "favs"
  | "notifs"
  | "profile"
  | "templates"
  | "template-detail";

interface Member {
  name: string;
  color: string;
  done: boolean;
}

interface Engagement {
  id: number;
  type: EngType;
  title: string;
  by: string;
  time: string;
  responses: number;
  total: number;
  recurring?: "daily" | "weekly" | "monthly";
  options?: string[];
  votes?: number[];
  desc?: string;
  deadline?: string;
  submitted?: Member[];
  questions?: string[];
  winner?: string;
  stakes?: string;
}

interface Group {
  id: number;
  name: string;
  members: string[];
  engagements: Engagement[];
  streak?: number;
  health?: number;
  completedCount?: number;
  spectators?: number;
}

interface Template {
  id: number;
  name: string;
  emoji: string;
  desc: string;
  engagements: Engagement[];
}

// ── Data ──
const COLORS = [
  "#6C5CE7",
  "#00B894",
  "#E17055",
  "#0984E3",
  "#FD79A8",
  "#FDCB6E",
  "#A29BFE",
  "#636E72",
];

const groups: Group[] = [
  {
    id: 1,
    name: "Family Circle",
    members: ["RS", "MJ", "KS", "TS", "AS"],
    streak: 12,
    health: 85,
    completedCount: 45,
    spectators: 2,
    engagements: [
      {
        id: 1,
        type: "poll",
        title: "Where should we go for Thanksgiving?",
        by: "MJ",
        time: "2h ago",
        responses: 3,
        total: 5,
        recurring: "weekly",
        options: [
          "Grandma's house",
          "Beach cabin rental",
          "Stay home potluck",
          "Restaurant downtown",
        ],
        votes: [2, 1, 0, 0],
      },
      {
        id: 2,
        type: "challenge",
        title: "Make a prize-winning breakfast from scratch",
        by: "RS",
        time: "1d ago",
        responses: 4,
        total: 5,
        desc: "No mixes, no frozen items. Must include protein, carbs, and fruit. Post a photo of the final plate!",
        deadline: "18 hours remaining",
        winner: "MJ",
        submitted: [
          { name: "MJ", color: COLORS[1], done: true },
          { name: "KS", color: COLORS[2], done: true },
          { name: "TS", color: COLORS[3], done: true },
          { name: "AS", color: COLORS[4], done: false },
        ],
      },
      {
        id: 3,
        type: "surprise",
        title: "Birthday surprise for KS",
        by: "RS",
        time: "3d ago",
        responses: 4,
        total: 4,
        desc: "Everyone record a 10-second video greeting! These will be mashed into one clip.",
      },
      {
        id: 11,
        type: "photo",
        title: "Silliest face you can make",
        by: "KS",
        time: "1d ago",
        responses: 2,
        total: 5,
        desc: "Show us your goofiest expression!",
      },
      {
        id: 12,
        type: "truth-dare",
        title: "Two Truths and a Lie",
        by: "TS",
        time: "2d ago",
        responses: 3,
        total: 5,
        stakes: "Loser buys coffee",
      },
    ],
  },
  {
    id: 2,
    name: "Men's Accountability",
    members: ["RS", "DW", "JT", "BL"],
    streak: 8,
    health: 92,
    completedCount: 32,
    spectators: 1,
    engagements: [
      {
        id: 4,
        type: "accountability",
        title: "Weekly Check-in",
        by: "DW",
        time: "5h ago",
        responses: 2,
        total: 4,
        recurring: "weekly",
        questions: [
          "Have you been keeping up with your personal devotions this week?",
          "Have you been spending quality time with your family?",
          "Is there anything you need to confess or get off your chest?",
          "How can we pray for you this week?",
        ],
      },
      {
        id: 5,
        type: "advice",
        title: "Need counsel on a work situation",
        by: "JT",
        time: "1d ago",
        responses: 3,
        total: 4,
        desc: "I'm facing a difficult decision about accepting a promotion. What would you advise?",
      },
      {
        id: 13,
        type: "share",
        title: "Share your favorite family recipe",
        by: "BL",
        time: "3d ago",
        responses: 2,
        total: 4,
        desc: "Post the recipe and a photo of the dish if you have one!",
      },
    ],
  },
  {
    id: 3,
    name: "College Friends",
    members: ["RS", "AK", "NP", "LR", "CM", "TD"],
    streak: 5,
    health: 72,
    completedCount: 28,
    spectators: 3,
    engagements: [
      {
        id: 6,
        type: "game",
        title: "Chess match — RS vs AK",
        by: "AK",
        time: "12h ago",
        responses: 0,
        total: 2,
        desc: "White (RS) to play. Current position: e4 e5, Nf3 Nc6...",
      },
      {
        id: 7,
        type: "guess",
        title: "Guess where this photo was taken!",
        by: "NP",
        time: "2d ago",
        responses: 5,
        total: 6,
        desc: "Clue: I was on vacation somewhere tropical",
      },
      {
        id: 8,
        type: "poll",
        title: "Best road trip snack?",
        by: "LR",
        time: "3d ago",
        responses: 6,
        total: 6,
        options: ["Beef jerky", "Trail mix", "Gas station sushi", "Gummy bears"],
        votes: [3, 2, 0, 1],
      },
      {
        id: 14,
        type: "trivia",
        title: "Movie Quote Trivia",
        by: "CM",
        time: "1d ago",
        responses: 4,
        total: 6,
        options: [
          "The Shawshank Redemption",
          "Forrest Gump",
          "Pulp Fiction",
          "The Matrix",
        ],
        votes: [2, 1, 1, 0],
      },
    ],
  },
  {
    id: 4,
    name: "Church Small Group",
    members: ["RS", "PH", "SW", "ML", "KD"],
    streak: 15,
    health: 88,
    completedCount: 52,
    spectators: 0,
    engagements: [
      {
        id: 9,
        type: "challenge",
        title: "Memorize John 3:16 and record yourself",
        by: "PH",
        time: "6h ago",
        responses: 1,
        total: 5,
        desc: "Record a video of yourself reciting John 3:16 from memory. Bonus points for including the reference!",
        deadline: "2 days remaining",
        submitted: [
          { name: "PH", color: COLORS[1], done: true },
          { name: "SW", color: COLORS[2], done: false },
          { name: "ML", color: COLORS[3], done: false },
          { name: "KD", color: COLORS[4], done: false },
        ],
      },
      {
        id: 10,
        type: "poll",
        title: "Next book study?",
        by: "ML",
        time: "4d ago",
        responses: 5,
        total: 5,
        recurring: "monthly",
        options: ["Romans", "Ecclesiastes", "James", "Philippians"],
        votes: [2, 0, 2, 1],
      },
      {
        id: 15,
        type: "judge",
        title: "Best worship song mashup",
        by: "SW",
        time: "2d ago",
        responses: 4,
        total: 5,
        desc: "Submit an audio clip or description of your mashup idea",
      },
    ],
  },
];

const templates: Template[] = [
  {
    id: 1,
    name: "Icebreaker Pack",
    emoji: "❄️",
    desc: "5 quick conversation starters",
    engagements: [
      {
        id: 101,
        type: "poll",
        title: "Coffee or tea person?",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
        options: ["Coffee ☕", "Tea 🍵", "Neither"],
        votes: [0, 0, 0],
      },
      {
        id: 102,
        type: "truth-dare",
        title: "Two Truths and a Lie",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
      },
      {
        id: 103,
        type: "guess",
        title: "Guess My Favorite Movie",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
      },
    ],
  },
  {
    id: 2,
    name: "Bible Study Pack",
    emoji: "📖",
    desc: "Scripture discussion templates",
    engagements: [
      {
        id: 201,
        type: "accountability",
        title: "Weekly Scripture Reflection",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
        questions: [
          "What verse stood out to you this week?",
          "How are you applying it to your life?",
          "What do you need prayer for?",
        ],
      },
      {
        id: 202,
        type: "poll",
        title: "Which passage should we study next?",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
        options: ["Matthew 5-7", "1 John", "Proverbs", "Psalms"],
        votes: [0, 0, 0, 0],
      },
    ],
  },
  {
    id: 3,
    name: "Family Game Night",
    emoji: "🎮",
    desc: "Fun games & challenges",
    engagements: [
      {
        id: 301,
        type: "trivia",
        title: "Family Trivia Challenge",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
        options: ["Option A", "Option B", "Option C", "Option D"],
        votes: [0, 0, 0, 0],
      },
      {
        id: 302,
        type: "challenge",
        title: "Talent Show Video",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
        desc: "Record a 30-second talent performance",
      },
    ],
  },
  {
    id: 4,
    name: "Party Games",
    emoji: "🎉",
    desc: "Get everyone laughing",
    engagements: [
      {
        id: 401,
        type: "guess",
        title: "Guess the Song from Lyrics",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
      },
      {
        id: 402,
        type: "judge",
        title: "Best Meme Contest",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
      },
      {
        id: 403,
        type: "photo",
        title: "Silliest Selfie",
        by: "Template",
        time: "now",
        responses: 0,
        total: 0,
      },
    ],
  },
];

const favourites = [
  { name: "Mom — Birthday", type: "Video Greeting", emoji: "🎂", bg: "bg-orange-50" },
  { name: "Dad — Encouragement", type: "Video Mash", emoji: "💪", bg: "bg-green-50" },
  { name: "Sarah — Graduation", type: "Video Greeting", emoji: "🎓", bg: "bg-blue-50" },
  { name: "Dave — Farewell", type: "Video Mash", emoji: "✈️", bg: "bg-purple-50" },
];

const notifications = [
  { icon: "📊", bg: "bg-purple-100", msg: "MJ started a poll in Family Circle", time: "2h ago", unread: true },
  { icon: "🏆", bg: "bg-orange-100", msg: "RS posted a challenge in Family Circle", time: "1d ago", unread: true },
  { icon: "🙏", bg: "bg-red-100", msg: "DW posted an accountability check-in", time: "5h ago", unread: true },
  { icon: "♟️", bg: "bg-blue-100", msg: "AK challenged you to a chess match", time: "12h ago", unread: false },
  { icon: "🎉", bg: "bg-green-100", msg: "All responses in! Check Birthday surprise for KS", time: "3d ago", unread: false },
  { icon: "📖", bg: "bg-purple-100", msg: "PH posted a challenge in Church Small Group", time: "6h ago", unread: false },
];

const engagementTypes: { key: EngType; icon: string; label: string }[] = [
  { key: "poll", icon: "📊", label: "Poll" },
  { key: "challenge", icon: "🏆", label: "Challenge" },
  { key: "truth-dare", icon: "🎯", label: "Truth/Dare" },
  { key: "photo", icon: "📸", label: "Photo Pose" },
  { key: "share", icon: "💬", label: "Share" },
  { key: "accountability", icon: "🙏", label: "Accountability" },
  { key: "game", icon: "♟️", label: "Game" },
  { key: "trivia", icon: "🧠", label: "Instant" },
  { key: "judge", icon: "⚖️", label: "Judge" },
  { key: "guess", icon: "🔍", label: "Guess" },
  { key: "surprise", icon: "🎉", label: "Surprise" },
  { key: "advice", icon: "💡", label: "Advice" },
];

const typeBadge: Record<string, string> = {
  poll: "bg-purple-100 text-purple-700",
  challenge: "bg-orange-100 text-orange-700",
  surprise: "bg-green-100 text-green-700",
  game: "bg-blue-100 text-blue-700",
  accountability: "bg-red-100 text-red-700",
  guess: "bg-yellow-100 text-yellow-700",
  advice: "bg-teal-100 text-teal-700",
  "truth-dare": "bg-pink-100 text-pink-700",
  photo: "bg-indigo-100 text-indigo-700",
  share: "bg-slate-100 text-slate-700",
  trivia: "bg-cyan-100 text-cyan-700",
  judge: "bg-amber-100 text-amber-700",
};

// ── Toast Component ──
function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg animate-fade-in">
      {msg}
    </div>
  );
}

export default function CampfirePage() {
  const [screen, setScreen] = useState<Screen>("home");
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [currentEng, setCurrentEng] = useState<Engagement | null>(null);
  const [simulatedAllIn, setSimulatedAllIn] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<Template | null>(null);
  const [selectedPollIdx, setSelectedPollIdx] = useState<number | null>(null);
  const [pollSubmitted, setPollSubmitted] = useState(false);
  const [challengeUploaded, setChallengeUploaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedEngType, setSelectedEngType] = useState<EngType | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("home");
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [reactions, setReactions] = useState<Record<string, number>>({
    "🔥": 0,
    "😂": 0,
    "❤️": 0,
    "👍": 0,
    "🤯": 0,
  });
  const [userReacted, setUserReacted] = useState<string | null>(null);
  const [recurringFreq, setRecurringFreq] = useState<"daily" | "weekly" | "monthly" | null>(null);
  const [allowSpectators, setAllowSpectators] = useState(false);
  const [uploadMode, setUploadMode] = useState<"photo" | "voice" | null>(null);
  const [truthDareChoice, setTruthDareChoice] = useState<"truth" | "dare" | null>(null);
  const [accountabilityAnswers, setAccountabilityAnswers] = useState<Record<number, string>>({});
  const [triviaAnswer, setTriviaAnswer] = useState<number | null>(null);
  const [gameAccepted, setGameAccepted] = useState(false);
  const [guessInput, setGuessInput] = useState("");
  const [judgeVotes, setJudgeVotes] = useState<Record<number, number>>({});
  const [adviceInput, setAdviceInput] = useState("");
  const [shareInput, setShareInput] = useState("");
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [textResponse, setTextResponse] = useState("");
  const [revealAnimating, setRevealAnimating] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const triggerReveal = useCallback(() => {
    setRevealAnimating(true);
    setTimeout(() => {
      setSimulatedAllIn(true);
      setTimeout(() => setRevealAnimating(false), 600);
    }, 2200);
  }, []);

  function openGroup(g: Group) {
    setCurrentGroup(g);
    setScreen("group");
  }

  function openEngagement(eng: Engagement) {
    setCurrentEng(eng);
    setSelectedPollIdx(null);
    setPollSubmitted(false);
    setChallengeUploaded(false);
    setSimulatedAllIn(false);
    setUserReacted(null);
    setReactions({ "🔥": 0, "😂": 0, "❤️": 0, "👍": 0, "🤯": 0 });
    setUploadMode(null);
    setTruthDareChoice(null);
    setAccountabilityAnswers({});
    setTriviaAnswer(null);
    setGameAccepted(false);
    setGuessInput("");
    setJudgeVotes({});
    setAdviceInput("");
    setShareInput("");
    setPhotoUploaded(false);
    setTextResponse("");
    setRecordingVoice(false);

    if (eng.type === "poll") {
      setScreen("poll");
    } else if (eng.type === "challenge") {
      setScreen("challenge");
    } else if (eng.type === "truth-dare") {
      setScreen("truth-dare");
    } else if (eng.type === "photo") {
      setScreen("photo");
    } else if (eng.type === "share") {
      setScreen("share");
    } else if (eng.type === "accountability") {
      setScreen("accountability");
    } else if (eng.type === "game") {
      setScreen("game");
    } else if (eng.type === "trivia") {
      setScreen("trivia");
    } else if (eng.type === "judge") {
      setScreen("judge");
    } else if (eng.type === "guess") {
      setScreen("guess");
    } else if (eng.type === "surprise") {
      setScreen("surprise");
    } else if (eng.type === "advice") {
      setScreen("advice");
    }
  }

  function switchTab(tab: string) {
    setActiveTab(tab);
    setScreen(tab as Screen);
  }

  function openTemplateDetail(t: Template) {
    setCurrentTemplate(t);
    setScreen("template-detail");
  }

  function useTemplate() {
    setShowModal(true);
    setScreen("home");
    showToast("Template loaded! Fill in details and create.");
  }

  function handleReaction(emoji: string) {
    if (userReacted === emoji) {
      setUserReacted(null);
      setReactions((prev) => ({
        ...prev,
        [emoji]: Math.max(0, prev[emoji] - 1),
      }));
    } else {
      if (userReacted) {
        setReactions((prev) => ({
          ...prev,
          [userReacted]: Math.max(0, prev[userReacted] - 1),
        }));
      }
      setUserReacted(emoji);
      setReactions((prev) => ({
        ...prev,
        [emoji]: prev[emoji] + 1,
      }));
    }
  }

  // ── Sub-screens ──
  function renderHome() {
    return (
      <>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-xl font-extrabold text-slate-900">My Groups</h2>
          <button
            onClick={() => switchTab("profile")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-xs font-bold text-white"
          >
            RS
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5">
            <div className="text-xs font-bold text-amber-900 flex items-center gap-2">
              <span>🔒</span>
              <span>Results stay sealed until everyone responds</span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="rounded-xl bg-gradient-to-r from-orange-400 via-rose-400 to-pink-400 p-3.5 text-white">
            <div className="text-xs font-bold uppercase tracking-wide opacity-90">🏖️ Summer Challenge Series</div>
            <div className="text-sm font-bold mt-1">3 days left to join</div>
          </div>
        </div>

        <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Active Engagements
        </div>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {groups.map((g) => {
            const active = g.engagements.filter((e) => e.responses < e.total).length;
            return (
              <button
                key={g.id}
                onClick={() => openGroup(g)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-900">{g.name}</span>
                  {active > 0 && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
                      {active} active
                    </span>
                  )}
                </div>
                <div className="flex items-center mb-1.5">
                  {g.members.map((m, i) => (
                    <div
                      key={m}
                      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
                      style={{
                        background: COLORS[i % COLORS.length],
                        marginLeft: i > 0 ? -6 : 0,
                      }}
                    >
                      {m}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 truncate">
                    {g.engagements[0]?.title ?? "No engagements yet"}
                  </span>
                  <span className="text-orange-600 font-semibold ml-2">
                    🔥 {g.streak}-week
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-rose-500"
                    style={{ width: `${(g.health || 0) * 2}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function renderGroupDetail() {
    if (!currentGroup) return null;
    const showMilestone = (currentGroup.completedCount || 0) >= 10;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button
            onClick={() => { setScreen("home"); setActiveTab("home"); }}
            className="text-lg text-orange-600 font-bold"
          >
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">{currentGroup.name}</h3>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <span>👁️</span>
            <span>{currentGroup.spectators || 0} spectators</span>
          </div>
        </div>

        {showMilestone && (
          <div className="mx-3 mt-3 rounded-xl bg-gradient-to-r from-amber-100 to-orange-100 px-3.5 py-2.5 border border-amber-200">
            <div className="text-sm font-bold text-amber-900">
              🎉 {currentGroup.completedCount} engagements completed!
            </div>
          </div>
        )}

        <div className="bg-slate-50 px-4 py-3 mt-2">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="font-bold text-slate-900">{currentGroup.streak}</div>
              <div className="text-slate-500">Week Streak</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">{currentGroup.health}%</div>
              <div className="text-slate-500">Health</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">{currentGroup.completedCount}</div>
              <div className="text-slate-500">Completed</div>
            </div>
          </div>
        </div>

        <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Engagements
        </div>
        <div className="flex flex-col gap-2.5 px-4 pb-4 flex-1 overflow-y-auto">
          {currentGroup.engagements.map((eng) => (
            <button
              key={eng.id}
              onClick={() => openEngagement(eng)}
              className="rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:shadow-md"
            >
              <div className="flex items-start gap-2 mb-1.5">
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    typeBadge[eng.type] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {eng.type}
                </span>
                {eng.recurring && (
                  <span className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                    ↻ {eng.recurring}
                  </span>
                )}
                {eng.winner && (
                  <span className="ml-auto inline-block text-sm">👑</span>
                )}
              </div>
              <div className="font-semibold text-sm text-slate-900 mb-1">{eng.title}</div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>by {eng.by}</span>
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                <span>{eng.time}</span>
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                <span>{eng.responses}/{eng.total} responded</span>
                {eng.responses < eng.total && (
                  <span className="ml-auto rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold">🔒 Sealed</span>
                )}
                {eng.responses >= eng.total && (
                  <span className="ml-auto text-emerald-600 text-[10px] font-semibold">✓ Revealed</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderPoll() {
    if (!currentEng || !currentEng.options || !currentEng.votes) return null;
    const totalVotes = currentEng.votes.reduce((a, b) => a + b, 0);
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const showResults = pollSubmitted && allIn;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Poll</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Results are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} responded — results revealed when everyone is in
                </div>
              </div>
            </div>
          )}

          {allIn && pollSubmitted && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All responses are in!</div>
                <div className="text-xs text-emerald-700">Results have been revealed to the group</div>
              </div>
            </div>
          )}

          <h2 className="text-lg font-extrabold text-slate-900 mb-5 leading-snug">
            {currentEng.title}
          </h2>
          <div className="flex flex-col gap-2.5 mb-5">
            {currentEng.options.map((opt, i) => {
              const pct = totalVotes ? Math.round((currentEng.votes![i] / totalVotes) * 100) : 0;
              const isSelected = selectedPollIdx === i;
              return (
                <button
                  key={i}
                  onClick={() => !pollSubmitted && setSelectedPollIdx(i)}
                  className={`relative flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition overflow-hidden ${
                    isSelected && !pollSubmitted
                      ? "border-orange-500 bg-orange-50"
                      : pollSubmitted && !showResults
                        ? "border-slate-100 bg-slate-50 opacity-70"
                        : "border-slate-200"
                  }`}
                >
                  {showResults && (
                    <div
                      className="absolute inset-y-0 left-0 bg-orange-500/10 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                  <div
                    className={`relative z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition ${
                      isSelected
                        ? "border-orange-500 bg-orange-500"
                        : "border-slate-300"
                    }`}
                  >
                    {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <span className="relative z-10 text-sm font-medium text-slate-800">
                    {opt}
                  </span>
                  {showResults && (
                    <span className="relative z-10 ml-auto text-sm font-bold text-orange-600">
                      {pct}%
                    </span>
                  )}
                  {pollSubmitted && !showResults && isSelected && (
                    <span className="relative z-10 ml-auto text-xs text-slate-400">Your vote</span>
                  )}
                </button>
              );
            })}
          </div>

          {!pollSubmitted && (
            <button
              disabled={selectedPollIdx === null}
              onClick={() => {
                setPollSubmitted(true);
                showToast("Vote locked in! Results revealed when everyone responds.");
              }}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed mb-4"
            >
              Submit Vote
            </button>
          )}

          {pollSubmitted && !allIn && (
            <div className="text-center py-6 mb-4">
              <div className="text-4xl mb-3">🔐</div>
              <div className="text-sm font-bold text-slate-700 mb-1">Your vote is locked in</div>
              <div className="text-xs text-slate-500 mb-3">
                Waiting for {currentEng.total - currentEng.responses} more {currentEng.total - currentEng.responses === 1 ? "response" : "responses"}...
              </div>
              <div className="flex justify-center gap-1.5">
                {Array.from({ length: currentEng.total }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-2.5 w-2.5 rounded-full ${
                      idx < currentEng.responses ? "bg-orange-500" : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={() => showToast("Nudge sent to remaining members!")}
                className="mt-4 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition"
              >
                👋 Send Nudge
              </button>
              <button
                onClick={() => {
                  triggerReveal();
                }}
                className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
              >
                Demo: Simulate everyone responds
              </button>
            </div>
          )}

          {showResults && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Reactions</span>
                <button
                  onClick={() => showToast("Exported to camera roll!")}
                  className="text-lg"
                >
                  📤
                </button>
              </div>
              <div className="flex gap-2 mb-4">
                {Object.entries(reactions).map(([emoji, count]) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      userReacted === emoji
                        ? "bg-orange-100 text-orange-700 border-2 border-orange-500"
                        : "bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200"
                    }`}
                  >
                    <span>{emoji}</span>
                    {count > 0 && <span className="text-xs">{count}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  function renderChallenge() {
    if (!currentEng) return null;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Challenge</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{currentEng.desc}</p>
          )}
          {currentEng.deadline && (
            <div className="flex items-center gap-2 rounded-xl bg-orange-50 px-3.5 py-2.5 mb-4">
              <span>⏱️</span>
              <span className="text-sm font-medium text-orange-600">{currentEng.deadline}</span>
            </div>
          )}

          {!challengeUploaded ? (
            <div className="flex flex-col gap-2 mb-4">
              <button
                onClick={() => setUploadMode(uploadMode === "photo" ? null : "photo")}
                className={`rounded-xl border-2 p-4 text-center transition ${
                  uploadMode === "photo"
                    ? "border-orange-500 bg-orange-50"
                    : "border-slate-300 hover:border-orange-400 hover:bg-orange-50"
                }`}
              >
                <div className="text-2xl mb-1">📷</div>
                <div className="text-sm font-medium text-slate-700">Photo/Video</div>
              </button>
              <button
                onClick={() => setUploadMode(uploadMode === "voice" ? null : "voice")}
                className={`rounded-xl border-2 p-4 text-center transition ${
                  uploadMode === "voice"
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 hover:border-blue-400 hover:bg-blue-50"
                }`}
              >
                <div className="text-2xl mb-1">🎙️</div>
                <div className="text-sm font-medium text-slate-700">Voice Note</div>
              </button>
            </div>
          ) : null}

          {uploadMode === "photo" && !challengeUploaded && (
            <button
              onClick={() => {
                setChallengeUploaded(true);
                setUploadMode(null);
                showToast("Response submitted! Waiting for others...");
              }}
              className="w-full rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-orange-400 hover:bg-orange-50 cursor-pointer mb-4"
            >
              <div className="text-2xl mb-2">📸</div>
              <div className="text-sm text-slate-600">Tap to select photo or video</div>
            </button>
          )}

          {uploadMode === "voice" && !challengeUploaded && (
            <button
              onClick={() => {
                setRecordingVoice(!recordingVoice);
                if (recordingVoice) {
                  setChallengeUploaded(true);
                  setUploadMode(null);
                  showToast("Voice note submitted!");
                }
              }}
              className={`w-full rounded-2xl border-2 p-8 text-center transition mb-4 ${
                recordingVoice
                  ? "border-red-500 bg-red-50"
                  : "border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer"
              }`}
            >
              <div className={`text-3xl mb-2 ${recordingVoice ? "animate-pulse" : ""}`}>
                {recordingVoice ? "⏹️" : "🎤"}
              </div>
              <div className="text-sm text-slate-600">
                {recordingVoice ? "Recording... tap to stop" : "Tap to record voice note"}
              </div>
            </button>
          )}

          {challengeUploaded && (
            <div className="w-full rounded-xl border-2 border-emerald-400 bg-emerald-50 py-3 px-4 text-sm font-bold text-emerald-700 mb-4 text-center">
              ✅ Your response is locked in!
            </div>
          )}

          {currentEng.submitted && (() => {
            const challAllIn = currentEng.responses >= currentEng.total || simulatedAllIn;
            return (
              <>
                {!challAllIn && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4">
                    <span className="text-lg">🔒</span>
                    <div>
                      <div className="text-sm font-bold text-amber-900">Responses are sealed</div>
                      <div className="text-xs text-amber-700">
                        No one sees results until everyone responds ({currentEng.responses}/{currentEng.total} in)
                      </div>
                    </div>
                  </div>
                )}

                {challAllIn && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
                    <span className="text-lg">🎉</span>
                    <div>
                      <div className="text-sm font-bold text-emerald-900">All responses are in!</div>
                      <div className="text-xs text-emerald-700">Tap each response to view — rate your favourites</div>
                    </div>
                  </div>
                )}

                <div className="mt-1 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Members ({currentEng.responses}/{currentEng.total})
                </div>
                <div className="flex flex-col gap-2">
                  {currentEng.submitted.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
                    >
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ background: s.color }}
                      >
                        {s.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-800">{s.name}</div>
                        <div className="text-xs text-slate-500">
                          {s.done ? (challAllIn ? "Tap to view" : "Submitted") : "Waiting..."}
                        </div>
                      </div>
                      {s.done && !challAllIn && <span className="text-amber-500 font-bold">🔒</span>}
                      {s.done && challAllIn && <span className="text-emerald-500 font-bold">👀</span>}
                    </div>
                  ))}
                </div>

                {challengeUploaded && !challAllIn && (
                  <div className="text-center mt-4">
                    <div className="flex justify-center gap-1.5 mb-3">
                      {Array.from({ length: currentEng.total }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`h-2.5 w-2.5 rounded-full ${
                            idx < currentEng.responses ? "bg-orange-500" : "bg-slate-200"
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => showToast("Nudge sent to remaining members!")}
                      className="rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition"
                    >
                      👋 Send Nudge
                    </button>
                    <br />
                    <button
                      onClick={() => {
                        triggerReveal();
                      }}
                      className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                    >
                      Demo: Simulate everyone responds
                    </button>
                  </div>
                )}

                {challAllIn && challengeUploaded && (
                  <>
                    <div className="flex items-center justify-between mt-4 mb-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Reactions</span>
                      <button
                        onClick={() => showToast("Exported to camera roll!")}
                        className="text-lg"
                      >
                        📤
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {Object.entries(reactions).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(emoji)}
                          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                            userReacted === emoji
                              ? "bg-orange-100 text-orange-700 border-2 border-orange-500"
                              : "bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200"
                          }`}
                        >
                          <span>{emoji}</span>
                          {count > 0 && <span className="text-xs">{count}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </>
    );
  }

  function renderTruthDare() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const responded = truthDareChoice !== null;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Truth or Dare</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && !responded && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Results are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} responded
                </div>
              </div>
            </div>
          )}
          {allIn && responded && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All responses are in!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-5">{currentEng.title}</h2>
          {currentEng.stakes && (
            <div className="rounded-lg bg-pink-50 border border-pink-200 px-3 py-2 mb-4 text-sm text-pink-700 font-medium">
              Stakes: {currentEng.stakes}
            </div>
          )}
          {!responded ? (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setTruthDareChoice("truth")}
                className="rounded-xl border-2 border-blue-300 bg-blue-50 p-6 text-center transition hover:border-blue-500 hover:bg-blue-100"
              >
                <div className="text-3xl mb-2">🤔</div>
                <div className="text-sm font-bold text-blue-700">Pick Truth</div>
                <div className="text-xs text-blue-600 mt-1">Answer a personal question</div>
              </button>
              <button
                onClick={() => setTruthDareChoice("dare")}
                className="rounded-xl border-2 border-pink-300 bg-pink-50 p-6 text-center transition hover:border-pink-500 hover:bg-pink-100"
              >
                <div className="text-3xl mb-2">🎭</div>
                <div className="text-sm font-bold text-pink-700">Pick Dare</div>
                <div className="text-xs text-pink-600 mt-1">Take on a challenge</div>
              </button>
            </div>
          ) : (
            <>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
                <div className="text-sm font-bold text-orange-900">
                  {truthDareChoice === "truth" ? "Your truth response:" : "Your dare:"}
                </div>
                <textarea
                  value={textResponse}
                  onChange={(e) => setTextResponse(e.target.value)}
                  placeholder={truthDareChoice === "truth" ? "Type your answer..." : "Describe what you did..."}
                  className="w-full mt-2 rounded border border-orange-200 bg-white p-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  rows={4}
                />
              </div>
              {!allIn && (
                <div className="text-center py-4 mb-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-pink-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
              {allIn && (
                <>
                  <div className="flex items-center justify-between mt-4 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Reactions</span>
                  </div>
                  <div className="flex gap-2">
                    {Object.entries(reactions).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(emoji)}
                        className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          userReacted === emoji
                            ? "bg-pink-100 text-pink-700 border-2 border-pink-500"
                            : "bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200"
                        }`}
                      >
                        <span>{emoji}</span>
                        {count > 0 && <span className="text-xs">{count}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderPhoto() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Photo Pose</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Photos are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} submitted
                </div>
              </div>
            </div>
          )}
          {allIn && photoUploaded && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All photos are in!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          {!photoUploaded ? (
            <button
              onClick={() => {
                setPhotoUploaded(true);
                showToast("Photo submitted!");
              }}
              className="w-full rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer mb-4"
            >
              <div className="text-3xl mb-2">📷</div>
              <div className="text-sm text-slate-600">Tap to take or upload photo</div>
            </button>
          ) : (
            <div className="w-full rounded-xl border-2 border-indigo-400 bg-indigo-50 p-4 text-center mb-4">
              <div className="text-4xl mb-2">📸</div>
              <div className="text-sm font-bold text-indigo-700">Photo submitted!</div>
            </div>
          )}
          {!allIn && photoUploaded && (
            <div className="text-center py-4">
              <div className="flex justify-center gap-1.5 mb-3">
                {Array.from({ length: currentEng.total }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-2.5 w-2.5 rounded-full ${
                      idx < currentEng.responses ? "bg-indigo-500" : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={() => {
                  triggerReveal();
                }}
                className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
              >
                Demo: Simulate everyone responds
              </button>
            </div>
          )}
          {allIn && photoUploaded && (
            <div className="flex gap-2">
              {Object.entries(reactions).map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    userReacted === emoji
                      ? "bg-indigo-100 text-indigo-700 border-2 border-indigo-500"
                      : "bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200"
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 0 && <span className="text-xs">{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  function renderShare() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const responded = shareInput.length > 0;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Share</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Shares are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} responded
                </div>
              </div>
            </div>
          )}
          {allIn && responded && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All responses revealed!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          {!responded ? (
            <>
              <textarea
                value={shareInput}
                onChange={(e) => setShareInput(e.target.value)}
                placeholder="Share your response here..."
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 mb-4"
                rows={5}
              />
              <button
                disabled={shareInput.length === 0}
                onClick={() => {
                  showToast("Response submitted!");
                }}
                className="w-full rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit Share
              </button>
            </>
          ) : (
            <>
              {!allIn && (
                <div className="text-center py-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-slate-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
              {allIn && (
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs font-bold text-slate-600 mb-2">Your share:</div>
                  <div className="text-sm text-slate-700">{shareInput}</div>
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderAccountability() {
    if (!currentEng || !currentEng.questions) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const allAnswered = currentEng.questions.every((_, idx) => accountabilityAnswers[idx]);
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Accountability</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Responses are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} responded
                </div>
              </div>
            </div>
          )}
          {allIn && allAnswered && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All answers revealed!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-5">{currentEng.title}</h2>
          <div className="space-y-4">
            {currentEng.questions.map((q, idx) => (
              <div key={idx} className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">{q}</label>
                <textarea
                  value={accountabilityAnswers[idx] || ""}
                  onChange={(e) =>
                    setAccountabilityAnswers({
                      ...accountabilityAnswers,
                      [idx]: e.target.value,
                    })
                  }
                  placeholder="Your answer..."
                  className="rounded border border-slate-300 bg-white p-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  rows={2}
                />
              </div>
            ))}
          </div>
          {!allAnswered ? (
            <button
              disabled={!allAnswered}
              onClick={() => {
                showToast("Answers submitted!");
              }}
              className="w-full rounded-xl bg-gradient-to-r from-red-500 to-red-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40 mt-4"
            >
              Submit Answers
            </button>
          ) : (
            <>
              {!allIn && (
                <div className="text-center py-4 mt-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-red-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderGame() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Game</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!gameAccepted && (
            <div className="flex items-center gap-2.5 rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">♟️</span>
              <div>
                <div className="text-sm font-bold text-blue-900">New game invitation</div>
                <div className="text-xs text-blue-700">
                  {currentEng.by} challenged you
                </div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-4">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          {!gameAccepted ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setGameAccepted(true);
                  showToast("You accepted the challenge!");
                }}
                className="w-full rounded-xl bg-blue-500 text-white py-3 font-bold hover:bg-blue-600 transition"
              >
                Accept Challenge
              </button>
              <button
                onClick={() => {
                  setScreen("group");
                  showToast("Challenge declined");
                }}
                className="w-full rounded-xl border border-slate-300 bg-white text-slate-700 py-3 font-bold hover:bg-slate-50 transition"
              >
                Decline
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 mb-4">
                <div className="text-xs font-bold text-blue-700 mb-2">Game Board (e.g., Chess)</div>
                <div className="w-full aspect-square bg-gradient-to-br from-amber-50 to-amber-100 rounded flex items-center justify-center text-4xl">
                  ♟️
                </div>
              </div>
              <div className="text-sm font-medium text-slate-700 mb-3">
                {currentEng.by} to play
              </div>
              <button
                onClick={() => showToast("Move submitted!")}
                className="w-full rounded-xl bg-blue-500 text-white py-3 font-bold hover:bg-blue-600 transition"
              >
                Make Your Move
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  function renderTrivia() {
    if (!currentEng || !currentEng.options || !currentEng.votes) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const answered = triviaAnswer !== null;
    const totalVotes = currentEng.votes.reduce((a, b) => a + b, 0);
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Trivia</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Answers are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} answered
                </div>
              </div>
            </div>
          )}
          {allIn && answered && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">Results revealed!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-5">{currentEng.title}</h2>
          <div className="flex flex-col gap-2.5">
            {currentEng.options.map((opt, i) => {
              const pct = totalVotes ? Math.round((currentEng.votes![i] / totalVotes) * 100) : 0;
              const isSelected = triviaAnswer === i;
              return (
                <button
                  key={i}
                  onClick={() => !answered && setTriviaAnswer(i)}
                  disabled={answered}
                  className={`relative flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition overflow-hidden ${
                    isSelected && !answered
                      ? "border-cyan-500 bg-cyan-50"
                      : answered && !allIn
                        ? "border-slate-100 bg-slate-50 opacity-70"
                        : "border-slate-200"
                  }`}
                >
                  {allIn && answered && (
                    <div
                      className="absolute inset-y-0 left-0 bg-cyan-500/10 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                  <div
                    className={`relative z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-500"
                        : "border-slate-300"
                    }`}
                  >
                    {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <span className="relative z-10 text-sm font-medium text-slate-800">
                    {opt}
                  </span>
                  {allIn && answered && (
                    <span className="relative z-10 ml-auto text-sm font-bold text-cyan-600">
                      {pct}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!answered ? (
            <button
              disabled={triviaAnswer === null}
              onClick={() => {
                showToast("Answer submitted!");
              }}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40 mt-4"
            >
              Submit Answer
            </button>
          ) : (
            <>
              {!allIn && (
                <div className="text-center py-4 mt-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-cyan-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderJudge() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const responded = Object.keys(judgeVotes).length > 0;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Judge</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Votes are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} submitted
                </div>
              </div>
            </div>
          )}
          {allIn && responded && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">Voting complete!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-5">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          <div className="space-y-3">
            {[1, 2, 3].map((entry) => (
              <div key={entry} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-3xl mb-2 text-center">📝</div>
                <div className="text-xs text-amber-700 font-bold mb-2">Entry {entry}</div>
                {!allIn ? (
                  <div className="text-xs text-amber-600">Anonymous submission</div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const votes = { ...judgeVotes };
                        votes[entry] = (votes[entry] || 0) + 1;
                        setJudgeVotes(votes);
                        showToast("Vote counted!");
                      }}
                      className="flex-1 rounded bg-amber-300 text-amber-900 py-1 text-xs font-bold hover:bg-amber-400 transition"
                    >
                      👍 {judgeVotes[entry] || 0}
                    </button>
                    <button
                      onClick={() => showToast("Rating saved!")}
                      className="flex-1 rounded bg-amber-200 text-amber-900 py-1 text-xs font-bold hover:bg-amber-300 transition"
                    >
                      ⭐ Rate
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderGuess() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const answered = guessInput.length > 0;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Guess</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Guesses are sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} guessed
                </div>
              </div>
            </div>
          )}
          {allIn && answered && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">Answer revealed!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-5">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          <div className="rounded-lg border-2 border-dashed border-yellow-300 bg-yellow-50 p-6 mb-4 text-center">
            <div className="text-5xl mb-2">🖼️</div>
            <div className="text-sm text-yellow-700 font-medium">Mystery image</div>
          </div>
          {!answered ? (
            <>
              <input
                type="text"
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                placeholder="What is it? Make your guess..."
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-4"
              />
              <button
                disabled={guessInput.length === 0}
                onClick={() => {
                  showToast("Guess submitted!");
                }}
                className="w-full rounded-xl bg-gradient-to-r from-yellow-500 to-yellow-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40"
              >
                Submit Guess
              </button>
            </>
          ) : (
            <>
              {!allIn && (
                <div className="text-center py-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-yellow-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
              {allIn && (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-center">
                  <div className="text-xs font-bold text-yellow-700 mb-2">The answer was:</div>
                  <div className="text-sm font-bold text-yellow-900">Tokyo, Japan</div>
                  <div className="text-xs text-yellow-700 mt-2">You guessed: {guessInput}</div>
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderSurprise() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Surprise</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-green-50 border border-green-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🤫</span>
              <div>
                <div className="text-sm font-bold text-green-900">Shhh! Keep it secret</div>
                <div className="text-xs text-green-700">
                  {currentEng.responses}/{currentEng.total} submitted
                </div>
              </div>
            </div>
          )}
          {allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-green-50 border border-green-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-green-900">Ready to reveal!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          <button
            onClick={() => {
              setPhotoUploaded(true);
              showToast("Submission recorded! (This is hidden from the recipient)");
            }}
            disabled={photoUploaded}
            className={`w-full rounded-2xl border-2 p-8 text-center transition cursor-pointer mb-4 ${
              photoUploaded
                ? "border-green-400 bg-green-50"
                : "border-dashed border-slate-300 hover:border-green-400 hover:bg-green-50"
            }`}
          >
            <div className="text-3xl mb-2">🎥</div>
            <div className="text-sm text-slate-600">
              {photoUploaded ? "Your submission is in!" : "Tap to upload video or photo"}
            </div>
          </button>
          {!allIn && photoUploaded && (
            <div className="text-center py-4">
              <div className="flex justify-center gap-1.5 mb-3">
                {Array.from({ length: currentEng.total }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-2.5 w-2.5 rounded-full ${
                      idx < currentEng.responses ? "bg-green-500" : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={() => {
                  triggerReveal();
                }}
                className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
              >
                Demo: Simulate everyone responds
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderAdvice() {
    if (!currentEng) return null;
    const allIn = currentEng.responses >= currentEng.total || simulatedAllIn;
    const answered = adviceInput.length > 0;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Advice</h3>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {!allIn && (
            <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 mb-4 animate-pulse">
              <span className="text-lg">🔒</span>
              <div>
                <div className="text-sm font-bold text-amber-900">Advice is sealed</div>
                <div className="text-xs text-amber-700">
                  {currentEng.responses}/{currentEng.total} responded
                </div>
              </div>
            </div>
          )}
          {allIn && answered && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 mb-4">
              <span className="text-lg">🎉</span>
              <div>
                <div className="text-sm font-bold text-emerald-900">All advice revealed!</div>
              </div>
            </div>
          )}
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">{currentEng.title}</h2>
          {currentEng.desc && (
            <p className="text-sm text-slate-600 mb-4">{currentEng.desc}</p>
          )}
          {!answered ? (
            <>
              <textarea
                value={adviceInput}
                onChange={(e) => setAdviceInput(e.target.value)}
                placeholder="Share your advice here..."
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 mb-4"
                rows={5}
              />
              <button
                disabled={adviceInput.length === 0}
                onClick={() => {
                  showToast("Advice submitted!");
                }}
                className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40"
              >
                Submit Advice
              </button>
            </>
          ) : (
            <>
              {!allIn && (
                <div className="text-center py-4">
                  <div className="flex justify-center gap-1.5 mb-3">
                    {Array.from({ length: currentEng.total }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-2.5 w-2.5 rounded-full ${
                          idx < currentEng.responses ? "bg-teal-500" : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      triggerReveal();
                    }}
                    className="mt-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 transition"
                  >
                    Demo: Simulate everyone responds
                  </button>
                </div>
              )}
              {allIn && (
                <div className="space-y-3">
                  {[1, 2, 3].map((idx) => (
                    <div key={idx} className="rounded-lg bg-teal-50 border border-teal-200 p-3">
                      <div className="text-xs font-bold text-teal-700 mb-1">Member {idx}'s advice</div>
                      <div className="text-sm text-teal-900 mb-2">Sample advice text here...</div>
                      <button className="text-sm font-bold text-teal-600 hover:text-teal-700">
                        👍 Upvote
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  function renderTemplates() {
    return (
      <>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xl font-extrabold text-slate-900">Templates</h2>
        </div>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => openTemplateDetail(t)}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className="text-3xl">{t.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900">{t.name}</div>
                  <div className="text-sm text-slate-500">{t.desc}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {t.engagements.length} items
                  </div>
                </div>
                <span className="text-slate-400">→</span>
              </div>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderTemplateDetail() {
    if (!currentTemplate) return null;
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button
            onClick={() => { setScreen("templates"); }}
            className="text-lg text-orange-600 font-bold"
          >
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span className="text-2xl">{currentTemplate.emoji}</span>
            {currentTemplate.name}
          </h3>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          <p className="text-sm text-slate-600 mb-4">{currentTemplate.desc}</p>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
            Items in this pack
          </div>
          <div className="flex flex-col gap-2.5 mb-4">
            {currentTemplate.engagements.map((eng) => (
              <div
                key={eng.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mb-1.5 ${
                    typeBadge[eng.type] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {eng.type}
                </span>
                <div className="font-semibold text-sm text-slate-900">{eng.title}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => useTemplate()}
            className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
          >
            Use Template
          </button>
        </div>
      </>
    );
  }

  function renderFavourites() {
    return (
      <>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xl font-extrabold text-slate-900">Favourites</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          {favourites.map((f) => (
            <button
              key={f.name}
              onClick={() => showToast(`Playing ${f.name}...`)}
              className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm transition hover:shadow-md text-left"
            >
              <div className={`flex h-24 items-center justify-center text-4xl ${f.bg}`}>
                {f.emoji}
              </div>
              <div className="p-2.5">
                <div className="text-sm font-semibold text-slate-800">{f.name}</div>
                <div className="text-xs text-slate-500">{f.type}</div>
              </div>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderNotifications() {
    return (
      <>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xl font-extrabold text-slate-900">Notifications</h2>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {notifications.map((n, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-xl border p-3 ${
                n.unread ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"
              }`}
            >
              <div
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base ${n.bg}`}
              >
                {n.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 leading-snug">{n.msg}</div>
                <div className="text-xs text-slate-400 mt-0.5">{n.time}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <div className="text-center pt-8 pb-5">
          <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-2xl font-bold text-white mb-3">
            RS
          </div>
          <div className="text-lg font-bold text-slate-900">Richard Sommer</div>
          <div className="text-sm text-slate-500">@richardsommer</div>
          <div className="mt-4 flex justify-center gap-8">
            {[
              ["4", "Groups"],
              ["23", "Engagements"],
              ["7", "Wins"],
            ].map(([num, label]) => (
              <div key={label} className="text-center">
                <div className="text-lg font-bold text-slate-900">{num}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            Settings
          </div>
          {[
            {
              label: "Available as Random Guest",
              desc: "Let others add you to groups",
              defaultOn: true,
            },
            {
              label: "Allow Adult Content",
              desc: "For random guest engagements",
              defaultOn: false,
            },
            {
              label: "Available for Advice",
              desc: "Receive questions from others",
              defaultOn: true,
            },
            {
              label: "Push Notifications",
              desc: "Get notified of new engagements",
              defaultOn: true,
            },
          ].map((s) => (
            <ToggleRow key={s.label} label={s.label} desc={s.desc} defaultOn={s.defaultOn} />
          ))}
        </div>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50">
      <div className="mx-auto max-w-6xl px-6 pt-10 pb-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="inline-flex items-center rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1 text-xs font-semibold text-white">
            Interactive Prototype
          </span>
          <Link
            href="/aboutcampfire"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            About Campfire &rarr;
          </Link>
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
          Campfire
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl">
          A social engagement app that brings back what group chats lost — structured activities,
          accountability, surprises, and fun. Try the interactive prototype below.
        </p>
      </div>

      <div className="flex justify-center px-4 pb-16">
        <div className="relative w-full max-w-[400px]">
          <div className="rounded-[2.5rem] border-[6px] border-slate-800 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between bg-slate-800 px-6 py-1.5 text-[11px] font-medium text-white">
              <span>9:41</span>
              <div className="flex items-center gap-1.5">
                <span>●●●●</span>
                <span>WiFi</span>
                <span>🔋</span>
              </div>
            </div>

            <div className="flex items-center justify-between bg-white px-4 py-2.5 border-b border-slate-100">
              <span className="text-lg font-extrabold bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                Campfire
              </span>
              <span className="text-xs text-slate-400">v0.1 prototype</span>
            </div>

            <div className="h-[520px] overflow-y-auto bg-slate-50">
              {screen === "home" && renderHome()}
              {screen === "group" && renderGroupDetail()}
              {screen === "poll" && renderPoll()}
              {screen === "challenge" && renderChallenge()}
              {screen === "truth-dare" && renderTruthDare()}
              {screen === "photo" && renderPhoto()}
              {screen === "share" && renderShare()}
              {screen === "accountability" && renderAccountability()}
              {screen === "game" && renderGame()}
              {screen === "trivia" && renderTrivia()}
              {screen === "judge" && renderJudge()}
              {screen === "guess" && renderGuess()}
              {screen === "surprise" && renderSurprise()}
              {screen === "advice" && renderAdvice()}
              {screen === "templates" && renderTemplates()}
              {screen === "template-detail" && renderTemplateDetail()}
              {screen === "favs" && renderFavourites()}
              {screen === "notifs" && renderNotifications()}
              {screen === "profile" && renderProfile()}
            </div>

            {(screen === "home" || screen === "group") && (
              <button
                onClick={() => setShowModal(true)}
                className="absolute bottom-[72px] right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-xl text-white shadow-lg transition hover:scale-105"
              >
                +
              </button>
            )}

            <div className="flex items-center justify-around border-t border-slate-200 bg-white py-2">
              {[
                { key: "home", icon: "🏠", label: "Home" },
                { key: "templates", icon: "📋", label: "Templates" },
                { key: "favs", icon: "❤️", label: "Favourites" },
                { key: "notifs", icon: "🔔", label: "Alerts", badge: 3 },
                { key: "profile", icon: "👤", label: "Profile" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className={`relative flex flex-col items-center gap-0.5 text-[10px] font-medium transition ${
                    activeTab === tab.key ? "text-orange-600" : "text-slate-400"
                  }`}
                >
                  <span className="text-lg leading-none">{tab.icon}</span>
                  {tab.badge && (
                    <span className="absolute -top-1 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white">
                      {tab.badge}
                    </span>
                  )}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="w-full max-w-[400px] rounded-t-3xl bg-white p-5 animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-slate-300" />
            <h3 className="text-lg font-extrabold text-slate-900 mb-4">New Engagement</h3>
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {engagementTypes.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSelectedEngType(t.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition ${
                    selectedEngType === t.key
                      ? "border-orange-500 bg-orange-50"
                      : "border-slate-200 hover:border-orange-300"
                  }`}
                >
                  <span className="text-xl">{t.icon}</span>
                  <span className="text-[10px] font-bold text-slate-700">{t.label}</span>
                </button>
              ))}
            </div>

            {selectedEngType && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Settings
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Response deadline</span>
                  <select className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white">
                    <option>1 hour</option>
                    <option>6 hours</option>
                    <option>24 hours</option>
                    <option>3 days</option>
                    <option>1 week</option>
                  </select>
                </div>
                <ToggleRow label="Blind responses" desc="Identities hidden until all respond" defaultOn={false} />
                <ToggleRow label="Allow rating" desc="Members rate each response" defaultOn={true} />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Reveal mode</span>
                  <select className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white">
                    <option>Sealed (recommended)</option>
                    <option>First in</option>
                    <option>As they come</option>
                    <option>Instant</option>
                  </select>
                </div>
                <div className="text-xs text-slate-500 px-2 py-1.5 bg-amber-50 rounded border border-amber-200">
                  Nobody sees results until everyone responds
                </div>
                <ToggleRow label="Offer a reward" desc="For the winner" defaultOn={false} />
                <ToggleRow label="Add random guest" desc="" defaultOn={false} />
                <ToggleRow label="Adult content" desc="" defaultOn={false} />

                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Advanced
                  </div>
                  <ToggleRow
                    label="Make recurring"
                    desc="Repeats on a schedule"
                    defaultOn={false}
                  />
                  {recurringFreq !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Frequency</span>
                      <select
                        onChange={(e) =>
                          setRecurringFreq(e.target.value as "daily" | "weekly" | "monthly")
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  )}
                  <ToggleRow
                    label="Allow spectators"
                    desc="Non-members can watch"
                    defaultOn={false}
                  />
                </div>

                <button
                  onClick={() => {
                    setShowModal(false);
                    showToast(
                      `${selectedEngType.charAt(0).toUpperCase() + selectedEngType.slice(1)} engagement created!`
                    );
                    setSelectedEngType(null);
                    setRecurringFreq(null);
                  }}
                  className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3 text-sm font-bold text-white shadow-md mt-4"
                >
                  Create Engagement
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reveal Animation Overlay ── */}
      {revealAnimating && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center reveal-overlay">
          <div className="absolute inset-0 bg-black/70 reveal-backdrop" />
          <div className="relative flex flex-col items-center gap-4 reveal-content">
            <div className="reveal-envelope">
              <div className="text-7xl reveal-lock">🔒</div>
              <div className="text-7xl reveal-unlock">🔓</div>
            </div>
            <div className="reveal-text text-white text-center">
              <div className="text-2xl font-extrabold tracking-tight">The seal is breaking...</div>
              <div className="text-sm text-white/70 mt-1">Everyone responded!</div>
            </div>
            <div className="reveal-particles">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="reveal-particle" style={{
                  left: `${50 + 40 * Math.cos((i * Math.PI * 2) / 12)}%`,
                  top: `${50 + 40 * Math.sin((i * Math.PI * 2) / 12)}%`,
                  animationDelay: `${0.8 + i * 0.06}s`,
                }}>
                  {["🔥", "✨", "🎉", "⭐", "💫", "🌟"][i % 6]}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast} />

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.3s ease; }
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.3s ease; }

        /* ── Reveal Animation ── */
        .reveal-overlay {
          animation: reveal-overlay-in 0.3s ease forwards;
        }
        @keyframes reveal-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .reveal-backdrop {
          animation: reveal-backdrop-in 0.4s ease forwards;
        }
        @keyframes reveal-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .reveal-envelope {
          position: relative;
          width: 80px;
          height: 80px;
        }
        .reveal-lock {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: reveal-lock-shake 0.8s ease-in-out forwards;
        }
        @keyframes reveal-lock-shake {
          0%   { transform: rotate(0deg) scale(1); opacity: 1; }
          15%  { transform: rotate(-12deg) scale(1.05); }
          30%  { transform: rotate(12deg) scale(1.1); }
          45%  { transform: rotate(-8deg) scale(1.15); }
          60%  { transform: rotate(8deg) scale(1.2); }
          75%  { transform: rotate(-4deg) scale(1.1); opacity: 1; }
          85%  { transform: rotate(0deg) scale(1.3); opacity: 0.5; }
          100% { transform: rotate(0deg) scale(2); opacity: 0; }
        }
        .reveal-unlock {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          animation: reveal-unlock-pop 0.6s ease forwards;
          animation-delay: 0.85s;
        }
        @keyframes reveal-unlock-pop {
          0%   { opacity: 0; transform: scale(0.3) rotate(-20deg); }
          50%  { opacity: 1; transform: scale(1.4) rotate(5deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        .reveal-text {
          opacity: 0;
          animation: reveal-text-in 0.5s ease forwards;
          animation-delay: 1s;
        }
        @keyframes reveal-text-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .reveal-particles {
          position: absolute;
          width: 300px;
          height: 300px;
          pointer-events: none;
        }
        .reveal-particle {
          position: absolute;
          font-size: 1.5rem;
          opacity: 0;
          animation: reveal-particle-burst 0.8s ease forwards;
        }
        @keyframes reveal-particle-burst {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0); }
          40%  { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5) translateY(-20px); }
        }
      `}</style>
    </main>
  );
}

// ── Toggle Row component ──
function ToggleRow({
  label,
  desc,
  defaultOn,
}: {
  label: string;
  desc: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {desc && <div className="text-xs text-slate-400">{desc}</div>}
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`relative h-6 w-11 rounded-full transition ${
          on ? "bg-orange-500" : "bg-slate-300"
        }`}
      >
        <div
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
