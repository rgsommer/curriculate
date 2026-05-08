// frontend/src/app/ai-grading/page.tsx
"use client";
import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Sparkles,
  Clock,
  MessageSquare,
  BookOpen,
  Shield,
  Zap,
  CheckCircle,
  Star,
  FileText,
  Users,
  BarChart3,
  TrendingUp,
  ClipboardList,
  SlidersHorizontal,
  QrCode,
  Mail,
  MessageCircle,
  Bell,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: <Camera className="w-6 h-6 text-blue-600" />,
    title: "5 input modes",
    desc: "Snap a photo, paste text, batch-upload a whole class as PDF, record video performances, or upload audio. Whatever the assignment, there's a way in.",
  },
  {
    icon: <MessageSquare className="w-6 h-6 text-purple-600" />,
    title: "13 feedback voices",
    desc: "From encouraging coach to rigorous academic — pick the tone that fits your classroom culture. Journal Response, Tutor, and more.",
  },
  {
    icon: <BookOpen className="w-6 h-6 text-emerald-600" />,
    title: "Your rubric, every time",
    desc: "Paste or describe your rubric once, or upload a PDF. The AI remembers it across every paper in the session.",
  },
  {
    icon: <Users className="w-6 h-6 text-yellow-600" />,
    title: "Batch grade a whole class",
    desc: "Upload a scanned PDF of 30 papers. AI splits by student, reads names, grades each one, and gives you a class summary.",
  },
  {
    icon: <ClipboardList className="w-6 h-6 text-indigo-600" />,
    title: "Class roster — any school",
    desc: "Edsby schools: upload your gradebook CSV. Everyone else: type student names and auto-generate IDs. Either way, students are matched by name after grading.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-cyan-600" />,
    title: "Gradebook CSV export",
    desc: "After grading, export a ready-to-import CSV with student IDs, scores, dates, and feedback links. Works with Edsby and other gradebooks.",
  },
  {
    icon: <TrendingUp className="w-6 h-6 text-orange-600" />,
    title: "Student progress portal",
    desc: "Students and parents visit curriculate.net/progress, enter a student ID and email, and see all grades, averages, and progress over time. Teachers see all their students in one view.",
  },
  {
    icon: <Zap className="w-6 h-6 text-yellow-600" />,
    title: "Student feedback pages",
    desc: "Every graded paper gets a unique link. Students and parents can view detailed feedback anytime — no login needed.",
  },
  {
    icon: <FileText className="w-6 h-6 text-teal-600" />,
    title: "Print reports & strips",
    desc: "Generate half-page reports or compact strips to hand back. Print-ready PDFs with scores, comments, and feedback links.",
  },
  {
    icon: <SlidersHorizontal className="w-6 h-6 text-amber-600" />,
    title: "Per-student strictness",
    desc: "Adjust grading strictness per student with a simple slider. Tougher on your advanced kids, more encouraging for struggling learners — same rubric, calibrated expectations.",
  },
  {
    icon: <QrCode className="w-6 h-6 text-violet-600" />,
    title: "CurricQR-coded PDF reports",
    desc: "Generate print-ready PDF reports with CurricQR codes linking to full feedback. Each result has a 5-character code (like AB123) for quick lookup.",
  },
  {
    icon: <Bell className="w-6 h-6 text-pink-600" />,
    title: "Email notifications",
    desc: "Parents and students get notified when new grades arrive — instantly or as a weekly digest. Each email can be set to on-new, weekly, or never.",
  },
  {
    icon: <MessageCircle className="w-6 h-6 text-sky-600" />,
    title: "Grade review requests",
    desc: "Students and parents can request a review or leave feedback directly on any result. Teachers see the request and can regrade with context.",
  },
  {
    icon: <Shield className="w-6 h-6 text-rose-600" />,
    title: "No sign-up required",
    desc: "Start grading immediately. No account, no paywall, no credit card. Just open the tool and go.",
  },
];

const voices = [
  "Encouraging Coach",
  "Warm Mentor",
  "Constructive Critic",
  "Socratic Guide",
  "Rigorous Academic",
  "Peer Reviewer",
  "Growth Mindset",
  "Standards-Based",
  "Conversational",
  "Direct & Clear",
  "Narrative Feedback",
  "Journal Response",
  "Tutor",
];

const steps = [
  {
    n: "1",
    title: "Open the grading tool",
    desc: "No login needed. Just open the page and you're ready to grade.",
  },
  {
    n: "2",
    title: "Choose your input mode",
    desc: "Snap a photo, paste text, upload a batch PDF, record video, or upload audio — whatever fits the assignment.",
  },
  {
    n: "3",
    title: "Set your rubric & voice",
    desc: "Describe your expectations, paste a rubric, or upload one. Choose from 13 feedback voices.",
  },
  {
    n: "4",
    title: "Get instant feedback",
    desc: "AI reads the work, evaluates against your rubric, and generates detailed, personalized feedback with shareable student links.",
  },
];

const faqs = [
  {
    q: "Is it really free?",
    a: "Yes. Pulse is free for all teachers worldwide. No account required, no hidden limits during our launch period.",
  },
  {
    q: "Does it work with handwritten work?",
    a: "Absolutely. Snap a photo of handwritten student work and the AI reads it with high accuracy — even messy handwriting.",
  },
  {
    q: "Can I grade a whole class at once?",
    a: "Yes. Scan or photograph a stack of papers into a single PDF, upload it in Batch mode, and the AI splits by student, reads names, and grades each one. You get individual feedback plus a class summary.",
  },
  {
    q: "Can I use my own rubric?",
    a: "Yes. Paste, describe, or upload a PDF of your rubric. The AI uses it consistently across every paper in your grading session.",
  },
  {
    q: "Does it work for video and audio?",
    a: "Yes. Record or upload speeches, skits, music performances, and presentations. The AI evaluates delivery, content, and technique.",
  },
  {
    q: "Can I export grades to my gradebook?",
    a: "Yes. After grading, export a CSV formatted for Edsby or other gradebooks. Student IDs, scores, dates, and feedback links are all included.",
  },
  {
    q: "How do parents see the feedback?",
    a: "Every graded paper gets a unique link (like curriculate.net/results/AB123). Share it with students or parents — no login or account needed to view detailed feedback. For ongoing access, students and parents can visit curriculate.net/progress, enter the student ID and their email, and see all grades, averages, and progress over time in one dashboard.",
  },
  {
    q: "Do I need Edsby?",
    a: "No. Edsby schools can upload their gradebook CSV for automatic student matching and grade export. Non-Edsby schools can click 'Create Roster,' type student names, and auto-generate IDs. Either way, you get the same features: name matching, progress portal, and grade tracking.",
  },
  {
    q: "Can parents track their child's progress?",
    a: "Yes. At curriculate.net/progress, anyone with the student ID can enter their email and see all grades, averages, and a progress chart. Multiple people — the student, both parents, a tutor — can each add their own email. Everyone gets notified when new grades arrive.",
  },
  {
    q: "Can I adjust strictness per student?",
    a: "Yes. Each student gets a strictness slider — tougher grading for advanced students, more encouraging feedback for those who need it. Same rubric, calibrated expectations.",
  },
  {
    q: "Do parents get notified when grades are posted?",
    a: "Yes. Once an email is added to the progress portal, notifications are sent automatically when new grades arrive. Each email can be set to instant (on every new grade), weekly digest (Saturday summary), or turned off entirely.",
  },
  {
    q: "What are the CurricQR codes and 5-character codes?",
    a: "Every graded result gets a unique 5-character code (like AB123). PDF reports include CurricQR codes that link directly to the full feedback page. Students can also type the code at curriculate.net/results to view their feedback.",
  },
  {
    q: "Can students request a regrade?",
    a: "Yes. On any result page, students or parents can submit a review request or leave feedback. The teacher receives it and can regrade with the additional context.",
  },
  {
    q: "Is student data stored?",
    a: "Grading sessions are processed in real time and not permanently stored. Results linked to student accounts are kept as long as someone checks them within 30 days. We take student privacy seriously.",
  },
  {
    q: "What subjects does it work for?",
    a: "Any subject — ELA, science, math, history, world languages, music, drama, and more. If a student created it, the AI can grade it.",
  },
];

/* ------------------------------------------------------------------ */
/*  COMPONENTS                                                         */
/* ------------------------------------------------------------------ */

function VoiceChip({ name, idx }: { name: string; idx: number }) {
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
      className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${colors[idx % colors.length]}`}
    >
      {name}
    </span>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-lg font-extrabold text-gray-900">{q}</span>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-gray-500 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="pb-5 text-gray-700 font-medium">{a}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DEMO MOCK                                                          */
/* ------------------------------------------------------------------ */

function GradingDemo() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        {/* Browser chrome */}
        <div className="bg-gray-100 px-4 py-3 flex items-center gap-3 border-b">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="ml-4 flex-1 bg-white rounded-lg px-4 py-1 text-sm text-gray-600 truncate">
            curriculate.net/grading
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Mock uploaded image */}
          <div className="rounded-2xl bg-gray-50 border-2 border-dashed border-gray-300 p-6 text-center">
            <Camera className="w-10 h-10 text-gray-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-600">
              Student essay uploaded
            </p>
            <p className="text-xs text-gray-500 mt-1">essay_response.jpg</p>
          </div>

          {/* Mock rubric */}
          <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
            <div className="text-xs font-extrabold text-blue-800 mb-1">
              Rubric detected
            </div>
            <p className="text-sm text-blue-700 font-medium">
              5-point scale: Thesis, Evidence, Analysis, Organization, Conventions
            </p>
          </div>

          {/* Mock feedback */}
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-extrabold text-emerald-800">
                Pulse Feedback — Encouraging Coach
              </span>
            </div>
            <div className="space-y-2 text-sm text-gray-800 font-medium">
              <p>
                <span className="font-extrabold text-emerald-700">Score: 4/5</span>
              </p>
              <p>
                Strong thesis with clear argumentation. Your evidence selections are
                well-chosen — especially the primary source connection in paragraph 2...
              </p>
            </div>
          </div>

          {/* Grade badge */}
          <div className="flex items-center justify-between rounded-2xl bg-white border border-gray-200 p-4">
            <div>
              <div className="text-xs font-extrabold text-gray-500">GRADE</div>
              <div className="text-3xl font-black text-gray-900">B+</div>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <Star
                  key={i}
                  className="w-5 h-5 text-yellow-400 fill-yellow-400"
                />
              ))}
              <Star className="w-5 h-5 text-gray-300" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RECOMMEND SECTION                                                  */
/* ------------------------------------------------------------------ */

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "";

function RecommendSection() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [myEmail, setMyEmail] = React.useState("");
  const [teacherName, setTeacherName] = React.useState("");
  const [teacherEmail, setTeacherEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [creditMonths, setCreditMonths] = React.useState(0);
  const [error, setError] = React.useState("");

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommenderName: name,
          recommenderEmail: myEmail,
          teacherName,
          teacherEmail,
          message,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreditMonths(data.totalCreditMonths || 0);
        setSent(true);
      } else {
        setError(data.error || "Failed to send.");
      }
    } catch {
      setError("Failed to send. Try again.");
    }
    setSending(false);
  }

  if (sent) {
    return (
      <section id="recommend" className="px-6 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-10">
            <div className="text-4xl mb-3">✓</div>
            <h3 className="text-xl font-extrabold text-emerald-800">Recommendation sent!</h3>
            <p className="text-emerald-700 font-medium mt-2">
              We sent a personalized invitation to try Curriculate. Thanks for spreading the word!
            </p>
            {myEmail && creditMonths > 0 && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-amber-800 font-bold text-sm">
                  You&apos;ve earned {creditMonths} free month{creditMonths !== 1 ? "s" : ""} of Curriculate Pro!
                </p>
                <p className="text-amber-700 text-xs mt-1">
                  Credits are linked to {myEmail} and will apply when paid plans launch.
                </p>
              </div>
            )}
            <button
              onClick={() => { setSent(false); setTeacherName(""); setTeacherEmail(""); setMessage(""); }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2.5 text-white font-bold text-sm shadow transition"
            >
              Recommend Another Teacher
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="recommend" className="px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-3xl p-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mb-2">
            Know a teacher who needs this?
          </h2>
          <p className="text-gray-700 font-medium mb-2">
            Students, parents, colleagues, principals — anyone can recommend Curriculate to a teacher. We&apos;ll send them a friendly invitation to try it.
          </p>
          <p className="text-amber-700 font-bold text-sm mb-6">
            Teachers: earn 1 free month of Curriculate Pro for every recommendation you send.
          </p>

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-600 px-6 py-3 text-white text-lg font-black shadow-lg transition"
            >
              Recommend to a Teacher
            </button>
          ) : (
            <form onSubmit={handleSend} className="text-left space-y-3 max-w-md mx-auto">
              {error && (
                <div className="bg-red-50 text-red-700 rounded-xl px-4 py-2 text-sm font-medium">
                  {error}
                </div>
              )}
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">About you</div>
              <input
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                type="email"
                placeholder="Your email (optional — earns you a free month)"
                value={myEmail}
                onChange={(e) => setMyEmail(e.target.value)}
              />
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-2">Teacher to recommend</div>
              <input
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Teacher's name"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
              />
              <input
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                type="email"
                placeholder="Teacher's email address"
                value={teacherEmail}
                onChange={(e) => setTeacherEmail(e.target.value)}
                required
              />
              <textarea
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                placeholder="Add a personal note (optional)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={sending}
                  className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-3 text-white font-black text-sm shadow transition disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send Recommendation"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-gray-300 px-4 py-3 text-gray-600 font-bold text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function PulseLanding() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* -------- HERO -------- */}
      <section className="relative overflow-hidden px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left — copy */}
            <div>
              <div className="flex items-center gap-4 mb-6">
                <img
                  src="/images/pulse/pulse-logo.png"
                  alt="Curriculate Pulse"
                  className="h-16 sm:h-20 w-auto"
                />
                <img
                  src="/images/mascot/email-results/2.png"
                  alt=""
                  className="h-16 w-16 rounded-full object-cover shadow-sm sm:h-20 sm:w-20"
                />
              </div>

              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-extrabold text-emerald-800 mb-6">
                <Sparkles className="w-4 h-4" />
                Free for all teachers
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-gray-900 leading-[1.08] tracking-tight mb-6">
                Grade a stack of papers in{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">
                  minutes, not hours
                </span>
              </h1>

              <p className="text-lg sm:text-xl text-gray-700 font-medium max-w-xl mb-8 leading-relaxed">
                Pulse — AI-powered grading for written work, handwriting, video performances,
                and audio — with batch mode for whole-class sets. Follows your rubric,
                writes feedback in your voice, and exports grades to your gradebook.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/grading"
                  className="group inline-flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-lg font-black py-4 px-8 rounded-2xl shadow-2xl transform hover:scale-[1.02] transition-all"
                >
                  Start Grading — Free
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-900 text-lg font-black py-4 px-8 rounded-2xl shadow-xl border border-gray-200"
                >
                  See How it Works
                </a>
              </div>

              <div className="mt-8 flex flex-wrap gap-4 text-sm font-bold text-gray-500">
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  No account needed
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Works with handwriting
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Any subject, any grade
                </span>
              </div>
            </div>

            {/* Right — demo mock */}
            <div>
              <GradingDemo />
              <p className="text-center mt-6 text-gray-500 font-medium text-sm">
                Actual grading interface — try it yourself
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------- SOCIAL PROOF BAR -------- */}
      <section className="border-y bg-white/60 px-6 py-8">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-center gap-8 text-center">
          <div>
            <div className="text-3xl font-black text-gray-900">5</div>
            <div className="text-sm font-bold text-gray-500">Input modes</div>
          </div>
          <div className="h-10 w-px bg-gray-200 hidden sm:block" />
          <div>
            <div className="text-3xl font-black text-gray-900">13</div>
            <div className="text-sm font-bold text-gray-500">Feedback voices</div>
          </div>
          <div className="h-10 w-px bg-gray-200 hidden sm:block" />
          <div>
            <div className="text-3xl font-black text-gray-900">Free</div>
            <div className="text-sm font-bold text-gray-500">For every teacher</div>
          </div>
          <div className="h-10 w-px bg-gray-200 hidden sm:block" />
          <div>
            <div className="text-3xl font-black text-gray-900">30s</div>
            <div className="text-sm font-bold text-gray-500">Per paper avg.</div>
          </div>
          <div className="h-10 w-px bg-gray-200 hidden sm:block" />
          <div>
            <div className="text-3xl font-black text-gray-900">/progress</div>
            <div className="text-sm font-bold text-gray-500">Parent &amp; student portal</div>
          </div>
          <div className="h-10 w-px bg-gray-200 hidden sm:block" />
          <div>
            <div className="text-3xl font-black text-gray-900">14</div>
            <div className="text-sm font-bold text-gray-500">Features &amp; counting</div>
          </div>
        </div>
      </section>

      {/* -------- VIDEO DEMO -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">
            See it in action
          </h2>
          <p className="text-lg text-gray-700 font-medium max-w-2xl mx-auto mb-10">
            Watch a real grading session — from photo to feedback in seconds.
          </p>

          <div className="rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
            <video
              src="/videos/ai-grading-demo.mp4"
              controls
              playsInline
              preload="metadata"
              className="w-full h-auto"
              poster="/images/posters/ai-grading-demo.png"
            >
              Your browser does not support the video tag.
            </video>
          </div>

          <div className="mt-8">
            <Link
              href="/grading"
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Try it Yourself — Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
            </Link>
          </div>
        </div>
      </section>

      {/* -------- FEATURES GRID -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">
              Everything you need to grade smarter
            </h2>
            <p className="text-lg text-gray-700 font-medium max-w-2xl mx-auto">
              Built by a teacher who spent too many Sunday nights grading essays.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                    {f.icon}
                  </div>
                  <h3 className="text-xl font-extrabold text-gray-900">
                    {f.title}
                  </h3>
                </div>
                <p className="text-gray-700 font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------- 11 VOICES -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-sm font-extrabold text-purple-800 mb-4">
              <MessageSquare className="w-4 h-4" />
              Feedback Voices
            </div>

            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              13 voices. Your classroom culture.
            </h2>
            <p className="text-lg text-gray-700 font-medium max-w-3xl mb-8">
              Choose how the AI speaks to your students. From warm encouragement
              to rigorous academic critique — every teacher has a style, and now
              your AI grader matches it.
            </p>

            <div className="flex flex-wrap gap-2">
              {voices.map((v, i) => (
                <VoiceChip key={v} name={v} idx={i} />
              ))}
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-blue-50 border border-blue-200 p-5">
                <div className="text-sm font-extrabold text-blue-800 mb-2">
                  Encouraging Coach
                </div>
                <p className="text-sm text-blue-900 font-medium italic">
                  "Great start with your thesis! Your evidence in paragraph 2 is
                  particularly strong. Let's work on connecting your analysis
                  back to the main argument more consistently..."
                </p>
              </div>
              <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-5">
                <div className="text-sm font-extrabold text-indigo-800 mb-2">
                  Rigorous Academic
                </div>
                <p className="text-sm text-indigo-900 font-medium italic">
                  "The thesis presents a defensible claim, though it lacks
                  specificity. Evidence selection is appropriate; however, the
                  analytical framework requires strengthening in paragraphs 3-4..."
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* -------- HOW IT WORKS -------- */}
      <section id="how-it-works" className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              How it works
            </h2>
            <p className="text-lg text-gray-700 font-medium mb-10 max-w-3xl">
              From photo to feedback in four steps. No setup, no training, no
              learning curve.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {steps.map((s) => (
                <div
                  key={s.n}
                  className="rounded-2xl border border-gray-200 bg-gray-50 p-6"
                >
                  <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white font-black flex items-center justify-center mb-4">
                    {s.n}
                  </div>
                  <h3 className="text-lg font-extrabold text-gray-900 mb-2">
                    {s.title}
                  </h3>
                  <p className="text-gray-700 font-medium">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-10">
              <Link
                href="/grading"
                className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
              >
                Try it Now — Free <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* -------- USE CASES -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">
              Built for real classrooms
            </h2>
            <p className="text-lg text-gray-700 font-medium max-w-2xl mx-auto">
              Whether you teach kindergarten or AP, the AI adapts to your
              standards and your students.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <FileText className="w-6 h-6 text-blue-600" />,
                title: "Essays & written responses",
                desc: "Grade persuasive essays, short answers, lab reports, journals, and any extended writing assignment.",
              },
              {
                icon: <Camera className="w-6 h-6 text-purple-600" />,
                title: "Handwritten work",
                desc: "Snap a photo of worksheets, journal entries, or exit tickets. AI reads handwriting accurately.",
              },
              {
                icon: <Users className="w-6 h-6 text-emerald-600" />,
                title: "Batch grade a whole class",
                desc: "Scan 30 papers into one PDF. AI splits by student, reads names, grades each one, and summarizes class performance.",
              },
              {
                icon: <Star className="w-6 h-6 text-yellow-600" />,
                title: "Video & audio performances",
                desc: "Record or upload speeches, skits, music performances, and presentations. AI evaluates delivery, content, and technique.",
              },
              {
                icon: <BarChart3 className="w-6 h-6 text-indigo-600" />,
                title: "Gradebook integration",
                desc: "Export grades as a CSV ready to import into Edsby or other gradebooks. Scores, dates, and feedback links included.",
              },
              {
                icon: <Zap className="w-6 h-6 text-rose-600" />,
                title: "Parent-friendly feedback",
                desc: "Every paper gets a unique feedback link. Share it with parents or post one code per student — no login needed.",
              },
            ].map((c) => (
              <div
                key={c.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-3">
                  {c.icon}
                </div>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">
                  {c.title}
                </h3>
                <p className="text-gray-700 font-medium text-sm">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------- FAQ -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-black text-gray-900 text-center mb-10">
            Frequently asked questions
          </h2>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8">
            {faqs.map((f) => (
              <FAQItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </section>

      {/* -------- RECOMMEND -------- */}
      <RecommendSection />

      {/* -------- FINAL CTA -------- */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-2xl p-12 text-white">
            <h2 className="text-3xl sm:text-4xl font-black mb-3">
              Stop spending your evenings grading.
            </h2>
            <p className="text-lg font-medium text-white/90 max-w-3xl">
              Join thousands of teachers who are grading smarter with AI — personalized
              feedback, consistent rubric alignment, and hours of time saved every week.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link
                href="/grading"
                className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl hover:bg-gray-100"
              >
                Start Grading — Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-white text-lg font-black hover:bg-white/15"
              >
                See Full Platform
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
