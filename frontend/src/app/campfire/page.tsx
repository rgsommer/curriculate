import Link from "next/link";
import {
  CAMPFIRE_ANDROID_LIVE,
  CAMPFIRE_ANDROID_URL,
  CAMPFIRE_IOS_URL,
} from "@/lib/campfire/appLinks";
import { CF_PRIMARY, CF_SECONDARY } from "@/lib/campfire/ui";

// Campfire's front door. Leads with what people actually come for — a card everyone
// signs from one link — then the other things a group can do, and the reassurances a
// careful (church / school / family) audience looks for. No Curriculate chrome, no
// "prototype" labels: the interactive demo lives at /campfire/demo.

const THINGS = [
  {
    emoji: "💌",
    title: "Group cards",
    body: "Birthdays, pastors, teachers, farewells. Everyone signs from one link; it opens on the day.",
  },
  {
    emoji: "📊",
    title: "Polls & check-ins",
    body: "Ask the group anything. Answers stay sealed until everyone's in — so nobody just follows the crowd.",
  },
  {
    emoji: "📸",
    title: "Photo contests",
    body: "Best catch, best costume, best view. Everyone enters, the group votes, the winner's celebrated.",
  },
  {
    emoji: "📝",
    title: "Sign-ups",
    body: "Potlucks, meal trains, who's bringing what. One list, no reply-all.",
  },
];

const STEPS = [
  { n: 1, title: "Pick what to start", body: "A card, a poll, a contest — most take about a minute to set up." },
  { n: 2, title: "Share one link", body: "Paste it in email, a group chat or a bulletin. People join with just their name." },
  { n: 3, title: "It opens together", body: "Notes and answers stay hidden until the day — then everyone sees them at once." },
];

function CardMock() {
  // A stand-in for a real card (same look as the card pictures in emails) — no real data.
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="rotate-[-2deg] rounded-3xl border-2 border-orange-200 bg-white p-6 text-center shadow-[0_18px_50px_rgba(244,63,94,0.18)]">
        <div className="text-6xl">🎂</div>
        <div className="mt-3 text-xs font-extrabold uppercase tracking-[0.2em] text-rose-600">
          Birthday card
        </div>
        <div className="mt-1 text-2xl font-extrabold leading-tight text-slate-900">
          Happy 80th, Grandma! 🎉
        </div>
        <div className="mt-4 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-bold text-white">
          ✍️ Sign the card · opens Sat
        </div>
      </div>
      <div className="absolute -bottom-6 right-1 rotate-[3deg] rounded-2xl border border-slate-200 bg-white px-4 py-2 text-left text-sm shadow-lg">
        <div className="font-semibold text-slate-800">💌 23 notes inside</div>
        <div className="text-xs text-slate-500">from the whole family</div>
      </div>
    </div>
  );
}

export default function CampfireLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 text-slate-800">
      {/* Slim Campfire bar — not the Curriculate site nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/campfire" className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
          <span className="text-2xl">🔥</span> Campfire
        </Link>
        <Link href="/campfirelive" className={CF_SECONDARY}>
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 py-8 sm:py-14 md:grid-cols-2">
          <div>
            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
              Sign a card together.{" "}
              <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                Ask your group anything.
              </span>
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Campfire is a free, simple way for families, churches, classes and teams to do
              something together — a surprise card everyone signs, a poll, a photo contest.
              Everything opens for everyone at once.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/campfirelive" className={CF_PRIMARY}>
                Get started — it&apos;s free
              </Link>
              <Link href="/aboutcampfire" className={CF_SECONDARY}>
                How it works
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Got a link from someone? Just tap it — you&apos;ll land right on their card or
              activity. No account needed to sign.
            </p>
          </div>
          <div className="pb-6">
            <CardMock />
          </div>
        </section>

        {/* Trust strip */}
        <section className="mb-12 grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 sm:grid-cols-3">
          <div>🔒 <strong>No account to sign</strong> — just your name.</div>
          <div>💸 <strong>Free to sign</strong> — chipping in to a gift is always optional.</div>
          <div>🙈 <strong>No ads</strong>, and your group&apos;s notes stay private.</div>
        </section>

        {/* What you can do */}
        <section className="mb-14">
          <h2 className="text-2xl font-extrabold text-slate-900">What groups do on Campfire</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {THINGS.map((t) => (
              <div key={t.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="text-3xl">{t.emoji}</div>
                <div>
                  <div className="text-lg font-bold text-slate-900">{t.title}</div>
                  <p className="mt-0.5 text-sm text-slate-600">{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mb-14">
          <h2 className="text-2xl font-extrabold text-slate-900">How it works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl border border-orange-200 bg-orange-50/60 p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-orange-500 to-rose-500 text-sm font-bold text-white">
                  {s.n}
                </div>
                <div className="mt-3 font-bold text-slate-900">{s.title}</div>
                <p className="mt-1 text-sm text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Final CTA + apps */}
        <section className="mb-12 rounded-3xl bg-gradient-to-r from-orange-500 to-rose-500 p-8 text-center text-white">
          <div className="text-4xl">🔥</div>
          <h2 className="mt-2 text-2xl font-extrabold">Start your first card in a minute</h2>
          <p className="mx-auto mt-2 max-w-md text-white/90">
            Free to start. Use it in your browser, or get the app.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/campfirelive"
              className="rounded-full bg-white px-6 py-3 text-sm font-bold text-rose-600 shadow-sm hover:bg-rose-50"
            >
              Get started
            </Link>
            <a
              href={CAMPFIRE_IOS_URL}
              className="rounded-full border border-white/70 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
               iPhone app
            </a>
            {CAMPFIRE_ANDROID_LIVE && (
              <a
                href={CAMPFIRE_ANDROID_URL}
                className="rounded-full border border-white/70 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                ▶ Android app
              </a>
            )}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-slate-500 sm:px-6">
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link href="/campfire/demo" className="hover:text-slate-700">Try the demo</Link>
          <Link href="/campfire/privacy" className="hover:text-slate-700">Privacy</Link>
          <Link href="/campfire/terms" className="hover:text-slate-700">Terms</Link>
          <Link href="/campfire/support" className="hover:text-slate-700">Support</Link>
        </div>
        <p className="mt-3">Campfire is operated by 10323594 Canada Corp.</p>
      </footer>
    </div>
  );
}
