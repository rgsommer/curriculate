import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Campfire — Run a group challenge with a cash prize 🏆",
  description:
    "Best fishing pic. Funniest pose. Lowest golf score. Everyone chips in (or pays to enter), the group votes, and the winner takes the gift card. Play from anywhere — no app, no account to join.",
  robots: { index: false }, // paid-traffic LP, kept out of search
};

// Cold-traffic TikTok landing page (prize-challenge angle). Distraction-free:
// SiteHeader hides on /play, so the hero + single CTA own the screen. The CTA
// deep-links into the prize-event creation flow (?start=raffle-challenge sticks
// through signup), so the ad's vibe carries straight into the app.
const CTA = "/campfirelive?start=raffle-challenge";

function CtaButton({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={CTA}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-4 text-lg font-black text-white shadow-xl shadow-orange-500/30 active:scale-95 transition"
    >
      {children}
    </Link>
  );
}

const EXAMPLES = [
  { icon: "🎣", title: "Best Catch of the Season", sub: "Post your best fishing pic. Group votes. Winner takes the pot." },
  { icon: "🔍", title: "City Scavenger Hunt", sub: "You at the landmark, you in a boat, you mid-jump — any order." },
  { icon: "⛳", title: "Score Tournament", sub: "Golf, runs, step counts — lowest or highest total wins the cash." },
  { icon: "📸", title: "Funniest Pose Challenge", sub: "Everyone strikes a pose. The group crowns the champ." },
];

const STEPS = [
  { n: "1", t: "Set the challenge + pot", d: "Pick a theme and a closing date. Fund it with optional chip-ins or a set entry fee." },
  { n: "2", t: "Everyone plays — from anywhere", d: "Friends, teammates, the whole class snap their own photos or post scores. No app, no account to join." },
  { n: "3", t: "Winner takes the gift card", d: "The group votes (or the best score wins), and Campfire emails the winner the full pot automatically." },
];

export default function PlayLandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-amber-50 text-slate-900">
      {/* Hero */}
      <section className="mx-auto max-w-xl px-5 pt-12 pb-10 text-center">
        <div className="text-5xl mb-3">🔥🏆</div>
        <h1 className="text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight">
          Turn your group chat into a{" "}
          <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
            cash prize challenge
          </span>
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Best fishing pic. Funniest pose. Lowest golf score. Everyone chips in, the
          group votes, and the <b>winner takes the gift card</b>. Play from anywhere.
        </p>
        <div className="mt-7">
          <CtaButton>Start a challenge — free →</CtaButton>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Free to start · no app · friends join with just their name
        </p>
      </section>

      {/* Example challenges */}
      <section className="mx-auto max-w-xl px-5 pb-10">
        <div className="grid grid-cols-2 gap-3">
          {EXAMPLES.map((e) => (
            <div
              key={e.title}
              className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm"
            >
              <div className="text-3xl">{e.icon}</div>
              <div className="mt-1.5 font-extrabold text-sm leading-snug">{e.title}</div>
              <div className="mt-1 text-xs text-slate-500 leading-relaxed">{e.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-xl px-5 pb-10">
        <h2 className="text-center text-2xl font-black mb-5">How it works</h2>
        <div className="space-y-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-base font-black text-white">
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

      {/* Trust + final CTA */}
      <section className="mx-auto max-w-xl px-5 pb-16 text-center">
        <div className="rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 px-6 py-10 text-white shadow-xl">
          <h2 className="text-2xl font-black leading-tight">
            Your next group challenge is one tap away
          </h2>
          <p className="mt-2 text-sm text-white/90">
            The winner gets the <b>full</b> pot — players cover the small card fee, so the
            prize stays whole.
          </p>
          <div className="mt-6">
            <Link
              href={CTA}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-black text-orange-600 shadow-lg active:scale-95 transition"
            >
              Start a challenge — free →
            </Link>
          </div>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Campfire is operated by 10323594 Canada Corp. Challenges, pots &amp; gifts are
          organized by participants. Gift cards issued on completion.
        </p>
      </section>
    </main>
  );
}
