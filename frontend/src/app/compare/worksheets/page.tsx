// frontend/src/app/compare/worksheets/page.tsx
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Clock, Footprints, Users, BarChart3, Camera, Sparkles } from "lucide-react";

const pain = [
  { icon: <Clock className="w-6 h-6 text-blue-600" />, title: "Prep + printing overhead", desc: "Worksheets cost time: formatting, printing, copying, distributing, collecting." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "Isolation & quiet copying", desc: "Many students drift into passive completion — or copying — without meaningful interaction." },
  { icon: <BarChart3 className="w-6 h-6 text-emerald-600" />, title: "Delayed feedback", desc: "You don’t see misconceptions until after class (or after grading)." },
  { icon: <ClipboardCheck className="w-6 h-6 text-indigo-600" />, title: "Thin evidence", desc: "Correct answers don’t always show thinking, reasoning, or collaboration skills." },
];

const gains = [
  { icon: <Footprints className="w-6 h-6 text-blue-600" />, title: "Active stations with structure", desc: "Movement is purposeful: scan → task → submit → rotate. Timers and prompts keep it tight." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "Collaboration that reveals thinking", desc: "Teams discuss, negotiate, and explain — which surfaces misunderstandings immediately." },
  { icon: <Sparkles className="w-6 h-6 text-yellow-600" />, title: "Task variety that sustains attention", desc: "Games, debate, drawing, photo evidence, quick checks — not one repetitive mode." },
  { icon: <Camera className="w-6 h-6 text-pink-600" />, title: "Evidence you can defend", desc: "Photos, drawings, written reasoning, and recordings become artifacts in reports." },
  { icon: <BarChart3 className="w-6 h-6 text-emerald-600" />, title: "Feedback during learning", desc: "Teachers see submissions live and can correct misconceptions in the moment." },
];

const table = [
  { label: "Student experience", w: "Mostly seated, independent, repetitive", c: "Active stations, team roles, varied tasks" },
  { label: "Teacher visibility", w: "After-the-fact (collect + grade)", c: "Live progress + submissions in real time" },
  { label: "Engagement", w: "Often drops after 5–10 minutes", c: "Sustained by movement, games, variety, teamwork" },
  { label: "Evidence", w: "Answers on paper; reasoning sometimes unclear", c: "Artifacts: photos, drawings, audio, explanations" },
  { label: "Differentiation", w: "Manual adjustments required", c: "Multiple task types and response modes naturally differentiate" },
  { label: "Workload", w: "Printing + organizing + grading", c: "Optional AI generation + automatic capture + reports" },
];

export default function CompareWorksheetsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Curriculate vs Worksheets</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Worksheets aren’t “bad.” They’re just limited. Curriculate keeps the rigor, but upgrades the classroom experience:
          movement, collaboration, real-time feedback, and defensible evidence.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-6">Common worksheet problems</h2>
            <div className="space-y-4">
              {pain.map((p) => (
                <div key={p.title} className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 flex items-center justify-center">
                      {p.icon}
                    </div>
                    <div className="font-black text-gray-900">{p.title}</div>
                  </div>
                  <div className="text-gray-700 font-medium">{p.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-6">What Curriculate upgrades</h2>
            <div className="space-y-4">
              {gains.map((g) => (
                <div key={g.title} className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 flex items-center justify-center">
                      {g.icon}
                    </div>
                    <div className="font-black text-gray-900">{g.title}</div>
                  </div>
                  <div className="text-gray-700 font-medium">{g.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-4">Side-by-side</h2>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Aspect</th>
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Traditional Worksheets</th>
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Curriculate</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.w}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">{r.c}</td>
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
              href="/reports"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              View Sample Reports
            </Link>
          </div>
        </div>

        <div className="mt-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-2xl p-12 text-white">
          <h3 className="text-3xl font-black mb-3">Keep the rigor. Upgrade the experience.</h3>
          <p className="text-white/90 font-medium max-w-3xl">
            Curriculate keeps the accountability of “show your work” — and adds movement, collaboration,
            and real artifacts of learning you can actually use.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              href="/features"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl hover:bg-gray-100"
            >
              Explore Features <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/compare"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-white text-lg font-black hover:bg-white/15"
            >
              Back to Compare
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
