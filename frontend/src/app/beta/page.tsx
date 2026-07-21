"use client";

import React from "react";
import Link from "next/link";
import {
  Sparkles,
  Camera,
  Trophy,
  Clock,
  CheckCircle,
  ArrowRight,
  Users,
  Heart,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  /beta — single-CTA landing page for the Curriculate beta cohort.  */
/*  Lead with Pulse (faster aha) and use the live GameMaster session  */
/*  as the visual hero. One form. No upsells.                          */
/* ------------------------------------------------------------------ */

const GRADE_BANDS = [
  "K–2 (Primary)",
  "3–5 (Elementary)",
  "6–8 (Middle)",
  "9–12 (High School)",
  "Post-secondary",
  "Multi-grade / other",
];

const SUBJECTS = [
  "English / Language Arts",
  "Math",
  "Science",
  "Social Studies / History",
  "World Languages",
  "Music / Arts",
  "Religious Studies",
  "Phys Ed",
  "Computer Science / STEM",
  "Other",
];

const PERKS = [
  {
    icon: <Sparkles className="w-5 h-5 text-amber-500" />,
    title: "Free during beta",
    body: "Unlimited grading + sessions while we're polishing. No card, no trial timer.",
  },
  {
    icon: <Heart className="w-5 h-5 text-rose-500" />,
    title: "Direct line to me",
    body: "I'm Richard, I'm building this. Reply to any email — I read every word.",
  },
  {
    icon: <Trophy className="w-5 h-5 text-indigo-500" />,
    title: "Shape what ships",
    body: "Beta testers vote on next features. Top requesters get permanent free seats.",
  },
];

const FAQ = [
  {
    q: "Do I need to install anything?",
    a: "No. It runs in any browser on any device — Chromebook, iPad, laptop. Students join via QR code; you control everything from your screen.",
  },
  {
    q: "Will my data leave Canada / my country?",
    a: "Student work is processed by the AI provider and stored in our database; we don't sell or share it. Names can be replaced with IDs if your district requires it. Email me and I'll walk you through specifics.",
  },
  {
    q: "What if my class isn't 1:1 devices?",
    a: "Curriculate works with one device per team (3–5 students). Pulse Grading only needs your phone or laptop.",
  },
  {
    q: "How long does onboarding take?",
    a: "First Pulse grade: under 2 minutes from sign-up. First live session: 8 minutes with a Quick Start preset.",
  },
];

export default function BetaPage() {
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    school: "",
    gradeBand: "",
    subject: "",
    intent: "",
    company: "", // honeypot
  });
  const [status, setStatus] = React.useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [error, setError] = React.useState("");

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.email || !form.gradeBand || !form.subject) {
      setStatus("error");
      setError("Please complete name, email, grade band, and subject.");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/beta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to send");
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("Something went wrong. Try again or email rgsommer@me.com.");
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* HERO + FORM side by side on desktop, stacked on mobile */}
      <section className="px-6 pt-16 pb-12">
        <div className="mx-auto max-w-6xl grid lg:grid-cols-2 gap-12 items-start">
          {/* LEFT — copy */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold tracking-wide uppercase mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              Beta — first 200 teachers
            </div>
            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 leading-tight mb-5">
              Kahoot meets <span className="text-indigo-600">Amazing Race</span>{" "}
              <span className="text-gray-500">+ a grading robot that gets your rubric.</span>
            </h1>
            <p className="text-xl text-gray-700 font-medium mb-7 leading-relaxed">
              Curriculate is two tools for the same teacher.{" "}
              <strong>Pulse</strong> grades a class set of papers in the time it
              takes to drink a coffee.{" "}
              <strong>Live Sessions</strong> turn any lesson into a team-based
              broadcast your students will brag about at recess.
            </p>

            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              {PERKS.map((p) => (
                <div
                  key={p.title}
                  className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm"
                >
                  <div className="mb-2">{p.icon}</div>
                  <div className="font-bold text-gray-900 text-sm mb-1">
                    {p.title}
                  </div>
                  <div className="text-xs text-gray-600 leading-snug">
                    {p.body}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 text-sm text-gray-600">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>No credit card. No installer. Browser only.</span>
            </div>
          </div>

          {/* RIGHT — form card */}
          <div className="lg:sticky lg:top-8">
            <form
              onSubmit={onSubmit}
              className="bg-white rounded-3xl shadow-xl border border-gray-200 p-7 sm:p-8"
            >
              {status === "sent" ? (
                <div className="text-center py-10">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-7 h-7 text-emerald-600" />
                  </div>
                  <h2 className="text-2xl font-black text-gray-900 mb-2">
                    You're in.
                  </h2>
                  <p className="text-gray-700 mb-6">
                    Check your inbox in the next minute for setup instructions
                    and a calendar link if you want a 10-minute walkthrough.
                  </p>
                  <Link
                    href="/grading"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
                  >
                    Open Pulse Grading now
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-black text-gray-900 mb-1">
                    Claim a beta seat
                  </h2>
                  <p className="text-sm text-gray-600 mb-6">
                    Takes 30 seconds. You'll get access immediately.
                  </p>

                  <div className="space-y-4">
                    <Field
                      label="Your name"
                      value={form.name}
                      onChange={(v) => set("name", v)}
                      placeholder="Jamie Patel"
                      required
                    />
                    <Field
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={(v) => set("email", v)}
                      placeholder="jamie@school.org"
                      required
                    />
                    <Field
                      label="School (optional)"
                      value={form.school}
                      onChange={(v) => set("school", v)}
                      placeholder="Mountainview Elementary"
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <Select
                        label="Grade band"
                        value={form.gradeBand}
                        onChange={(v) => set("gradeBand", v)}
                        options={GRADE_BANDS}
                        required
                      />
                      <Select
                        label="Main subject"
                        value={form.subject}
                        onChange={(v) => set("subject", v)}
                        options={SUBJECTS}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1.5">
                        What's the first thing you'd try?
                      </label>
                      <textarea
                        value={form.intent}
                        onChange={(e) => set("intent", e.target.value)}
                        placeholder="e.g. Grading 28 Grade 4 journal entries on Monday, or running a Friday review session for Civil War."
                        rows={3}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Helps us pick the right starting taskset for you.
                      </p>
                    </div>

                    {/* honeypot */}
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => set("company", e.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                      className="hidden"
                      aria-hidden="true"
                    />

                    {status === "error" && error && (
                      <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-indigo-600 text-white font-bold text-base hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
                    >
                      {status === "sending" ? (
                        "Sending…"
                      ) : (
                        <>
                          Get my beta access
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    <p className="text-xs text-gray-500 text-center">
                      We'll only email you about beta updates. No spam, no
                      sharing.
                    </p>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      </section>

      {/* TWO PRODUCTS, ONE FUNNEL */}
      <section className="px-6 py-16 bg-white border-y border-gray-200">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-black text-gray-900 text-center mb-3">
            One sign-up. Both tools.
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Most teachers start with Pulse and discover Live Sessions a week
            later. A few do it the other way around.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <ProductCard
              tag="Grading"
              icon={<Camera className="w-7 h-7 text-blue-600" />}
              title="Pulse Grading"
              tagline="Snap a paper. Get a score, a rubric breakdown, and feedback in seconds."
              points={[
                "Photo, paste, batch PDF, video, or audio",
                "Your rubric, your strictness, your feedback voice",
                "Auto-CSV for Edsby and other gradebooks",
                "Student progress portal for parents",
              ]}
              tone="blue"
            />
            <ProductCard
              tag="Live Session"
              icon={<Zap className="w-7 h-7 text-purple-600" />}
              title="Curriculate Sessions"
              tagline="An 8-task lesson on a projector, teams scanning QR codes, a leaderboard that pops."
              points={[
                "23 task types: debates, puzzles, mind maps, drama",
                "5 themes — Ancient Egypt, Mission Control, Dragon Realm, more",
                "Game-Master broadcast mode for the projector",
                "Quick Start presets — go from sign-up to live in 8 min",
              ]}
              tone="purple"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-black text-gray-900 text-center mb-10">
            Honest answers
          </h2>
          <div className="space-y-4">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="group bg-white rounded-2xl border border-gray-200 p-5 open:shadow-md transition"
              >
                <summary className="cursor-pointer font-bold text-gray-900 list-none flex items-center justify-between">
                  <span>{f.q}</span>
                  <span className="text-gray-400 group-open:rotate-45 transition-transform">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-gray-700 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-600 mb-3">Still on the fence?</p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-indigo-600 font-bold hover:text-indigo-700"
            >
              Ask me anything <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER SOCIAL PROOF — light, single line. Replace with real numbers
          when you have them. */}
      <section className="px-6 py-10 border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-gray-600">
          <span className="inline-flex items-center gap-2">
            <Users className="w-4 h-4" /> Built by a classroom teacher
          </span>
          <span className="inline-flex items-center gap-2">
            <Clock className="w-4 h-4" /> Averages 9s per paper graded
          </span>
          <span className="inline-flex items-center gap-2">
            <Trophy className="w-4 h-4" /> 23 live-session task types
          </span>
        </div>
      </section>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-bold text-gray-900 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-bold text-gray-900 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProductCard({
  tag,
  icon,
  title,
  tagline,
  points,
  tone,
}: {
  tag: string;
  icon: React.ReactNode;
  title: string;
  tagline: string;
  points: string[];
  tone: "blue" | "purple";
}) {
  const ring =
    tone === "blue"
      ? "border-blue-200 shadow-blue-100"
      : "border-purple-200 shadow-purple-100";
  const chip =
    tone === "blue"
      ? "bg-blue-100 text-blue-700"
      : "bg-purple-100 text-purple-700";
  return (
    <div className={`rounded-3xl bg-white border ${ring} shadow-lg p-7`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
          {icon}
        </div>
        <span
          className={`text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full ${chip}`}
        >
          {tag}
        </span>
      </div>
      <h3 className="text-2xl font-black text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-700 mb-5">{tagline}</p>
      <ul className="space-y-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm text-gray-700">
            <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
