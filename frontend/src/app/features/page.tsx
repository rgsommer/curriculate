// frontend/src/app/features/page.tsx
import Link from "next/link";
import { ArrowRight, Footprints, Users, LayoutGrid, BarChart3, Sparkles, Camera, Mic } from "lucide-react";

const blocks = [
  {
    icon: <Footprints className="w-6 h-6 text-blue-600" />,
    title: "Station-Based Learning (Physical + Digital)",
    bullets: [
      "QR or color-based stations",
      "Different tasks per station (reduces copying)",
      "Works in a classroom, hallway, or multi-room setup",
      "Clear prompts + time limits keep movement purposeful",
    ],
  },
  {
    icon: <LayoutGrid className="w-6 h-6 text-purple-600" />,
    title: "40+ Task Types (Beyond Worksheets)",
    bullets: [
      "Games: BrainBlitz, Hangman Duel, Word Weaver",
      "Movement: Motion Mission, Physical Multiple Choice",
      "Thinking: VennSort, Mind Maps, BrainSpark Notes",
      "Oral tasks: Debate, narration, script play",
    ],
  },
  {
    icon: <Users className="w-6 h-6 text-emerald-600" />,
    title: "Team-Based by Design",
    bullets: [
      "Teams submit one shared response",
      "Natural roles emerge (reader, scanner, recorder)",
      "Less device isolation, more peer teaching",
      "Healthy competition is optional",
    ],
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-indigo-600" />,
    title: "Live Teacher Control + Visibility",
    bullets: [
      "See which teams are active or idle",
      "View submissions instantly (including evidence)",
      "Leaderboards update live (optional)",
      "Pacing is teacher-controlled",
    ],
  },
  {
    icon: <Sparkles className="w-6 h-6 text-yellow-600" />,
    title: "Optional AI (Teacher-Controlled)",
    bullets: [
      "Generate complete task sets instantly",
      "Assist with feedback on open responses",
      "Rubric-style scoring when you want it",
      "Teacher always has final authority",
    ],
  },
  {
    icon: (
      <div className="flex gap-2">
        <Camera className="w-6 h-6 text-pink-600" />
        <Mic className="w-6 h-6 text-pink-600" />
      </div>
    ),
    title: "Evidence-Based Learning",
    bullets: [
      "Photos, drawings, audio, and written explanations",
      "Artifacts visible in the session and in reports",
      "Great for conferencing and parent communication",
      "Makes learning defensible, not just score-based",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Features</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Everything you need to run active, collaborative, data-rich lessons — without adding prep.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {blocks.map((b) => (
            <div key={b.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  {b.icon}
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900">{b.title}</h2>
              </div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {b.bullets.map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4">
          <Link
            href="/pedagogy"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
          >
            Pedagogical Benefits <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/reports"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
          >
            See Sample Reports
          </Link>
        </div>
      </div>
    </main>
  );
}
