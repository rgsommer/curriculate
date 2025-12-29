// frontend/src/app/compare/one-pager/page.tsx
import Link from "next/link";
import { ArrowRight, Download, Footprints, Users, Layers, BarChart3, ShieldCheck } from "lucide-react";

const top = [
  { icon: <Footprints className="w-6 h-6 text-blue-600" />, title: "Structured movement", desc: "Stations create purposeful rotation without chaos." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "Real collaboration", desc: "Teams submit together; peer teaching happens naturally." },
  { icon: <Layers className="w-6 h-6 text-emerald-600" />, title: "Task variety", desc: "Games, debate, photo evidence, drawing, role-play, more." },
  { icon: <BarChart3 className="w-6 h-6 text-indigo-600" />, title: "Live visibility", desc: "Teachers see progress and submissions in real time." },
  { icon: <ShieldCheck className="w-6 h-6 text-yellow-600" />, title: "Teacher-controlled AI", desc: "Optional generation + feedback, always overrideable." },
];

const kahootRows = [
  { label: "Primary format", c: "Station-based, physical + digital hybrid learning", r: "Whole-class quiz-show (everyone answers at once)" },
  { label: "Group structure", c: "1–4 players per station (teams collaborate)", r: "Unlimited players; mostly individual competition" },
  { label: "Task variety", c: "40+ task types (movement, photo, debate, creation)", r: "Mostly quiz formats (MC, T/F, short answer)" },
  { label: "Noise & pacing", c: "Turn-based controls reduce chaos; teacher pacing", r: "Simultaneous answers can get loud/chaotic" },
  { label: "Depth of thinking", c: "Strong: explanation, synthesis, evidence tasks", r: "Best for fast recall review + excitement" },
  { label: "Reporting", c: "Student + teacher reports with artifacts", r: "Results/leaderboards; fewer artifacts" },
];

const quizletRows = [
  { label: "Core purpose", c: "Active stations + collaboration + evidence", r: "Flashcard study and recall review (self-paced)" },
  { label: "Task variety", c: "40+ task types beyond recall", r: "Flashcards + a few recall-focused modes" },
  { label: "Group play", c: "Team submissions at stations", r: "Mostly individual; Live mode is class competition" },
  { label: "Physical integration", c: "Built-in station rotation + movement tasks", r: "Screen-only by design" },
  { label: "Depth of thinking", c: "Strong: explanation, speaking, creation", r: "Best for memorization and rapid review" },
  { label: "Reporting", c: "Teacher + student reports with artifacts", r: "Strong study analytics; fewer artifacts" },
];

function Table({ title, rightLabel, rows }: { title: string; rightLabel: string; rows: Array<{ label: string; c: string; r: string }> }) {
  return (
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
      <h2 className="text-3xl font-black text-gray-900 mb-4">{title}</h2>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border-collapse">
          <thead>
            <tr className="text-left">
              <th className="py-3 px-4 text-sm font-black text-gray-700">Aspect</th>
              <th className="py-3 px-4 text-sm font-black text-gray-700">Curriculate</th>
              <th className="py-3 px-4 text-sm font-black text-gray-700">{rightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                <td className="py-4 px-4 text-gray-800 font-medium">{r.c}</td>
                <td className="py-4 px-4 text-gray-800 font-medium">{r.r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CompareOnePager() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Compare (One-Pager)</h1>
            <p className="text-xl text-gray-700 font-medium max-w-3xl">
              A single scroll for administrators: what Curriculate is, what it’s best for, and how it differs from popular tools.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/compare/curriculate-vs-kahoot.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-white text-base font-black shadow-xl hover:bg-blue-700"
            >
              <Download className="w-5 h-5" /> Kahoot PDF
            </a>
            <a
              href="/compare/curriculate-vs-quizlet.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-5 py-3 text-white text-base font-black shadow-xl hover:bg-purple-700"
            >
              <Download className="w-5 h-5" /> Quizlet PDF
            </a>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10 mb-8">
          <h2 className="text-3xl font-black text-gray-900 mb-3">What makes Curriculate different</h2>
          <p className="text-gray-700 font-medium mb-8 max-w-3xl">
            Curriculate is built for station-based, movement-based instruction with live teacher control and real evidence of learning —
            not just rapid-fire answers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {top.map((t) => (
              <div key={t.title} className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-4">
                  {t.icon}
                </div>
                <div className="font-black text-gray-900 mb-2">{t.title}</div>
                <div className="text-gray-700 font-medium">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <Table title="Curriculate vs Kahoot" rightLabel="Kahoot" rows={kahootRows} />
          <Table title="Curriculate vs Quizlet" rightLabel="Quizlet" rows={quizletRows} />
        </div>

        <div className="mt-10 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Decision shortcut</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Use Curriculate</div>
              <div className="text-gray-700 font-medium">
                When you want structured stations, collaboration, evidence-based tasks, and real-time teacher control.
              </div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Use Kahoot</div>
              <div className="text-gray-700 font-medium">
                For fast whole-class excitement and rapid recall review with a quiz-show feel.
              </div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Use Quizlet</div>
              <div className="text-gray-700 font-medium">
                For flashcard study, homework, and individual recall practice outside class.
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Try Curriculate Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/reports"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              View Sample Reports
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
