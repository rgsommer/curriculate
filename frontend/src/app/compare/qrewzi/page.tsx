// frontend/src/app/compare/qrewzi/page.tsx
//
// Comparison against Qrewzi — the new live-classroom-games entrant.
// Playful posture: Curriculate concedes the games space to Qrewzi, keeps
// the grading ground. Positions Qrewzi favorably (drives that side of
// the market) while quietly cross-selling Pulse Grading to teachers who
// need marking.
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";

type Mark = "✓" | "✕" | "◯";
type Row = { label: string; c: string; cMark: Mark; q: string; qMark: Mark };

const rows: Row[] = [
  { label: "Live classroom games", c: "Legacy module — we still run them, but it's not the focus.", cMark: "◯", q: "Purpose-built game engine. It's literally the whole product.", qMark: "✓" },
  { label: "Interactive task types for a live session", c: "~15 usable in a game context.", cMark: "◯", q: "30+ tuned for game mode — plus movement, speech, mind maps, script plays.", qMark: "✓" },
  { label: "GameMaster projector dashboard", c: "Not a thing here.", cMark: "✕", q: "Live leaderboard, station heat map, celebration confetti, kill-switch controls.", qMark: "✓" },
  { label: "Secret team superpowers", c: "We never even considered it.", cMark: "✕", q: "1-in-4 teams roll a hidden power on join. Kids trade rumors.", qMark: "✓" },
  { label: "QR-scanning stations", c: "Print-and-tape stations, same idea.", cMark: "✓", q: "Same, plus hidden-QR laptop mode when webcams handle it.", qMark: "✓" },
  { label: "Mixed-device sessions", c: "Works, but phone-first.", cMark: "◯", q: "Phones + Chromebooks + tablets all in one room, no config.", qMark: "✓" },
  { label: "Session themes", c: "One backdrop, take it or leave it.", cMark: "✕", q: "Multiple projector themes (neon, chalkboard, arcade) with more shipping.", qMark: "✓" },
  { label: "Kid-facing brand tone", c: "Teacher-serious. Kids find it… fine.", cMark: "✕", q: "'The classroom becomes the game.' Kids get excited.", qMark: "✓" },
  { label: "Class roster + per-student progress", c: "Yes — CSV upload, AI name-match, portal.", cMark: "✓", q: "Yes — same feature set.", qMark: "✓" },
  { label: "AI grading of open-ended student work", c: "Yes — photograph, paste, or batch a whole class PDF. Pulse Grading is our thing.", cMark: "✓", q: "They don't grade. That's not what Qrewzi does.", qMark: "✕" },
  { label: "Batch PDF grading (whole-class scan)", c: "One of our best features.", cMark: "✓", q: "Nope.", qMark: "✕" },
  { label: "Video + audio performance grading", c: "Yes — music, drama, speeches, all rubric-scored.", cMark: "✓", q: "Not their space.", qMark: "✕" },
];

function CellMark({ v }: { v: Mark }) {
  const color = v === "✓" ? "text-emerald-600" : v === "✕" ? "text-rose-500" : "text-amber-600";
  return <span className={`${color} font-black text-xl`} aria-hidden="true">{v}</span>;
}

export default function CompareQrewziPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        {/* ─── Hero ─── */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-amber-900 text-xs font-black tracking-wider uppercase mb-4">
            <Trophy className="w-3.5 h-3.5" /> Head-to-head
          </div>
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">
            OK, fine — <span className="text-rose-500">Qrewzi</span> has more features.
          </h1>
          <p className="text-xl text-gray-700 font-medium max-w-3xl">
            For live classroom games, they've lapped us. We rebuilt what we had
            and they still shipped more. Here are the receipts — and one honest
            reason to stay with Curriculate anyway.
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-6 sm:p-10">
          {/* ─── Quick takeaway ─── */}
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">Quick takeaway</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Choose Curriculate when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "Marking is eating your evenings — Pulse Grading is what we do best.",
                  "You need to batch-grade a whole class PDF at once.",
                  "You're grading video, audio, or performance work against a rubric.",
                  "You want one platform that handles both grading AND games (we still do both, just not as fun on the games side).",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6">
              <div className="font-black text-rose-900 mb-2">Choose Qrewzi when…</div>
              <ul className="space-y-2 text-gray-800 font-medium">
                {[
                  "You want kids on their feet — real team competition, real movement.",
                  "You want the GameMaster dashboard on the projector (leaderboard, streaks, confetti).",
                  "Your class runs a mix of phones, Chromebooks, and tablets.",
                  "You want the kid-facing brand — the one they actually get hyped about.",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-rose-500" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ─── Side-by-side ─── */}
          <h3 className="text-2xl font-extrabold text-gray-900 mt-4 mb-4">Side-by-side</h3>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="py-3 px-4 text-sm font-black text-gray-700 w-1/4">Feature</th>
                  <th className="py-3 px-4 text-sm font-black text-gray-700">Curriculate</th>
                  <th className="py-3 px-4 text-sm font-black text-rose-600">Qrewzi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t align-top">
                    <td className="py-4 px-4 font-extrabold text-gray-900">{r.label}</td>
                    <td className="py-4 px-4 text-gray-800 font-medium">
                      <span className="mr-2"><CellMark v={r.cMark} /></span>
                      {r.c}
                    </td>
                    <td className="py-4 px-4 text-gray-800 font-medium">
                      <span className="mr-2"><CellMark v={r.qMark} /></span>
                      {r.q}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ─── Playful concession callout ─── */}
          <div className="mt-10 rounded-2xl bg-amber-50 border border-amber-200 p-6">
            <div className="font-black text-amber-900 mb-2 text-lg">Sportsmanship note</div>
            <p className="text-amber-900 font-medium leading-relaxed">
              We'd sue them for stealing our best ideas, but they beat us to
              the punch on the ones we hadn't built yet. Superpowers, hidden-QR
              laptop mode, the GameMaster dashboard — those are theirs. If the
              live-games side is what you came for, go check them out. We'll be
              over here doing what we do best: making grading suck less.
            </p>
          </div>

          {/* ─── CTAs ─── */}
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <a
              href="https://qrewzi.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-rose-600"
            >
              Try Qrewzi <ArrowRight className="w-5 h-5" />
            </a>
            <Link
              href="/grading"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Or stay for Pulse Grading <ArrowRight className="w-5 h-5" />
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
