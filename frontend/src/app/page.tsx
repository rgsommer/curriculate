// frontend/src/app/page.tsx
import Link from "next/link";
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
} from "lucide-react";

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
    desc: "Optional AI generation and feedback — always overrideable by the teacher.",
  },
];

const steps = [
  { n: "1", title: "Launch a task set", desc: "Start from the Teacher Dashboard in one click." },
  { n: "2", title: "Teams join fast", desc: "No accounts — just a room code + team name." },
  { n: "3", title: "Rotate stations", desc: "QR or color stations guide movement with clarity." },
  { n: "4", title: "Submit together", desc: "Text, photos, drawings, audio — evidence included." },
  { n: "5", title: "Reports generated", desc: "Teacher + student reports appear automatically." },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h1 className="text-5xl sm:text-7xl font-black text-gray-900 mb-6">
              Curriculate<span className="text-blue-600">.net</span>
            </h1>
            <p className="text-xl sm:text-2xl text-gray-700 mb-10 max-w-3xl mx-auto font-medium">
              Active, movement-based learning — without the chaos.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
              <Link
                href="/dashboard"
                className="group inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold py-5 px-10 rounded-2xl shadow-2xl transform hover:scale-[1.02] transition-all"
              >
                Get Started Free
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition" />
              </Link>
              <Link
                href="/reports"
                className="inline-flex items-center gap-3 bg-white hover:bg-gray-50 text-gray-900 text-xl font-bold py-5 px-8 rounded-2xl shadow-xl border border-gray-200"
              >
                View Sample Reports
              </Link>
              <Link
                href="/station-posters"
                className="inline-flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white text-xl font-bold py-5 px-8 rounded-2xl shadow-2xl"
              >
                <Printer className="w-6 h-6" />
                Station Posters
              </Link>
            </div>
          </div>

          {/* LIVE PREVIEW */}
          <div className="mx-auto max-w-5xl">
            <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-200">
              <div className="bg-gray-100 px-6 py-4 flex items-center gap-3 border-b">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                </div>
                <div className="ml-4 flex-1 bg-white rounded-lg px-4 py-1 text-sm text-gray-600">
                  curriculate.net/play/abcd1234
                </div>
              </div>

              <div className="p-10">
                <div className="flex items-center gap-3 mb-8">
                  <Sparkles className="w-10 h-10 text-yellow-500" />
                  <h2 className="text-4xl font-bold text-gray-900">Photosynthesis Review</h2>
                </div>

                <div className="space-y-8 max-w-3xl mx-auto">
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-8 border-2 border-green-200">
                    <p className="text-2xl font-semibold mb-6">
                      What is the primary source of energy for Earth's climate system?
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {["The Sun", "Geothermal heat", "Ocean currents", "Volcanic activity"].map((option, i) => (
                        <label
                          key={i}
                          className={`flex items-center gap-4 p-5 rounded-xl cursor-pointer transition-all ${
                            i === 0 ? "bg-green-500 text-white shadow-lg" : "bg-white hover:bg-gray-50"
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                              i === 0 ? "border-white bg-white" : "border-gray-300"
                            }`}
                          >
                            {i === 0 && <CheckCircle className="w-5 h-5 text-green-600" />}
                          </div>
                          <span className="text-lg font-medium">{option}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-lg font-medium text-gray-600">Question 1 of 12</span>
                    <div className="flex items-center gap-3">
                      <div className="bg-gray-200 rounded-full h-3 w-96 overflow-hidden">
                        <div className="bg-blue-600 h-full rounded-full" style={{ width: "42%" }} />
                      </div>
                      <span className="text-lg font-bold text-blue-600">42%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-center mt-8 text-gray-500 font-medium">
              ↑ This is what your students see — live, beautiful, and instant
            </p>
          </div>
        </div>
      </section>

      {/* Why */}
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

      {/* How it works */}
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

      {/* CTA */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-2xl p-12 text-white">
            <h2 className="text-4xl font-black mb-3">Active learning — done right.</h2>
            <p className="text-lg font-medium text-white/90 max-w-3xl">
              Run stations with clarity, capture real evidence, and leave class with reports already done.
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
                View Reports
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
