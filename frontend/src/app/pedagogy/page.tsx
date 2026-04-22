// frontend/src/app/pedagogy/page.tsx
import Link from "next/link";
import { ArrowRight, Footprints, Users, BarChart3, ShieldCheck, Camera } from "lucide-react";

const sections = [
  {
    icon: <Footprints className="w-6 h-6 text-blue-600" />,
    title: "Movement With Structure",
    body:
      "Students move with clear prompts, time limits, and scavenger hunt accountability — increasing focus and reducing off-task behavior.",
    bullets: ["Improves attention", "Reduces restlessness", "Supports kinesthetic learners"],
  },
  {
    icon: <Users className="w-6 h-6 text-purple-600" />,
    title: "Collaboration That Matters",
    body:
      "Teams submit one shared response, which naturally drives peer teaching and shared responsibility — without 30 individual devices doing 30 isolated tasks.",
    bullets: ["Peer teaching", "Shared responsibility", "Communication + leadership practice"],
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-emerald-600" />,
    title: "Assessment During Learning",
    body:
      "Teachers see understanding in real time. Misconceptions become visible while students are still working — so you can intervene immediately.",
    bullets: ["Live misconception detection", "Immediate reteaching", "Less grading after class"],
  },
  {
    icon: <Camera className="w-6 h-6 text-pink-600" />,
    title: "Evidence You Can Defend",
    body:
      "Photos, drawings, and written explanations create artifacts of learning. Reports aren’t just scores — they’re proof of thinking.",
    bullets: ["Great for conferencing", "Clear for parents", "Strong for admin conversations"],
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-indigo-600" />,
    title: "AI That Respects Teachers",
    body:
      "AI is optional and teacher-controlled: generate task sets, assist with feedback, and provide rubric-style scoring — while keeping teacher judgment central.",
    bullets: ["Zero-prep generation (optional)", "Consistent feedback support", "Always overrideable"],
  },
];

export default function PedagogyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Pedagogy</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Designed around how students actually learn: active participation, retrieval, collaboration, and real evidence.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sections.map((s) => (
            <div key={s.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  {s.icon}
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900">{s.title}</h2>
              </div>
              <p className="text-gray-700 font-medium mb-4">{s.body}</p>
              <ul className="space-y-2 text-gray-800 font-medium">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
          >
            See Plans <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/reports"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
          >
            View Sample Reports
          </Link>
        </div>
      </div>
    </main>
  );
}
