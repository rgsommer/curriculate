import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Campfire — Run a group raffle (chip in, random winner) 🎟️",
  description:
    "A straight-up raffle for reunions, fundraisers and 50-50 draws. Everyone chips in — scan a QR or tap — and a random winner takes the pot. Draw it live at the event. No app, no account to join.",
  robots: { index: false },
};

const CTA = "/campfirelive?start=raffle-draw";

const EXAMPLES = [
  { icon: "👪", title: "Family reunion", sub: "Everyone pitches in over dinner; one lucky cousin wins the pot." },
  { icon: "💛", title: "50-50 for a cause", sub: "Half to the winner, half to the charity you name." },
  { icon: "🏟️", title: "Team fundraiser", sub: "Sell tickets at the game — scan the QR, chip in, win." },
  { icon: "🎉", title: "Office / club draw", sub: "Chip in for a prize; bigger pitch-ins, better odds." },
];

const STEPS = [
  { n: "1", t: "Set up the pot", d: "Pick the odds (more chips = better odds, or one each) and the winner's cut. Name a cause if it's a fundraiser." },
  { n: "2", t: "Everyone chips in — from anywhere", d: "Share a link or print a QR to set on the table. People chip in from their phone — no app, no account." },
  { n: "3", t: "Draw the winner", d: "Tap 'Draw the winner' live at the event (or let it draw automatically at the close). 100% random — the pot is sent as a gift card." },
];

function Cta({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={CTA}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-600 px-8 py-4 text-lg font-black text-white shadow-xl shadow-fuchsia-500/30 active:scale-95 transition"
    >
      {children}
    </Link>
  );
}

export default function RaffleLandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-purple-50 text-slate-900">
      <section className="mx-auto max-w-xl px-5 pt-12 pb-10 text-center">
        <div className="text-5xl mb-3">🎟️</div>
        <h1 className="text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight">
          Run a{" "}
          <span className="bg-gradient-to-r from-fuchsia-500 to-purple-600 bg-clip-text text-transparent">
            group raffle
          </span>{" "}
          in minutes
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Everyone chips in — tap or scan a QR — and a <b>random winner takes the pot</b>.
          Perfect for reunions, 50-50 draws and fundraisers. Draw it live at the event.
        </p>
        <div className="mt-7">
          <Cta>Start a raffle — free →</Cta>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Free to start · no app · friends join with just their name
        </p>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-10">
        <div className="grid grid-cols-2 gap-3">
          {EXAMPLES.map((e) => (
            <div key={e.title} className="rounded-2xl border border-fuchsia-100 bg-white p-4 shadow-sm">
              <div className="text-3xl">{e.icon}</div>
              <div className="mt-1.5 font-extrabold text-sm leading-snug">{e.title}</div>
              <div className="mt-1 text-xs text-slate-500 leading-relaxed">{e.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-10">
        <h2 className="text-center text-2xl font-black mb-5">How it works</h2>
        <div className="space-y-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-base font-black text-white">
                {s.n}
              </div>
              <div>
                <div className="font-extrabold">{s.t}</div>
                <div className="mt-0.5 text-sm text-slate-600 leading-relaxed">{s.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-16 text-center">
        <div className="rounded-3xl bg-gradient-to-br from-fuchsia-500 to-purple-600 px-6 py-10 text-white shadow-xl">
          <h2 className="text-2xl font-black leading-tight">Your raffle is one tap away</h2>
          <p className="mt-2 text-sm text-white/90">
            100% random draw. The winner gets the full pot — players cover the small card
            fee, so the prize stays whole.
          </p>
          <div className="mt-6">
            <Link
              href={CTA}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-black text-fuchsia-600 shadow-lg active:scale-95 transition"
            >
              Start a raffle — free →
            </Link>
          </div>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Campfire is operated by 10323594 Canada Corp. Raffles, pots &amp; gifts are
          organized by participants; a named cause is the host&apos;s responsibility.
        </p>
      </section>
    </main>
  );
}
