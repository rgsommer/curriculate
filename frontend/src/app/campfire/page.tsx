"use client";

import { useState } from "react";
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
  | "favs"
  | "notifs"
  | "profile";

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
  options?: string[];
  votes?: number[];
  desc?: string;
  deadline?: string;
  submitted?: Member[];
  questions?: string[];
}

interface Group {
  id: number;
  name: string;
  members: string[];
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
    engagements: [
      {
        id: 1,
        type: "poll",
        title: "Where should we go for Thanksgiving?",
        by: "MJ",
        time: "2h ago",
        responses: 3,
        total: 5,
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
    ],
  },
  {
    id: 2,
    name: "Men's Accountability",
    members: ["RS", "DW", "JT", "BL"],
    engagements: [
      {
        id: 4,
        type: "accountability",
        title: "Weekly Check-in",
        by: "DW",
        time: "5h ago",
        responses: 2,
        total: 4,
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
      },
    ],
  },
  {
    id: 3,
    name: "College Friends",
    members: ["RS", "AK", "NP", "LR", "CM", "TD"],
    engagements: [
      {
        id: 6,
        type: "game",
        title: "Chess match — RS vs AK",
        by: "AK",
        time: "12h ago",
        responses: 0,
        total: 2,
      },
      {
        id: 7,
        type: "guess",
        title: "Guess where this photo was taken!",
        by: "NP",
        time: "2d ago",
        responses: 5,
        total: 6,
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
    ],
  },
  {
    id: 4,
    name: "Church Small Group",
    members: ["RS", "PH", "SW", "ML", "KD"],
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
        options: ["Romans", "Ecclesiastes", "James", "Philippians"],
        votes: [2, 0, 2, 1],
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

// ── Badge color map ──
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
  const [selectedPollIdx, setSelectedPollIdx] = useState<number | null>(null);
  const [pollSubmitted, setPollSubmitted] = useState(false);
  const [challengeUploaded, setChallengeUploaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedEngType, setSelectedEngType] = useState<EngType | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("home");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function openGroup(g: Group) {
    setCurrentGroup(g);
    setScreen("group");
  }

  function openEngagement(eng: Engagement) {
    setCurrentEng(eng);
    setSelectedPollIdx(null);
    setPollSubmitted(false);
    setChallengeUploaded(false);
    if (eng.type === "poll" && eng.options) {
      setScreen("poll");
    } else if (eng.type === "challenge") {
      setScreen("challenge");
    } else {
      showToast(`${eng.type.charAt(0).toUpperCase() + eng.type.slice(1)} detail coming soon`);
    }
  }

  function switchTab(tab: string) {
    setActiveTab(tab);
    setScreen(tab as Screen);
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
                <div className="text-sm text-slate-500 truncate">
                  {g.engagements[0]?.title ?? "No engagements yet"}
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
              <span
                className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mb-1.5 ${
                  typeBadge[eng.type] || "bg-slate-100 text-slate-600"
                }`}
              >
                {eng.type}
              </span>
              <div className="font-semibold text-sm text-slate-900 mb-1">{eng.title}</div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>by {eng.by}</span>
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                <span>{eng.time}</span>
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                <span>{eng.responses}/{eng.total} responded</span>
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
    return (
      <>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={() => setScreen("group")} className="text-lg text-orange-600 font-bold">
            &larr;
          </button>
          <h3 className="text-base font-bold text-slate-900">Poll</h3>
        </div>
        <div className="p-5 flex-1">
          <h2 className="text-lg font-extrabold text-slate-900 mb-5 leading-snug">
            {currentEng.title}
          </h2>
          <div className="flex flex-col gap-2.5">
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
                      : "border-slate-200"
                  }`}
                >
                  {pollSubmitted && (
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
                  {pollSubmitted && (
                    <span className="relative z-10 ml-auto text-sm font-bold text-orange-600">
                      {pct}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            disabled={selectedPollIdx === null || pollSubmitted}
            onClick={() => {
              setPollSubmitted(true);
              showToast("Your vote has been recorded!");
            }}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pollSubmitted ? "Vote Submitted!" : "Submit Vote"}
          </button>
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
        <div className="p-5 flex-1">
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
          <button
            onClick={() => {
              if (!challengeUploaded) {
                setChallengeUploaded(true);
                showToast("Response submitted! Waiting for others...");
              }
            }}
            className={`w-full rounded-2xl border-2 border-dashed p-8 text-center transition ${
              challengeUploaded
                ? "border-emerald-400 bg-emerald-50"
                : "border-slate-300 hover:border-orange-400 hover:bg-orange-50 cursor-pointer"
            }`}
          >
            <div className="text-3xl mb-2">{challengeUploaded ? "✅" : "📷"}</div>
            <div className="text-sm text-slate-600">
              {challengeUploaded ? "Response uploaded!" : "Tap to upload your response"}
            </div>
          </button>

          {currentEng.submitted && (
            <>
              <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Responses ({currentEng.responses}/{currentEng.total})
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
                        {s.done ? "Submitted" : "Waiting..."}
                      </div>
                    </div>
                    {s.done && <span className="text-emerald-500 font-bold">✓</span>}
                  </div>
                ))}
              </div>
            </>
          )}
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
      {/* Page header */}
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

      {/* Phone mockup */}
      <div className="flex justify-center px-4 pb-16">
        <div className="relative w-full max-w-[400px]">
          {/* Phone frame */}
          <div className="rounded-[2.5rem] border-[6px] border-slate-800 bg-white shadow-2xl overflow-hidden">
            {/* Status bar */}
            <div className="flex items-center justify-between bg-slate-800 px-6 py-1.5 text-[11px] font-medium text-white">
              <span>9:41</span>
              <div className="flex items-center gap-1.5">
                <span>●●●●</span>
                <span>WiFi</span>
                <span>🔋</span>
              </div>
            </div>

            {/* App header */}
            <div className="flex items-center justify-between bg-white px-4 py-2.5 border-b border-slate-100">
              <span className="text-lg font-extrabold bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                Campfire
              </span>
              <span className="text-xs text-slate-400">v0.1 prototype</span>
            </div>

            {/* Screen content — fixed height for phone feel */}
            <div className="h-[520px] overflow-y-auto bg-slate-50">
              {screen === "home" && renderHome()}
              {screen === "group" && renderGroupDetail()}
              {screen === "poll" && renderPoll()}
              {screen === "challenge" && renderChallenge()}
              {screen === "favs" && renderFavourites()}
              {screen === "notifs" && renderNotifications()}
              {screen === "profile" && renderProfile()}
            </div>

            {/* FAB */}
            {(screen === "home" || screen === "group") && (
              <button
                onClick={() => setShowModal(true)}
                className="absolute bottom-[72px] right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-xl text-white shadow-lg transition hover:scale-105"
              >
                +
              </button>
            )}

            {/* Tab bar */}
            <div className="flex items-center justify-around border-t border-slate-200 bg-white py-2">
              {[
                { key: "home", icon: "🏠", label: "Home" },
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

      {/* Create engagement modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="w-full max-w-[400px] rounded-t-3xl bg-white p-5 animate-slide-up">
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
                    <option>All at once</option>
                    <option>First in</option>
                    <option>As they come</option>
                    <option>Instant</option>
                  </select>
                </div>
                <ToggleRow label="Offer a reward" desc="For the winner" defaultOn={false} />
                <ToggleRow label="Add random guest" desc="" defaultOn={false} />
                <ToggleRow label="Adult content" desc="" defaultOn={false} />

                <button
                  onClick={() => {
                    setShowModal(false);
                    showToast(
                      `${selectedEngType.charAt(0).toUpperCase() + selectedEngType.slice(1)} engagement created!`
                    );
                    setSelectedEngType(null);
                  }}
                  className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3 text-sm font-bold text-white shadow-md mt-2"
                >
                  Create Engagement
                </button>
              </div>
            )}
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