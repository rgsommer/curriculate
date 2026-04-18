// frontend/src/app/page.tsx
"use client";
import React from "react";
import Link from "next/link";
import HoverVideo from "../components/HoverVideo";
import {
  ArrowRight,
  Sparkles,
  CheckCircle,
  Printer,
  Zap,
  Users,
  BarChart3,
  Footprints,
  ShieldCheck,
  Clock,
  FileText,
  Brain,
  Target,
  Gamepad2,
  MessageSquare,
  GraduationCap,
  TrendingUp,
  Star,
  Check,
  X,
  ChevronDown,
  Smartphone,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const painPoints = [
  {
    pain: "Station rotation takes hours to prep",
    fix: "AI plans time-fit task sets in under 60 seconds",
    icon: <Clock className="w-5 h-5" />,
  },
  {
    pain: "Students wander and go off-task",
    fix: "QR-coded stations with built-in timers and guided rotation",
    icon: <Target className="w-5 h-5" />,
  },
  {
    pain: "No way to see who learned what",
    fix: "Live response tracking + AI-generated reports per student",
    icon: <BarChart3 className="w-5 h-5" />,
  },
  {
    pain: "Grading takes all weekend",
    fix: "Auto-scored tasks + AI gradebook with custom strands",
    icon: <FileText className="w-5 h-5" />,
  },
];

const taskCategories = [
  {
    label: "Core Q&A",
    color: "bg-blue-100 text-blue-700",
    tasks: ["Multiple Choice", "Physical Multiple Choice", "True / False", "Short Answer", "Reading Comp", "Open Text"],
  },
  {
    label: "Creative & Media",
    color: "bg-purple-100 text-purple-700",
    tasks: ["Draw", "Photo Evidence", "Record Audio", "Photo Journal", "Make It & Snap It", "Speed Draw", "Draw & Mime"],
  },
  {
    label: "Movement & Body",
    color: "bg-emerald-100 text-emerald-700",
    tasks: ["Body Break", "Musical Chairs", "Motion Mission", "Mad Dash", "Mad Dash Sequence", "Treasure Runner", "Hide & Seek"],
  },
  {
    label: "Games & Competition",
    color: "bg-amber-100 text-amber-700",
    tasks: ["Brain Blitz!", "Tic-Tac-Toe", "Connect Four", "Flashcards", "Flashcards Race", "Hangman Duel", "Tower Builder", "Pet Feeding", "Spinner"],
  },
  {
    label: "Ordering & Sorting",
    color: "bg-rose-100 text-rose-700",
    tasks: ["Sort / Categorize", "Sequence", "Matching", "Timeline", "Venn Sort"],
  },
  {
    label: "Discussion & Debate",
    color: "bg-indigo-100 text-indigo-700",
    tasks: ["Live Debate", "AI Debate Judge", "Collaboration", "Brainstorm Battle"],
  },
  {
    label: "Deduction & Mystery",
    color: "bg-teal-100 text-teal-700",
    tasks: ["Mystery Clue Cards", "Fake Out", "Diff Detective", "Guess Who", "Riddle", "Trivia"],
  },
  {
    label: "Synthesis & Thinking",
    color: "bg-orange-100 text-orange-700",
    tasks: ["Brain Spark Notes", "Mind Mapper", "Narration Synthesize", "Case Study", "Echo Chain"],
  },
  {
    label: "Role Play & Performance",
    color: "bg-pink-100 text-pink-700",
    tasks: ["Role Play", "Role Play Deck", "Script Play", "Mime", "Letter Writing"],
  },
  {
    label: "Language & Speech",
    color: "bg-cyan-100 text-cyan-700",
    tasks: ["Pronunciation", "Speech Recognition", "Word Weaver Duel", "Hangman Duel"],
  },
  {
    label: "Visual Analysis",
    color: "bg-violet-100 text-violet-700",
    tasks: ["Art View", "Historical Document Analysis"],
  },
  {
    label: "Feedback & Meta",
    color: "bg-gray-100 text-gray-700",
    tasks: ["Mood Check-In", "Multi-Player Feedback"],
  },
];

const reportFeatures = [
  {
    title: "AI Session Summary",
    desc: "Class-level overview with engagement, proficiency, key concepts, and a ready-to-paste blurb for your class chat.",
    icon: <Sparkles className="w-5 h-5 text-blue-600" />,
  },
  {
    title: "Student Gradebook",
    desc: "Letter grades across teacher-defined assessment strands. Export to XLSX or drop into your LMS.",
    icon: <GraduationCap className="w-5 h-5 text-emerald-600" />,
  },
  {
    title: "Individual Student Reports",
    desc: "One-page PDF per student: what they did well, skills practiced, areas to grow. Print or email home.",
    icon: <FileText className="w-5 h-5 text-purple-600" />,
  },
  {
    title: "Live Analytics Dashboard",
    desc: "See accuracy, engagement, and task completion in real time while the session is running.",
    icon: <TrendingUp className="w-5 h-5 text-indigo-600" />,
  },
];

const pricingFeatures = [
  { name: "AI task set generation", free: true, plus: true, pro: true },
  { name: "65+ task types", free: true, plus: true, pro: true },
  { name: "Mystery Box navigation mode", free: true, plus: true, pro: true },
  { name: "Team selfie (2 free sessions)", free: "2 sessions", plus: true, pro: true },
  { name: "AI-themed selfie images", free: false, plus: true, pro: true },
  { name: "Station rotation engine", free: true, plus: true, pro: true },
  { name: "QR station posters", free: true, plus: true, pro: true },
  { name: "Session summary reports", free: true, plus: true, pro: true },
  { name: "Student-level reporting", free: false, plus: true, pro: true },
  { name: "PDF report exports", free: false, plus: true, pro: true },
  { name: "AI gradebook with strands", free: false, plus: true, pro: true },
  { name: "XLSX gradebook export", free: false, plus: true, pro: true },
  { name: "Individual student reports", free: false, plus: false, pro: true },
  { name: "Expanded AI generation", free: false, plus: false, pro: true },
  { name: "Advanced analytics", free: false, plus: false, pro: true },
  { name: "Full classroom capacity", free: false, plus: false, pro: true },
];

const why = [
  {
    icon: <Footprints className="w-6 h-6 text-blue-600" />,
    title: "Purposeful movement",
    desc: "Stations get students moving with structure — not wandering.",
  },
  {
    icon: <Users className="w-6 h-6 text-purple-600" />,
    title: "Real collaboration",
    desc: "Teams submit together, build roles naturally, and learn from each other.",
  },
  {
    icon: <Zap className="w-6 h-6 text-yellow-600" />,
    title: "More than recall",
    desc: "Debate, creation, explanation, and evidence — not just multiple choice.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-emerald-600" />,
    title: "Instant insight",
    desc: "See understanding during the lesson and adjust in real time.",
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-indigo-600" />,
    title: "Teacher-controlled AI",
    desc: "AI plans pacing + task mix first — then generates. Always teacher-controlled and overrideable.",
  },
  {
    icon: <Smartphone className="w-6 h-6 text-rose-500" />,
    title: "Technology-driven, not screen-driven",
    desc: "The device prompts and captures — students write on paper, observe, move, discuss, and create. The screen is a launchpad, not the destination.",
  },
];

const steps = [
  { n: "1", title: "Launch a task set", desc: "Start from the Teacher Dashboard in one click." },
  { n: "2", title: "Teams join fast", desc: "No accounts — just a room code + team name." },
  { n: "3", title: "Rotate stations", desc: "Color-coded QR stations guide movement. Teachers pick which color matches each physical object." },
  { n: "4", title: "Submit together", desc: "Text, photos, drawings, audio — evidence included." },
  { n: "5", title: "Reports generated", desc: "Teacher + student reports appear automatically." },
];

/* ------------------------------------------------------------------ */
/*  COMPONENTS                                                         */
/* ------------------------------------------------------------------ */

function Testimonials() {
  const [active, setActive] = React.useState<"teacher" | "student">("teacher");
  const [controls, setControls] = React.useState(false);
  const [unmuted, setUnmuted] = React.useState(false);

  const teacherRef = React.useRef<HTMLVideoElement | null>(null);
  const studentRef = React.useRef<HTMLVideoElement | null>(null);

  function getActiveVideo() {
    return active === "teacher" ? teacherRef.current : studentRef.current;
  }
  function getOtherVideo() {
    return active === "teacher" ? studentRef.current : teacherRef.current;
  }

  function resetVideo(v: HTMLVideoElement | null) {
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    v.muted = true;
  }

  React.useEffect(() => {
    setControls(false);
    setUnmuted(false);
    resetVideo(getOtherVideo());
    const v = getActiveVideo();
    if (!v) return;
    v.muted = true;
    v.loop = true;
    v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function onTap() {
    const v = getActiveVideo();
    if (!v) return;
    if (v.muted) {
      v.muted = false;
      setUnmuted(true);
      setControls(true);
      v.play().catch(() => {});
      return;
    }
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  const btnBase =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold transition";
  const btnOn =
    "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm";
  const btnOff =
    "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50";

  return (
    <section className="mx-auto mt-24 max-w-6xl px-6">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
          Real Voices. Real Learning.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-gray-600">
          Autoplay muted for browsing. Tap to play with sound and captions.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => setActive("teacher")}
            className={`${btnBase} ${active === "teacher" ? btnOn : btnOff}`}
          >
            Teacher
          </button>
          <button
            type="button"
            onClick={() => setActive("student")}
            className={`${btnBase} ${active === "student" ? btnOn : btnOff}`}
          >
            Student
          </button>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-4xl">
        <div className="rounded-3xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          <div
            className="relative cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label="Tap to play / unmute"
            onClick={onTap}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTap();
              }
            }}
          >
            <video
              ref={teacherRef}
              src="/testimonials/teacher-testimonial.mp4"
              poster="/images/posters/teacher-testimonial.png"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              controls={controls && active === "teacher"}
              className={`w-full h-auto ${active === "teacher" ? "block" : "hidden"}`}
            >
              <track
                kind="captions"
                src="/testimonials/teacher-testimonial.vtt"
                srcLang="en"
                label="English"
                default
              />
            </video>

            <video
              ref={studentRef}
              src="/testimonials/student-testimonial.mp4"
              poster="/images/posters/student-testimonial.png"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              controls={controls && active === "student"}
              className={`w-full h-auto ${active === "student" ? "block" : "hidden"}`}
            >
              <track
                kind="captions"
                src="/testimonials/student-testimonial.vtt"
                srcLang="en"
                label="English"
                default
              />
            </video>

            <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-extrabold text-white">
                {unmuted ? "Tap to pause/play" : "Tap for sound"}
              </span>
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-extrabold text-white">
                CC
              </span>
            </div>
          </div>

          <div className="p-6">
            {active === "teacher" ? (
              <>
                <h3 className="text-lg font-extrabold text-gray-900">
                  For Teachers
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Less prep. Smooth station flow. End-of-session reports that
                  support grading and formative feedback for students and
                  parents.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-extrabold text-gray-900">
                  For Students
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Learning by doing — moving, collaborating, and understanding
                  the material more deeply, not just memorizing it.
                </p>
              </>
            )}

            <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-gray-500">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                Autoplay muted
              </span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                Tap to hear audio
              </span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                Captions available
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SampleMultipleChoice() {
  return (
    <div className="max-w-md mx-auto">
      <h3 className="text-2xl font-extrabold text-gray-900 mb-6 text-center">
        Photosynthesis Review
      </h3>

      <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50/60 p-6 shadow-inner">
        <p className="text-lg font-bold text-gray-800 mb-6 text-center">
          What is the primary source of energy for Earth&apos;s climate system?
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-emerald-500 text-white px-4 py-4 font-bold shadow">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-emerald-600 font-black">
              ✓
            </span>
            The Sun
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
            Geothermal heat
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
            Ocean currents
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
            Earth&apos;s core
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = React.useState(false);

  const links = [
    { href: "/how-it-works", label: "How it works" },
    { href: "/features", label: "Features" },
    { href: "/ai-grading", label: "AI Grading" },
    { href: "/pricing", label: "Pricing" },
    { href: "/compare", label: "Compare" },
    { href: "/reports", label: "Reports" },
    { href: "/station-posters", label: "Station Posters" },
    { href: "/faq", label: "FAQ" },
    { href: "/contact", label: "Contact" },
    { href: "/referrals", label: "Referral Program" },
    { href: "/signup", label: "Sign up" },
    { href: "/dashboard", label: "Login" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden fixed top-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white/90 backdrop-blur px-4 py-3 shadow-xl font-black text-gray-900"
        aria-label="Open menu"
      >
        ☰
      </button>

      {open && (
        <div className="sm:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu backdrop"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-4 left-4 right-4 rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
              <div className="font-black text-gray-900">Menu</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-2xl border border-gray-200 bg-white px-3 py-2 font-black text-gray-900"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 gap-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-3 font-extrabold text-gray-900 hover:bg-gray-50"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SmartPlanning() {
  const bullets = [
    "Plans the experience first — then generates tasks to match.",
    "Fits the time you specify (e.g., a 45-minute set actually fills ~45 minutes).",
    "Chooses task types appropriate for grade, purpose, topic, and key concepts.",
    "Includes movement/body-break tasks intentionally (never overused, never back-to-back).",
    "Only uses task types that are implemented and supported in the student app.",
    "Selects task types appropriate to the subject — debates for history, logic for math, pronunciation for languages.",
    "Supports Party Mode and Event Mode for birthdays, team-building, and corporate events.",
  ];

  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-extrabold text-blue-800">
            <Brain className="w-4 h-4" /> Smart Task Planning
          </div>

          <h2 className="text-4xl font-black text-gray-900 mt-4 mb-3">
            Not just AI task generation — AI pacing and orchestration
          </h2>

          <p className="text-lg text-gray-700 font-medium max-w-3xl mb-8">
            Curriculate doesn&apos;t generate a random pile of activities. It first plans a
            time-fit, grade-appropriate mix of task types for your topic and learning
            goal — then generates tasks to match that plan.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {bullets.map((b) => (
              <div key={b} className="flex items-start gap-2 text-gray-800 font-medium">
                <span className="mt-1 text-emerald-600 font-black">✓</span>
                <span>{b}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl bg-gray-50 border border-gray-200 p-5">
            <div className="text-sm font-extrabold text-gray-900">
              Why this matters
            </div>
            <p className="mt-2 text-sm text-gray-700 font-medium">
              Teachers choose the lesson length. Curriculate chooses the task count and
              mix — so pacing stays consistent across classes.
            </p>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              href="/features"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              See the planning features <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [stationMode, setStationMode] = React.useState<"single" | "multi">("single");
  const [expandedCat, setExpandedCat] = React.useState<number | null>(null);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <MobileNav />

      {/* ============================================================ */}
      {/*  HERO — Pain-first                                           */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden px-6 pt-14 pb-8 sm:pt-24 sm:pb-12">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[400px] w-[400px] rounded-full bg-indigo-200/30 blur-3xl" />

        <div className="relative mx-auto max-w-7xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-800 mb-6">
            <Sparkles className="w-4 h-4" /> Used by teachers across Canada and the US
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-gray-900 mb-5 leading-[1.08] tracking-tight max-w-4xl mx-auto">
            Every teacher wants students moving, thinking, and collaborating.{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
              Few have time to prep all that.
            </span>{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
              Fewer have time to assess it.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-600 mb-4 max-w-2xl mx-auto font-medium leading-relaxed">
            Curriculate plans, generates, and runs station-based lessons for you — with built-in movement,
            real-time scoring, and AI reports that land in your inbox before the bell rings.
          </p>

          <p className="text-base text-gray-500 mb-8 sm:mb-10 max-w-xl mx-auto">
            No student accounts. No app downloads. Works on any device with a browser.
          </p>

          <div className="grid grid-cols-1 sm:flex sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-14 max-w-md sm:max-w-none mx-auto">
            <Link
              href="/dashboard"
              className="group inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-10 rounded-2xl shadow-2xl transform hover:scale-[1.02] transition-all"
            >
              Get Started Free
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition" />
            </Link>

            <Link
              href="/reports"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-900 text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-8 rounded-2xl shadow-xl border border-gray-200"
            >
              View Sample Reports
            </Link>

            <Link
              href="/pdfs/Curriculate-Station-Posters.pdf"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-8 rounded-2xl shadow-2xl"
            >
              <Printer className="w-6 h-6" />
              Station Posters
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  PAIN → SOLUTION CARDS                                       */}
      {/* ============================================================ */}
      <section className="px-6 pb-10">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {painPoints.map((p) => (
              <div
                key={p.pain}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg hover:shadow-xl transition-shadow"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="mt-0.5 rounded-xl bg-red-50 p-2 text-red-500">
                    {p.icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-red-600 line-through decoration-red-300">
                      {p.pain}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-emerald-50 p-2 text-emerald-600">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-bold text-gray-900">{p.fix}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  LIVE PREVIEW (existing — preserved)                         */}
      {/* ============================================================ */}
      <section className="px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900">
              See what students see
            </h2>
            <p className="mt-2 text-gray-600 font-medium max-w-xl mx-auto">
              Beautiful, interactive tasks on any device — no app install required.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-10 items-start">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-200">
                <div className="bg-gray-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 border-b">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  </div>
                  <div className="ml-2 sm:ml-4 flex-1 bg-white rounded-lg px-3 sm:px-4 py-1 text-xs sm:text-sm text-gray-600 truncate">
                    curriculate.net/play/abcd1234
                  </div>
                </div>

                <div className="p-6 sm:p-10">
                  <SampleMultipleChoice />
                </div>
              </div>
              <p className="text-center mt-6 sm:mt-8 text-gray-500 font-medium text-sm sm:text-base">
                ↑ This is what your students see — live, beautiful, and instant
              </p>
            </div>

            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-24">
                <div className="rounded-3xl border border-gray-200 bg-white shadow-xl overflow-hidden">
                  <div className="px-4 py-3 border-b bg-gray-50">
                    <div className="text-sm font-extrabold text-gray-900">Station Preview</div>
                    <div className="text-xs text-gray-600 font-medium">Hover (desktop) / Tap (mobile) to switch</div>
                  </div>

                  <div className="p-3">
                    <div className="mx-auto w-full max-w-sm lg:max-w-none">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="Toggle station preview"
                        onClick={() =>
                          setStationMode((m) => (m === "single" ? "multi" : "single"))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setStationMode((m) => (m === "single" ? "multi" : "single"));
                          }
                        }}
                        className="cursor-pointer"
                      >
                        <HoverVideo
                          primarySrc={
                            stationMode === "single"
                              ? "/videos/station-rotation-single-room.mp4"
                              : "/videos/station-rotation-multi-room.mp4"
                          }
                          hoverSrc={
                            stationMode === "single"
                              ? "/videos/station-rotation-multi-room.mp4"
                              : "/videos/station-rotation-single-room.mp4"
                          }
                          primaryPoster={
                            stationMode === "single"
                              ? "/images/posters/station-rotation-single-room.png"
                              : "/images/posters/station-rotation-multi-room.png"
                          }
                          hoverPoster={
                            stationMode === "single"
                              ? "/images/posters/station-rotation-multi-room.png"
                              : "/images/posters/station-rotation-single-room.png"
                          }
                          label="Station Rotation Preview"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="px-4 pb-4">
                    <p className="text-xs text-gray-500 font-medium">
                      Desktop: hover to compare. Mobile: tap to switch views.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  TASK TYPE GALLERY                                           */}
      {/* ============================================================ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-4 py-1.5 text-sm font-bold text-purple-800 mb-4">
              <Gamepad2 className="w-4 h-4" /> 65+ Task Types
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              Way more than multiple choice
            </h2>
            <p className="text-lg text-gray-600 font-medium max-w-2xl mx-auto">
              Debates, drawing, audio recording, mystery clues, movement breaks, flashcard races,
              tic-tac-toe, mind mapping — and the AI knows when to use each one.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {taskCategories.map((cat, i) => (
              <div
                key={cat.label}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setExpandedCat(expandedCat === i ? null : i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedCat(expandedCat === i ? null : i);
                  }
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${cat.color}`}>
                    {cat.label}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${expandedCat === i ? "rotate-180" : ""}`}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(expandedCat === i ? cat.tasks : cat.tasks.slice(0, 3)).map((t) => (
                    <span
                      key={t}
                      className="inline-block rounded-lg bg-gray-50 border border-gray-100 px-2 py-1 text-xs font-semibold text-gray-700"
                    >
                      {t}
                    </span>
                  ))}
                  {expandedCat !== i && cat.tasks.length > 3 && (
                    <span className="inline-block rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-500">
                      +{cat.tasks.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 text-blue-600 font-bold hover:text-blue-700 transition"
            >
              See all task types and how they work <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  WHY SECTION                                                 */}
      {/* ============================================================ */}
      <section className="px-6 py-14">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black text-gray-900 text-center mb-4">
            Not another quiz app. A better way to run class.
          </h2>
          <p className="text-lg text-gray-700 text-center max-w-3xl mx-auto mb-10">
            Curriculate blends movement, teamwork, and formative assessment — while keeping teachers in control.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {why.map((f) => (
              <div key={f.title} className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                    {f.icon}
                  </div>
                  <h3 className="text-xl font-extrabold text-gray-900">{f.title}</h3>
                </div>
                <p className="text-gray-700 font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SmartPlanning />

      {/* ============================================================ */}
      {/*  NEW FEATURES HIGHLIGHT                                      */}
      {/* ============================================================ */}
      <section className="px-6 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-800 mb-4">
              <Zap className="w-4 h-4" /> What&apos;s New
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              Built for how real classrooms work
            </h2>
            <p className="text-lg text-gray-600 font-medium max-w-2xl mx-auto">
              Recent additions that teachers asked for — and students love.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: "Subject-Smart Task Selection",
                desc: "The AI now knows which task types fit each subject. Math gets logic puzzles; history gets debates and document analysis. Movement breaks stay for everyone.",
                tag: "AI",
                tagColor: "bg-blue-100 text-blue-700",
              },
              {
                title: "Historical Document Analysis",
                desc: "Students view a primary source full-screen, then answer guided analysis prompts from memory. Perfect for history and social studies.",
                tag: "New Task",
                tagColor: "bg-purple-100 text-purple-700",
              },
              {
                title: "Fixed Station Color Picker",
                desc: "Teachers assign colored QR stations to physical objects — microscopes, maps, models — and the AI generates tasks specific to each station.",
                tag: "Stations",
                tagColor: "bg-emerald-100 text-emerald-700",
              },
              {
                title: "Auto-Start Modes",
                desc: "Load a task set before students arrive. It launches automatically when the first team joins, when enough teams are ready, or on a timer.",
                tag: "Launch",
                tagColor: "bg-amber-100 text-amber-700",
              },
              {
                title: "Station Setup Checklist",
                desc: "Before launch, a checklist confirms each physical station is in place — with color, object name, and a checkbox. No more forgotten stations.",
                tag: "UX",
                tagColor: "bg-rose-100 text-rose-700",
              },
              {
                title: "Guided Onboarding Tour",
                desc: "First-time users get a spotlight tour of both the AI Generator and Presenter Console. Advanced options stay hidden until needed.",
                tag: "Onboarding",
                tagColor: "bg-indigo-100 text-indigo-700",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg hover:shadow-xl transition-shadow"
              >
                <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${f.tagColor} mb-3`}>
                  {f.tag}
                </span>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 font-medium leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  REPORTS & ANALYTICS SHOWCASE                                */}
      {/* ============================================================ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-800 mb-4">
              <BarChart3 className="w-4 h-4" /> Reports & Analytics
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              The session ends. The reports are already done.
            </h2>
            <p className="text-lg text-gray-600 font-medium max-w-2xl mx-auto">
              AI-generated summaries, per-student grades, exportable PDFs — delivered to your inbox
              before students leave the room.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reportFeatures.map((rf) => (
              <div
                key={rf.title}
                className="group rounded-2xl border border-gray-200 bg-white p-6 shadow-lg hover:shadow-xl transition-all hover:border-blue-200"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 group-hover:bg-blue-50 group-hover:border-blue-200 transition-colors">
                    {rf.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-gray-900 mb-1">{rf.title}</h3>
                    <p className="text-sm text-gray-600 font-medium leading-relaxed">{rf.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="rounded-xl bg-white border border-emerald-200 p-3">
                <MessageSquare className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-extrabold text-gray-900">Class Chat Blurb</h3>
                <p className="text-sm text-gray-700 font-medium mt-1">
                  Every report includes a ready-to-paste paragraph for Google Classroom or your class chat —
                  naming the top teams, top players, skills practiced, and concepts covered. Copy, paste, done.
                </p>
              </div>
              <Link
                href="/reports"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-white font-bold shadow hover:bg-emerald-700 transition shrink-0"
              >
                See sample reports <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  HOW IT WORKS                                                */}
      {/* ============================================================ */}
      <section className="px-6 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
            <h2 className="text-4xl font-black text-gray-900 mb-3">How it works</h2>
            <p className="text-lg text-gray-700 font-medium mb-10 max-w-3xl">
              A clear, repeatable flow that supports both energetic and structured classrooms.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              {steps.map((s) => (
                <div key={s.n} className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
                  <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white font-black flex items-center justify-center mb-4">
                    {s.n}
                  </div>
                  <h3 className="text-lg font-extrabold text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-gray-700 font-medium">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/features"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
              >
                Explore Features <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
              >
                See Plans
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  PRICING COMPARISON TABLE                                    */}
      {/* ============================================================ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-800 mb-4">
              <Star className="w-4 h-4" /> Simple Pricing
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              Start free. Upgrade when you need more.
            </h2>
            <p className="text-lg text-gray-600 font-medium max-w-2xl mx-auto">
              The free plan runs full sessions with AI generation. Paid plans unlock deeper reporting,
              higher capacity, and individual student reports.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-200">
              <div className="p-4 sm:p-5">
                <span className="text-sm font-bold text-gray-500">Feature</span>
              </div>
              <div className="p-4 sm:p-5 text-center">
                <div className="text-sm font-extrabold text-gray-900">Free</div>
                <div className="text-xs text-gray-500 font-medium">$0</div>
              </div>
              <div className="p-4 sm:p-5 text-center">
                <div className="text-sm font-extrabold text-blue-600">Plus</div>
                <div className="text-xs text-gray-500 font-medium">$6.99/mo</div>
              </div>
              <div className="p-4 sm:p-5 text-center border-l-2 border-blue-200 bg-blue-50/50">
                <div className="text-sm font-extrabold text-blue-700">Pro</div>
                <div className="text-xs text-blue-600 font-bold">$12.99/mo</div>
              </div>
            </div>

            {/* Rows */}
            {pricingFeatures.map((f, i) => (
              <div
                key={f.name}
                className={`grid grid-cols-4 border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
              >
                <div className="p-3 sm:p-4 flex items-center">
                  <span className="text-sm font-medium text-gray-800">{f.name}</span>
                </div>
                <div className="p-3 sm:p-4 flex items-center justify-center">
                  {f.free ? (
                    <Check className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <X className="w-4 h-4 text-gray-300" />
                  )}
                </div>
                <div className="p-3 sm:p-4 flex items-center justify-center">
                  {f.plus ? (
                    <Check className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <X className="w-4 h-4 text-gray-300" />
                  )}
                </div>
                <div className="p-3 sm:p-4 flex items-center justify-center border-l-2 border-blue-100">
                  {f.pro ? (
                    <Check className="w-5 h-5 text-blue-600" />
                  ) : (
                    <X className="w-4 h-4 text-gray-300" />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Start Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              Full Plan Details
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  TESTIMONIALS                                                */}
      {/* ============================================================ */}
      <Testimonials />

      {/* ============================================================ */}
      {/*  AI GRADING CROSS-SELL                                       */}
      {/* ============================================================ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-8 sm:p-12 shadow-xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-bold text-indigo-800 mb-4">
                  <Sparkles className="w-4 h-4" /> Also from Curriculate
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">
                  AI Grading Tool — Free for All Teachers
                </h2>
                <p className="text-gray-700 font-medium mb-6 leading-relaxed">
                  Snap a photo of student work — handwritten or typed. Choose from 11 feedback voices
                  and your own rubric. Get detailed, personalized feedback in seconds. No sign-up required.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/ai-grading"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 text-white font-black shadow-xl hover:bg-indigo-700"
                  >
                    Try AI Grading Free <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/ai-grading"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 font-black shadow-md border border-gray-200 hover:bg-gray-50"
                  >
                    Learn More
                  </Link>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center lg:justify-end">
                {[
                  "Encouraging Coach",
                  "Warm Mentor",
                  "Constructive Critic",
                  "Socratic Guide",
                  "Rigorous Academic",
                  "Growth Mindset",
                  "Standards-Based",
                  "Conversational",
                  "Direct & Clear",
                  "Narrative Feedback",
                  "Peer Reviewer",
                ].map((v, i) => {
                  const colors = [
                    "bg-blue-50 text-blue-700 border-blue-200",
                    "bg-purple-50 text-purple-700 border-purple-200",
                    "bg-emerald-50 text-emerald-700 border-emerald-200",
                    "bg-yellow-50 text-yellow-700 border-yellow-200",
                    "bg-indigo-50 text-indigo-700 border-indigo-200",
                    "bg-rose-50 text-rose-700 border-rose-200",
                    "bg-teal-50 text-teal-700 border-teal-200",
                    "bg-orange-50 text-orange-700 border-orange-200",
                    "bg-pink-50 text-pink-700 border-pink-200",
                    "bg-cyan-50 text-cyan-700 border-cyan-200",
                    "bg-violet-50 text-violet-700 border-violet-200",
                  ];
                  return (
                    <span
                      key={v}
                      className={`inline-block rounded-full border px-3 py-1.5 text-xs font-bold ${colors[i % colors.length]}`}
                    >
                      {v}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CTA                                                         */}
      {/* ============================================================ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-2xl p-12 text-white">
            <h2 className="text-3xl sm:text-4xl font-black mb-3">
              Stop prepping stations by hand.
            </h2>
            <p className="text-lg font-medium text-white/90 max-w-3xl">
              Curriculate plans, generates, and runs the whole thing — then sends you the reports.
              Free to start. Works today.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl hover:bg-gray-100"
              >
                Get Started Free <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/reports"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-white text-lg font-black hover:bg-white/15"
              >
                View Sample Reports
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
