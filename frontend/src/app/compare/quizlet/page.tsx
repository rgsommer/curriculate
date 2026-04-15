// frontend/src/app/compare/quizlet/page.tsx
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

const rows = [
  { label: "Core purpose", c: "Active station learning + collaboration + evidence", q: "Flashcard study and recall review (self-paced)" },
  { label: "Task variety", c: "40+ AI-generated task types (movement, debate, creation)", q: "Flashcards + a few study/game modes around recall" },
  { label: "Group play", c: "1–4 players per station; team submissions", q: "Individual study or whole-class Live mode" },
  { label: "Physical integration", c: "Strong — stations + movement tasks", q: "Screen-only — no physical component" },
  { label: "Teacher workload", c: "Optional AI generation reduces prep", q: "Create/import sets; large library helps" },
  { label: "Depth of thinking", c: "Strong: explanation, synthesis, evidence, speaking", q: "Best for memorization and quick review" },
  { label: "Reports & artifacts", c: "Student + teacher reports with artifacts", q: "Strong study analytics; fewer artifacts" },
];

export default function CompareQuizletPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Curriculate vs Quizlet</h1>
            <p className="text-xl text-gray-700 font-medium max-w-3xl">
              Quizlet is excellent for individual recall practice. Curriculate is built for station-based instruction, collaboration, and evidence-rich learning.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/compare/curriculate-vs-quizlet.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-purple-700"
            >
              <Download className="w-5 h-5" /> Open PDF
            </a>
            <a
              href="/compare/curriculate-vs-quizlet.pdf"
              download
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              <Download className="w-5 h-5" /> Download
            </a>
          </div>
        </div>

        <div className="mt-6 rounded-3xl overflow-hidden border border-gray-200 shadow-2xl bg-white">
          <img
            src="/images/compare/compare-quizlet-preview.png"
            alt="Curriculate vs Quizlet (one-page preview)"
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
                  "You want active stations with movement and structure.",
                  "You want collaboration and shared submissions.",
                  "You want deeper tasks (photos, debate, explanation).",
                  "You want automatic teacher + student reports.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Quizlet when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want individual study, homework, or test prep.",
                  "You want strong flashcard mechanics and large set libraries.",
                  "You want simple, repeatable recall practice.",
                  "You want student self-paced review outside class.",
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
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Quizlet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.c}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/dashboard"
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
    </div>
  );
}
