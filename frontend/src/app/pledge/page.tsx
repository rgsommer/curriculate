import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Campfire — Run a Read-A-Thon / pledge drive 🎗️",
  description:
    "A sponsored challenge done right. Sponsors pledge a lump sum or per page/km; they pay only for what's achieved, and shortfalls are auto-refunded. Donors can give anonymously by QR. No app, no account.",
  robots: { index: false },
};

const CTA = "/campfirelive?start=pledge-drive";

const EXAMPLES = [
  { icon: "📚", title: "Read-A-Thon", sub: "Pledge 10¢ a page; the kid reads, sponsors pay for what's read." },
  { icon: "🚴", title: "Bike-A-Thon", sub: "Per-km pledges for a team or a cause — settle on the day." },
  { icon: "🏃", title: "Walk / run", sub: "Sponsor laps or kilometres; auto-refund the shortfall." },
  { icon: "💛", title: "School / church drive", sub: "Name the cause; donors can also give a flat gift by QR." },
];

const STEPS = [
  { n: "1", t: "Set the goal", d: "Choose the unit (pages, km…) and the target, a suggested pledge rate, who receives the funds, and a date." },
  { n: "2", t: "Sponsors pledge", d: "A lump sum or a per-unit rate with a cap. Charged the estimate upfront — sponsor-safe, fully automatic. Passers-by can donate by QR too." },
  { n: "3", t: "Post the result", d: "Enter what was achieved. Each pledge settles to exactly that — shortfalls auto-refunded — and the funds go out as a gift card." },
];

function Cta({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={CTA}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-8 py-4 text-lg font-black text-white shadow-xl shadow-rose-500/30 active:scale-95 transition"
    >
      {children}
    </Link>
  );
}

export default function PledgeLandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-rose-50 via-white to-orange-50 text-slate-900">
      <section className="mx-auto max-w-xl px-5 pt-12 pb-10 text-center">
        <div className="text-5xl mb-3">🎗️</div>
        <h1 className="text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight">
          Run a{" "}
          <span className="bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
            Read-A-Thon
          </span>{" "}
          the easy way
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Sponsors pledge per page or a lump sum — and <b>pay only for what&apos;s
          achieved</b>. Shortfalls auto-refund. Fully automatic, sponsor-safe.
        </p>
        <div className="mt-7">
          <Cta>Start a pledge drive — free →</Cta>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Free to start · no app · sponsors need no account
        </p>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-10">
        <div className="grid grid-cols-2 gap-3">
          {EXAMPLES.map((e) => (
            <div key={e.title} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-base font-black text-white">
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
        <div className="rounded-3xl bg-gradient-to-br from-rose-500 to-orange-500 px-6 py-10 text-white shadow-xl">
          <h2 className="text-2xl font-black leading-tight">Get your drive going</h2>
          <p className="mt-2 text-sm text-white/90">
            Pay-for-what&apos;s-achieved pledges, automatic refunds, optional anonymous
            QR donations — all in a couple of taps.
          </p>
          <div className="mt-6">
            <Link
              href={CTA}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-black text-rose-600 shadow-lg active:scale-95 transition"
            >
              Start a pledge drive — free →
            </Link>
          </div>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Campfire is operated by 10323594 Canada Corp. Pledges &amp; gifts are organized
          by participants; a named cause is the host&apos;s responsibility (not a charity,
          no tax receipts).
        </p>
      </section>
    </main>
  );
}
