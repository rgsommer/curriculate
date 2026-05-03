// frontend/src/app/compare/blooket/page.tsx
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

const rows = [
  { label: "Primary format", c: "Station-based, physical + digital hybrid learning with structured rotation", b: "Screen-based game modes (Tower Defense, Gold Quest, Café, etc.)" },
  { label: "Group structure", c: "1–4 players per station; teams collaborate on shared submissions", b: "Individual play; students compete against each other on their own device" },
  { label: "Task variety", c: "65+ task types: cloze, AI interviews, peer editing, movement, photo evidence, debate, drawing, role-play, trivia", b: "Primarily multiple-choice quiz formats wrapped in game themes" },
  { label: "Physical movement", c: "Built-in station rotation, movement breaks, scavenger hunts, multi-room activities", b: "Screen-only — students stay seated at their device" },
  { label: "Depth of thinking", c: "Strong: explanation, synthesis, evidence tasks, case studies, letter writing", b: "Best for fast recall and memorization through gamified repetition" },
  { label: "Teacher workload", c: "Optional AI generation = near-zero prep; time-aware pacing", b: "Create or import question sets; large community library" },
  { label: "Noise & pacing", c: "Turn-based controls reduce chaos; teacher pacing per station", b: "Individual pacing; game modes can get loud and competitive" },
  { label: "Reports & evidence", c: "Student + teacher reports with photo/audio/drawing artifacts", b: "Basic performance data; limited artifact-style evidence" },
  { label: "Collaboration", c: "Team submissions, peer teaching, inter-team challenges", b: "Primarily individual competition; limited collaboration" },
  { label: "Off-screen learning", c: "Many tasks prompt activity away from device (write on paper, observe, move, discuss)", b: "All interaction happens on-screen" },
];

export default function CompareBlooketPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Curriculate vs Blooket</h1>
            <p className="text-xl text-gray-700 font-medium max-w-3xl">
              Blooket makes quiz review addictive with creative game modes. Curriculate is built for structured station learning,
              collaboration, and evidence-rich tasks that go beyond the screen.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">Quick takeaway</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Curriculate when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want station rotation with physical movement and structure.",
                  "You want deeper tasks beyond recall — photos, debate, case studies, creation.",
                  "You want collaboration and shared team submissions.",
                  "You want off-screen learning prompted by the device, not on it.",
                  "You want automatic teacher + student reports with artifacts.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Blooket when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want gamified recall practice that students find addictive.",
                  "You want a quick review game with creative themes (Tower Defense, etc.).",
                  "You're running individual quiz competitions.",
                  "You want a large community library of ready-made question sets.",
                  "You want students self-pacing through flashcard-style content.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-emerald-500" />
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
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Blooket</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.c}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Screen-light philosophy callout */}
          <div className="mt-10 rounded-2xl bg-blue-50 border border-blue-200 p-6">
            <div className="font-black text-blue-900 mb-2 text-lg">Technology-driven, not screen-driven</div>
            <p className="text-blue-800 font-medium leading-relaxed">
              Curriculate is powered by technology, but the student experience is about movement and real-world tasks.
              The device prompts and captures — students write on paper, observe physical displays, move to stations,
              discuss with teammates, and create evidence of learning. The screen is a launchpad, not the destination.
            </p>
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
    </main>
  );
}
