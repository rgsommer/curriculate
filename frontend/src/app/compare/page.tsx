// frontend/src/app/compare/page.tsx
import Link from "next/link";
import { ArrowRight, Download, Trophy, Layers, Users, Footprints, Sparkles } from "lucide-react";

const cards = [
  {
    title: "Curriculate vs Kahoot",
    href: "/compare/kahoot",
    pdf: "/compare/curriculate-vs-kahoot.pdf",
    accent: "from-blue-600 to-indigo-600",
    points: [
      "Stations + movement (physical + digital hybrid)",
      "Turn-based flow that prevents chaos",
      "40+ task types beyond multiple choice",
      "Evidence-based submissions + richer reports",
    ],
  },
  {
    title: "Curriculate vs Quizlet",
    href: "/compare/quizlet",
    pdf: "/compare/curriculate-vs-quizlet.pdf",
    accent: "from-purple-600 to-fuchsia-600",
    points: [
      "Active station learning vs individual study sets",
      "Collaboration + oral tasks built-in",
      "AI-generated tasks (optional) with zero prep",
      "Best for deep thinking, not only recall drills",
    ],
  },
  {
    title: "Admin One-Pager",
    href: "/compare/one-pager",
    pdf: "",
    accent: "from-emerald-600 to-teal-600",
    points: [
      "Single scroll decision doc for leaders",
      "Two comparisons in one place",
      "Decision shortcut at the bottom",
      "Great for department heads and principals",
    ],
  },
  {
    title: "Curriculate vs Worksheets",
    href: "/compare/worksheets",
    pdf: "",
    accent: "from-orange-600 to-rose-600",
    points: [
      "Keep the rigor, upgrade the experience",
      "Live visibility and instant feedback",
      "Evidence artifacts, not just answers",
      "Less prep and grading pile",
    ],
  },
];

const quick = [
  { icon: <Footprints className="w-6 h-6 text-blue-600" />, title: "Movement", desc: "Purposeful station rotation, not seated tapping." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "Collaboration", desc: "Teams submit together; peer teaching happens naturally." },
  { icon: <Layers className="w-6 h-6 text-emerald-600" />, title: "Variety", desc: "Games, debate, photo evidence, drawing, role-play, more." },
  { icon: <Sparkles className="w-6 h-6 text-yellow-600" />, title: "Optional AI", desc: "Teacher-controlled generation + feedback when desired." },
  { icon: <Trophy className="w-6 h-6 text-indigo-600" />, title: "Classroom Fit", desc: "Built for real classrooms, not just a big-screen quiz show." },
];

export default function ComparePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Compare</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          See how Curriculate differs from popular classroom tools — and when each shines.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {cards.map((c) => (
            <div key={c.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden">
              <div className={`p-8 bg-gradient-to-r ${c.accent} text-white`}>
                <h2 className="text-3xl font-black">{c.title}</h2>
                <p className="mt-2 text-white/90 font-medium">
                  A clear side-by-side comparison for teachers and administrators.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <Link
                    href={c.href}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-gray-900 text-base font-black shadow-xl hover:bg-gray-100"
                  >
                    View <ArrowRight className="w-5 h-5" />
                  </Link>
                  {c.pdf ? (
                    <a
                      href={c.pdf}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-white text-base font-black hover:bg-white/15"
                    >
                      <Download className="w-5 h-5" /> Open PDF
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="p-8">
                <ul className="space-y-2 text-gray-800 font-medium">
                  {c.points.map((p) => (
                    <li key={p} className="flex items-start gap-3">
                      <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>

                {c.pdf ? (
                  <div className="mt-6">
                    <a
                      href={c.pdf}
                      download
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-gray-900 text-base font-black shadow-xl border border-gray-200 hover:bg-gray-50"
                    >
                      <Download className="w-5 h-5" /> Download PDF
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">What makes Curriculate different</h3>
          <p className="text-gray-700 font-medium mb-8 max-w-3xl">
            Curriculate is built for station-based, movement-based instruction with live teacher control and real evidence of learning —
            not just rapid-fire answers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {quick.map((q) => (
              <div key={q.title} className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-4">
                  {q.icon}
                </div>
                <div className="font-black text-gray-900 mb-2">{q.title}</div>
                <div className="text-gray-700 font-medium">{q.desc}</div>
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
