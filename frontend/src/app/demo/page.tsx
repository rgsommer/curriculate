"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const STUDENT_APP_DEMO_URL =
  process.env.NEXT_PUBLIC_STUDENT_APP_URL?.replace(/\/$/, "") ||
  "https://play.curriculate.net";

/* ── Task type gallery data ── */
const CATEGORIES = [
  {
    name: "Knowledge & Comprehension",
    color: "from-blue-500 to-indigo-600",
    lightBg: "bg-blue-50",
    lightText: "text-blue-800",
    tasks: [
      { icon: "🔘", name: "Multiple Choice", desc: "Classic single-answer with AI-written distractors" },
      { icon: "🏃", name: "Physical Multiple Choice", desc: "Students run to corners of the room to answer" },
      { icon: "✅", name: "True / False", desc: "Quick binary comprehension checks" },
      { icon: "✍️", name: "Short Answer", desc: "Type a short response, AI evaluates accuracy" },
      { icon: "📖", name: "Reading Comprehension", desc: "Read a passage, summarize in one sentence" },
      { icon: "🔗", name: "Matching", desc: "Drag terms to their definitions" },
      { icon: "🃏", name: "Flashcards", desc: "Study mode — flip cards to review terms" },
      { icon: "⚡", name: "Flashcards Race", desc: "Competitive timed flashcard challenge" },
    ],
  },
  {
    name: "Ordering & Classification",
    color: "from-emerald-500 to-teal-600",
    lightBg: "bg-emerald-50",
    lightText: "text-emerald-800",
    tasks: [
      { icon: "📂", name: "Sort / Categorize", desc: "Drag items into the correct category buckets" },
      { icon: "🔢", name: "Sequence / Order", desc: "Arrange steps or events in correct order" },
      { icon: "📅", name: "Timeline", desc: "Place historical events on a chronological timeline" },
      { icon: "⭕", name: "Venn Sort", desc: "Sort items into overlapping Venn diagram categories" },
      { icon: "🏃‍♂️", name: "Mad Dash", desc: "Race to sort items correctly before time runs out" },
      { icon: "🏃‍♀️", name: "Mad Dash Sequence", desc: "Speed-run sequencing with a competitive twist" },
    ],
  },
  {
    name: "Creative Expression",
    color: "from-purple-500 to-violet-600",
    lightBg: "bg-purple-50",
    lightText: "text-purple-800",
    tasks: [
      { icon: "📝", name: "Open Text", desc: "Free-form written response with word count goals" },
      { icon: "✉️", name: "Letter Writing", desc: "Write to a historical figure — they write back via AI" },
      { icon: "🔍", name: "Case Study", desc: "Analyze a real-world scenario, get expert AI feedback" },
      { icon: "📖", name: "Storytelling", desc: "Build characters with your name — AI writes your story" },
      { icon: "🎤", name: "Record Audio", desc: "Speak your answer — voice recorded for the report" },
      { icon: "🎨", name: "Draw", desc: "Sketch a concept or diagram on the device" },
      { icon: "🤹", name: "Draw or Mime", desc: "Act it out OR draw it — teammates guess" },
      { icon: "🎭", name: "Mime", desc: "Act out a concept without speaking" },
    ],
  },
  {
    name: "Physical & Movement",
    color: "from-orange-500 to-red-500",
    lightBg: "bg-orange-50",
    lightText: "text-orange-800",
    tasks: [
      { icon: "💪", name: "Body Break", desc: "Quick physical activity between academic tasks" },
      { icon: "🏋️", name: "Motion Mission", desc: "Movement challenges tied to learning content" },
      { icon: "💺", name: "Musical Chairs", desc: "Classic game remixed with academic questions" },
      { icon: "📷", name: "Photo Evidence", desc: "Take a photo proving you found or made something" },
      { icon: "🛠️", name: "Make It & Snap It", desc: "Build something physical, photograph the result" },
      { icon: "📸", name: "Photo Journal", desc: "Document a multi-step process with photos" },
      { icon: "🔎", name: "Hide & Seek", desc: "Find hidden items or clues around the room" },
    ],
  },
  {
    name: "Games & Competition",
    color: "from-yellow-500 to-amber-600",
    lightBg: "bg-yellow-50",
    lightText: "text-yellow-800",
    tasks: [
      { icon: "⚡", name: "Brain Blitz!", desc: "Jeopardy-style clues — shout out the answer" },
      { icon: "❌", name: "Tic-Tac-Toe", desc: "True/False questions on a tic-tac-toe board" },
      { icon: "🔴", name: "Connect Four", desc: "True/False questions powering Connect Four drops" },
      { icon: "🏗️", name: "Tower Builder", desc: "Answer correctly to stack blocks — tallest tower wins" },
      { icon: "🐾", name: "Feed the Pet!", desc: "Correct answers feed your virtual pet" },
      { icon: "🎨", name: "Speed Draw", desc: "Draw the concept fast — teammates race to guess" },
      { icon: "🔤", name: "Hangman Duel", desc: "Classic hangman with vocabulary words" },
      { icon: "📝", name: "Word Weaver Duel", desc: "Competitive word-building challenge" },
      { icon: "🕵️", name: "Diff Detective", desc: "Spot the differences between two text passages" },
      { icon: "❓", name: "Guess Who", desc: "Narrow down clues to identify the mystery concept" },
      { icon: "🔁", name: "Echo Chain", desc: "Pass the device — each player adds to the chain" },
    ],
  },
  {
    name: "Discussion & Collaboration",
    color: "from-cyan-500 to-blue-600",
    lightBg: "bg-cyan-50",
    lightText: "text-cyan-800",
    tasks: [
      { icon: "🤝", name: "Collaboration", desc: "Pair up, respond to each other's ideas" },
      { icon: "🎙️", name: "Live Debate", desc: "Structured debate with timed arguments" },
      { icon: "⚖️", name: "AI Debate Judge", desc: "AI evaluates debate performance in real time" },
      { icon: "💡", name: "Brainstorm Battle", desc: "Generate as many ideas as possible in a time limit" },
    ],
  },
  {
    name: "Deduction & Mystery",
    color: "from-slate-600 to-gray-800",
    lightBg: "bg-slate-100",
    lightText: "text-slate-800",
    tasks: [
      { icon: "🔮", name: "Mystery Clue Cards", desc: "Piece together clues to solve a mystery" },
      { icon: "🎭", name: "Fake Out", desc: "Spot the fake fact among real ones" },
    ],
  },
  {
    name: "Synthesis & Higher-Order",
    color: "from-pink-500 to-rose-600",
    lightBg: "bg-pink-50",
    lightText: "text-pink-800",
    tasks: [
      { icon: "📋", name: "Brain Spark Notes", desc: "AI-generated study notes with key terms highlighted" },
      { icon: "🧠", name: "Mind Mapper", desc: "Build a concept map connecting ideas visually" },
      { icon: "📢", name: "Narration Synthesize", desc: "Listen to narration, synthesize the key takeaways" },
      { icon: "🎭", name: "Role Play Deck", desc: "Draw character cards and argue from that perspective" },
      { icon: "🎬", name: "Script Play", desc: "Act out a script — pass the device speaker to speaker" },
    ],
  },
  {
    name: "Language & Speaking",
    color: "from-teal-500 to-cyan-600",
    lightBg: "bg-teal-50",
    lightText: "text-teal-800",
    tasks: [
      { icon: "🗣️", name: "Pronunciation Practice", desc: "Practice saying words — AI checks your pronunciation" },
      { icon: "🎙️", name: "Speech Recognition", desc: "Speak your answer — AI transcribes and evaluates" },
    ],
  },
  {
    name: "Visual & Document Analysis",
    color: "from-indigo-500 to-blue-700",
    lightBg: "bg-indigo-50",
    lightText: "text-indigo-800",
    tasks: [
      { icon: "🖼️", name: "Art View", desc: "Analyze a work of art — describe, interpret, evaluate" },
      { icon: "📜", name: "Historical Document", desc: "Examine a primary source and answer questions" },
    ],
  },
  {
    name: "Fun & Engagement",
    color: "from-fuchsia-500 to-pink-600",
    lightBg: "bg-fuchsia-50",
    lightText: "text-fuchsia-800",
    tasks: [
      { icon: "🎯", name: "Trivia", desc: "Quick-fire trivia questions for fun — no grading pressure" },
      { icon: "🎡", name: "Spinner", desc: "Spin the wheel for a random challenge or reward" },
      { icon: "🤔", name: "Riddle", desc: "Solve a brain teaser tied to the lesson content" },
    ],
  },
];

const totalTasks = CATEGORIES.reduce((sum, c) => sum + c.tasks.length, 0);

export default function DemoPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedCat, setExpandedCat] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const url = new URL(STUDENT_APP_DEMO_URL);
        if (e.origin !== url.origin) return;
      } catch {
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const toggleFullscreen = () => setFullscreen((prev) => !prev);

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[9999] bg-slate-900">
        <button
          onClick={toggleFullscreen}
          className="fixed top-3 right-3 z-[10000] rounded-xl bg-white/90 px-4 py-2 text-sm font-extrabold shadow-lg border border-slate-200 hover:bg-white cursor-pointer"
        >
          Exit Fullscreen
        </button>
        <iframe
          ref={iframeRef}
          src={`${STUDENT_APP_DEMO_URL}/demo`}
          title="Curriculate Interactive Demo"
          className="w-full h-full border-none"
          allow="camera; microphone; autoplay"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-950" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }} />
        <div className="relative mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-4 py-1.5 text-sm font-semibold text-blue-200 border border-white/10 mb-6">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live Interactive Demo
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white leading-tight">
              {totalTasks}+ Task Types.{" "}
              <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                One Platform.
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-300 leading-relaxed">
              AI generates the lesson. Students move, write, debate, photograph, act, and collaborate —
              prompted by the device, not stuck on it. Every task type below is live and ready to use.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 justify-center">
              <a
                href="#try-demo"
                className="rounded-2xl bg-white px-8 py-3.5 text-base font-extrabold text-slate-900 shadow-lg hover:shadow-xl transition-shadow"
              >
                Try the Demo ↓
              </a>
              <Link
                href="https://www.curriculate.net"
                className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 px-8 py-3.5 text-base font-extrabold text-white hover:bg-white/20 transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── TASK TYPE GALLERY ── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-bold text-indigo-700 mb-4">
            Task Type Gallery
          </div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            Every way a student can learn
          </h2>
          <p className="mt-3 max-w-2xl mx-auto text-slate-500">
            From multiple choice to AI-generated storytelling, physical challenges to live debates —
            Curriculate gives teachers {totalTasks}+ task types across {CATEGORIES.length} categories.
          </p>
        </div>

        <div className="grid gap-4">
          {CATEGORIES.map((cat, catIdx) => {
            const isExpanded = expandedCat === catIdx;
            return (
              <div
                key={cat.name}
                className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md"
              >
                {/* Category header — always visible */}
                <button
                  onClick={() => setExpandedCat(isExpanded ? null : catIdx)}
                  className="w-full flex items-center gap-4 p-5 text-left cursor-pointer group"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center text-white text-xl font-bold shadow-sm flex-shrink-0`}>
                    {cat.tasks.length}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-extrabold text-slate-900 group-hover:text-indigo-700 transition-colors">
                      {cat.name}
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5 truncate">
                      {cat.tasks.map((t) => t.name).join(" · ")}
                    </p>
                  </div>
                  <div className={`text-xl text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                    ▾
                  </div>
                </button>

                {/* Expanded task grid */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {cat.tasks.map((task) => (
                        <div
                          key={task.name}
                          className={`rounded-xl ${cat.lightBg} p-4 border border-transparent hover:border-slate-200 transition-colors`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-2xl flex-shrink-0 mt-0.5">{task.icon}</span>
                            <div>
                              <div className={`font-bold text-sm ${cat.lightText}`}>
                                {task.name}
                              </div>
                              <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                                {task.desc}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Expand all / collapse all */}
        <div className="mt-4 text-center">
          <button
            onClick={() =>
              setExpandedCat(expandedCat !== null ? null : -1)
            }
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            {/* Not ideal but simple — let users click each individually */}
          </button>
        </div>
      </section>

      {/* ── HIGHLIGHT STATS ── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { stat: `${totalTasks}+`, label: "Task Types", icon: "🎯" },
            { stat: `${CATEGORIES.length}`, label: "Categories", icon: "📂" },
            { stat: "K–12", label: "Grade Range", icon: "🎓" },
            { stat: "0", label: "Screen Addiction", icon: "📵" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl bg-white border border-slate-200 p-5 text-center shadow-sm"
            >
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="text-3xl font-black text-slate-900">{s.stat}</div>
              <div className="text-sm text-slate-500 font-semibold mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SCREEN-LIGHT CALLOUT ── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-8 text-white text-center">
          <h3 className="text-2xl font-black mb-3">
            Technology-driven, not screen-driven.
          </h3>
          <p className="max-w-2xl mx-auto text-indigo-100 leading-relaxed">
            Curriculate is driven by technology but the student experience is about movement and tasks
            that are prompted by the device, not on it. Students write on paper, debate face to face,
            photograph real objects, and move between stations — the phone is a launchpad, not a destination.
          </p>
        </div>
      </section>

      {/* ── INTERACTIVE DEMO ── */}
      <section id="try-demo" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="text-center mb-8">
          <div className="inline-flex items-center rounded-full bg-green-50 px-4 py-1.5 text-sm font-bold text-green-700 mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-2" />
            Interactive
          </div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            Try it yourself
          </h2>
          <p className="mt-3 max-w-xl mx-auto text-slate-500">
            This is the actual student app. Pick a task, interact with it, and see how it works.
          </p>
          <button
            onClick={toggleFullscreen}
            className="mt-4 rounded-xl bg-slate-900 text-white px-6 py-2.5 text-sm font-extrabold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Open Fullscreen
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-2xl">
          {!loaded && (
            <div className="flex flex-col items-center justify-center py-20 text-white">
              <div className="w-8 h-8 border-3 border-white/20 border-t-blue-400 rounded-full animate-spin mb-4" />
              <div className="font-bold">Loading interactive demo...</div>
              <div className="text-sm text-slate-400 mt-1">
                This loads the actual student app experience
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={`${STUDENT_APP_DEMO_URL}/demo`}
            title="Curriculate Interactive Demo"
            className="w-full border-none transition-opacity duration-300"
            style={{
              height: "calc(100vh - 200px)",
              minHeight: 600,
              opacity: loaded ? 1 : 0,
            }}
            onLoad={() => setLoaded(true)}
            allow="camera; microphone; autoplay"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-slate-900 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-black text-white mb-4">
            Ready to transform your classroom?
          </h2>
          <p className="text-slate-400 mb-8 max-w-xl mx-auto">
            AI plans the lesson. You run the room. Students own the learning.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="https://www.curriculate.net/signup"
              className="rounded-2xl bg-white px-8 py-3.5 text-base font-extrabold text-slate-900 shadow-lg hover:shadow-xl transition-shadow"
            >
              Get Started Free
            </Link>
            <Link
              href="https://www.curriculate.net/features"
              className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 px-8 py-3.5 text-base font-extrabold text-white hover:bg-white/20 transition-colors"
            >
              See All Features
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
