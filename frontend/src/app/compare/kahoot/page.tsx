// frontend/src/app/compare/kahoot/page.tsx
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

const rows = [
  { label: "Primary format", c: "Station-based, physical + digital hybrid learning", k: "Whole-class quiz-show style (everyone answers at once)" },
  { label: "Group structure", c: "1–4 players per station (teams collaborate)", k: "Unlimited players; mostly individual competition" },
  { label: "Task variety", c: "65+ task types: fill-in-the-blank, AI interviews, peer editing, teach-back, movement, photo, role-play, drawing, trivia, games", k: "Primarily quiz formats (MC, T/F, short answer)" },
  { label: "Teacher workload", c: "Optional AI generation = near zero prep", k: "Teacher creates/chooses quizzes; some AI help" },
  { label: "Noise & pacing", c: "Turn-based controls reduce chaos; teacher pacing", k: "Simultaneous answers can get loud/chaotic" },
  { label: "Depth of thinking", c: "Strong: synthesis, explanation, evidence tasks", k: "Best for fast recall review and excitement" },
  { label: "Reports & evidence", c: "Student + teacher reports with artifacts", k: "Results/leaderboards; less artifact-style evidence" },
];

export default function CompareKahootPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Curriculate vs Kahoot</h1>
            <p className="text-xl text-gray-700 font-medium max-w-3xl">
              Both can be fun. Curriculate is built for structured stations and deeper learning; Kahoot shines for fast whole-class review.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/compare/curriculate-vs-kahoot.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              <Download className="w-5 h-5" /> Open PDF
            </a>
            <a
              href="/compare/curriculate-vs-kahoot.pdf"
              download
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              <Download className="w-5 h-5" /> Download
            </a>
          </div>
        </div>
        <div className="mt-6 rounded-3xl overflow-hidden border border-gray-200 shadow-2xl bg-white">
          <img
            src="/images/compare/compare-kahoot-preview.png"
            alt="Curriculate vs Kahoot (one-page preview)"
            className="w-full h-auto block"
            loading="lazy"
          />
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">Quick takeaway</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Curriculate when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want station rotation with structured movement.",
                  "You want deeper response types (photos, debate, explanation).",
                  "You want live teacher visibility + automatic reporting.",
                  "You want collaboration, not only individual speed.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Kahoot when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want a quick whole-class energizer.",
                  "You want rapid recall review with a big-screen vibe.",
                  "You’re running a single quiz game format.",
                  "You want instant excitement for large groups.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-yellow-500" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <h3 className="text-2xl font-extrabold text-gray-900 mt-10 mb-4">Side-by-side</h3>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Aspect</th>
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Curriculate</th>
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Kahoot</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.c}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Try Curriculate Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/compare"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              Back to Compare
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
