import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Campfire — A group card everyone signs + a group gift 🎁",
  description:
    "Everyone secretly signs one card and chips in for a gift card — sent automatically on the day. Birthdays, teachers, coaches, farewells. No app, no account to sign.",
  robots: { index: false },
};

const CTA = "/campfirelive?start=celebration-card";

const EXAMPLES = [
  { icon: "🎂", title: "Birthdays", sub: "A surprise card that opens on the big day — and plays Happy Birthday." },
  { icon: "🍎", title: "Teacher / coach", sub: "The whole class or team signs + chips in for one gift card." },
  { icon: "👋", title: "Farewell / new baby", sub: "Everyone adds a wish; the gift is emailed automatically." },
  { icon: "🎄", title: "Holidays", sub: "One card for someone special, signed by the whole group." },
];

const STEPS = [
  { n: "1", t: "Start the card", d: "Pick the occasion and who it's for. It stays hidden from them — a real surprise." },
  { n: "2", t: "Everyone signs + chips in", d: "Each wish is private until the reveal. People can chip in toward one gift card — no app, just their name." },
  { n: "3", t: "It opens on the day", d: "The card unlocks and the gift card is emailed automatically. The recipient gets the full amount." },
];

function Cta({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={CTA}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-8 py-4 text-lg font-black text-white shadow-xl shadow-orange-500/30 active:scale-95 transition"
    >
      {children}
    </Link>
  );
}

export default function GroupCardsLandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-rose-50 text-slate-900">
      <section className="mx-auto max-w-xl px-5 pt-12 pb-10 text-center">
        <div className="text-5xl mb-3">🎁</div>
        <h1 className="text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight">
          One card{" "}
          <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
            everyone signs
          </span>{" "}
          — plus a gift
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          The group secretly signs one card and <b>chips in for a gift card</b>, sent
          automatically on the day. Birthdays, teachers, coaches, farewells.
        </p>
        <div className="mt-7">
          <Cta>Start a card — free →</Cta>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Free to start · no app · sign with just your name
        </p>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-10">
        <div className="grid grid-cols-2 gap-3">
          {EXAMPLES.map((e) => (
            <div key={e.title} className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm">
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-base font-black text-white">
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
        <div className="rounded-3xl bg-gradient-to-br from-orange-500 to-rose-500 px-6 py-10 text-white shadow-xl">
          <h2 className="text-2xl font-black leading-tight">Make someone&apos;s day</h2>
          <p className="mt-2 text-sm text-white/90">
            A surprise card the whole group signs, plus a gift card that arrives right on
            time — set it up in a minute.
          </p>
          <div className="mt-6">
            <Link
              href={CTA}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-black text-orange-600 shadow-lg active:scale-95 transition"
            >
              Start a card — free →
            </Link>
          </div>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Campfire is operated by 10323594 Canada Corp. Cards &amp; gifts are organized by
          participants.
        </p>
      </section>
    </main>
  );
}
