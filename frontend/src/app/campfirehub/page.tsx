import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Campfire — group gifts, raffles, pledge drives & prize challenges 🔥",
  description:
    "Bring your group together: a card everyone signs + a group gift, a raffle where everyone chips in, a Read-A-Thon, or a cash-pot photo challenge. No app, no account to join. Pick your thing.",
  robots: { index: false },
};

const ANGLES = [
  {
    href: "/groupcards",
    emoji: "🎁",
    title: "Group cards & gifts",
    sub: "One card everyone secretly signs + a gift card, sent on the day. Birthdays, teachers, coaches, farewells.",
    grad: "from-orange-500 to-rose-500",
  },
  {
    href: "/raffle",
    emoji: "🎟️",
    title: "Raffles & 50-50 draws",
    sub: "Everyone chips in to the pot; a random winner takes it. Reunions, fundraisers — draw it live at the event.",
    grad: "from-fuchsia-500 to-purple-600",
  },
  {
    href: "/pledge",
    emoji: "🎗️",
    title: "Read-A-Thons & pledge drives",
    sub: "Sponsors pledge per page or km and pay only for what's achieved — shortfalls auto-refunded.",
    grad: "from-rose-500 to-orange-500",
  },
  {
    href: "/play",
    emoji: "🏆",
    title: "Prize challenges & tournaments",
    sub: "Photo challenges, scavenger hunts and score tournaments with a cash pot — play from anywhere.",
    grad: "from-amber-500 to-orange-600",
  },
];

export default function CampfireHubPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-amber-50 text-slate-900">
      <section className="mx-auto max-w-xl px-5 pt-12 pb-8 text-center">
        <div className="text-5xl mb-3">🔥</div>
        <h1 className="text-4xl sm:text-5xl font-black leading-[1.05] tracking-tight">
          Bring your group{" "}
          <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
            together
          </span>
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Cards, gifts, raffles, fundraisers and prize challenges — for your family,
          class, team or club. No app, no account to join. Pick your thing:
        </p>
      </section>

      <section className="mx-auto max-w-xl px-5 pb-10 space-y-3">
        {ANGLES.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
          >
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${a.grad} text-2xl`}
            >
              {a.emoji}
            </div>
            <div className="min-w-0">
              <div className="font-extrabold text-slate-900">{a.title}</div>
              <div className="mt-0.5 text-sm text-slate-600 leading-relaxed">{a.sub}</div>
            </div>
            <div className="ml-auto text-slate-300 text-xl">→</div>
          </Link>
        ))}
      </section>

      <section className="mx-auto max-w-xl px-5 pb-16 text-center">
        <Link
          href="/campfirelive"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-8 py-4 text-lg font-black text-white shadow-xl shadow-orange-500/30 active:scale-95 transition"
        >
          Start free →
        </Link>
        <p className="mt-3 text-xs text-slate-400">
          Free to start · the whole group joins with just their name
        </p>
        <p className="mt-8 text-[11px] leading-relaxed text-slate-400">
          Campfire is operated by 10323594 Canada Corp. Cards, gifts, pots &amp; pledges
          are organized by participants.
        </p>
      </section>
    </main>
  );
}
