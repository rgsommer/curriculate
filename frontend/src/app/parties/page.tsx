// frontend/src/app/parties/page.tsx
"use client";
import React from "react";
import Link from "next/link";
import {
  PartyPopper,
  Rocket,
  Palette,
  Trophy,
  Music,
  Users,
  Sparkles,
  Clock,
  Smartphone,
  ChevronRight,
  Star,
  Zap,
  Gift,
  Gamepad2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  PARTY THEMES                                                       */
/* ------------------------------------------------------------------ */

const partyThemes = [
  {
    id: "dinosaurs",
    emoji: "🦕",
    label: "Dinosaurs",
    color: "from-green-500 to-emerald-600",
    bgLight: "bg-green-50",
    border: "border-green-200",
    vocab: ["T-Rex", "Triceratops", "Stegosaurus", "fossil", "herbivore", "carnivore", "Jurassic", "extinction", "paleontologist", "velociraptor"],
  },
  {
    id: "space",
    emoji: "🚀",
    label: "Space",
    color: "from-indigo-500 to-purple-600",
    bgLight: "bg-indigo-50",
    border: "border-indigo-200",
    vocab: ["planet", "asteroid", "galaxy", "astronaut", "orbit", "comet", "nebula", "gravity", "solar system", "constellation"],
  },
  {
    id: "sports",
    emoji: "⚽",
    label: "Sports",
    color: "from-orange-500 to-red-500",
    bgLight: "bg-orange-50",
    border: "border-orange-200",
    vocab: ["championship", "referee", "penalty", "goalkeeper", "marathon", "relay", "sportsmanship", "offense", "defense", "tournament"],
  },
  {
    id: "ocean",
    emoji: "🐙",
    label: "Under the Sea",
    color: "from-cyan-500 to-blue-600",
    bgLight: "bg-cyan-50",
    border: "border-cyan-200",
    vocab: ["coral reef", "dolphin", "whale", "seahorse", "jellyfish", "octopus", "submarine", "tide", "bioluminescence", "plankton"],
  },
  {
    id: "superheroes",
    emoji: "🦸",
    label: "Superheroes",
    color: "from-red-500 to-yellow-500",
    bgLight: "bg-red-50",
    border: "border-red-200",
    vocab: ["superpower", "villain", "sidekick", "shield", "cape", "headquarters", "identity", "mission", "nemesis", "rescue"],
  },
  {
    id: "animals",
    emoji: "🐾",
    label: "Animals",
    color: "from-amber-500 to-orange-500",
    bgLight: "bg-amber-50",
    border: "border-amber-200",
    vocab: ["habitat", "camouflage", "migration", "predator", "nocturnal", "endangered", "ecosystem", "hibernate", "mammal", "amphibian"],
  },
  {
    id: "magic",
    emoji: "🧙",
    label: "Wizards & Magic",
    color: "from-purple-500 to-pink-500",
    bgLight: "bg-purple-50",
    border: "border-purple-200",
    vocab: ["spell", "potion", "enchantment", "wand", "crystal", "sorcery", "invisible", "prophecy", "apprentice", "talisman"],
  },
  {
    id: "music",
    emoji: "🎵",
    label: "Music",
    color: "from-pink-500 to-rose-500",
    bgLight: "bg-pink-50",
    border: "border-pink-200",
    vocab: ["rhythm", "melody", "harmony", "tempo", "chorus", "instrument", "conductor", "lyrics", "bass", "treble"],
  },
];

const partyGames = [
  {
    icon: <Zap className="w-6 h-6" />,
    title: "Flashcards Race",
    desc: "Buzz in to answer first! Fast-paced team trivia with points, sound effects, and a live leaderboard.",
    color: "text-yellow-600",
    bg: "bg-yellow-50",
  },
  {
    icon: <Music className="w-6 h-6" />,
    title: "Musical Chairs",
    desc: "Quick-tap question rounds with elimination energy. Answer fast or get knocked out!",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: <Gamepad2 className="w-6 h-6" />,
    title: "Brain Blitz",
    desc: "Jeopardy-style clue reveals. Teams race to guess the answer from progressively easier hints.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: <Palette className="w-6 h-6" />,
    title: "Speed Draw",
    desc: "Pictionary meets party mode. Draw the clue while your team shouts guesses against the clock.",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: <Trophy className="w-6 h-6" />,
    title: "Treasure Runner",
    desc: "Tilt-to-run obstacle course on phones. Kids physically move to dodge and collect treasure.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: <Star className="w-6 h-6" />,
    title: "Draw & Mime",
    desc: "Classic party charades — draw or act it out while the group guesses. Hilarious every time.",
    color: "text-pink-600",
    bg: "bg-pink-50",
  },
];

const steps = [
  {
    n: "1",
    title: "Pick a theme",
    desc: "Choose from dinosaurs, space, sports, and more — or create your own.",
    icon: <Palette className="w-5 h-5" />,
  },
  {
    n: "2",
    title: "Add personal touches",
    desc: "Throw in the birthday kid's name, favorite things, or inside jokes as custom vocab.",
    icon: <Gift className="w-5 h-5" />,
  },
  {
    n: "3",
    title: "AI builds the games",
    desc: "In under 60 seconds, Curriculate generates a full set of party-ready games.",
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    n: "4",
    title: "Kids join on phones",
    desc: "No app needed. Share a room code and kids join instantly from any device.",
    icon: <Smartphone className="w-5 h-5" />,
  },
  {
    n: "5",
    title: "Let the party begin",
    desc: "Teams rotate through stations, compete, laugh, and move. You just supervise the fun.",
    icon: <PartyPopper className="w-5 h-5" />,
  },
];

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function PartiesPage() {
  const [activeTheme, setActiveTheme] = React.useState("dinosaurs");
  const theme = partyThemes.find((t) => t.id === activeTheme) || partyThemes[0];

  return (
    <main className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50">
      {/* Structured data for rich search results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Birthday Party Games — AI-Powered Party Activities",
            description:
              "Turn any birthday party into an epic game show. AI generates themed interactive team games that run on phones.",
            url: "https://curriculate.net/parties",
            mainEntity: {
              "@type": "SoftwareApplication",
              name: "Curriculate Party Mode",
              applicationCategory: "EntertainmentApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free plan includes party mode",
              },
            },
          }),
        }}
      />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-100/40 via-transparent to-purple-100/40 pointer-events-none" />
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 relative">
          <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-pink-100 px-4 py-1.5 text-sm font-bold text-pink-700 mb-6">
              <PartyPopper className="w-4 h-4" />
              <span>New: Party Mode</span>
            </div>

            <h1 className="text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Birthday parties that kids{" "}
              <span className="bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">
                actually remember
              </span>
            </h1>

            <p className="mt-6 text-lg text-slate-600 max-w-2xl">
              Turn any birthday party into an epic game show. Pick a theme, add personal touches
              for the birthday kid, and Curriculate builds a full set of interactive team games
              that run on phones — no app download required.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/signup?mode=party"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-600 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pink-200 hover:shadow-xl hover:shadow-pink-300 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Plan a Party — Free
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 transition-all"
              >
                Try the Demo
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <p className="mt-4 text-sm text-slate-500">
              No credit card. Works on any phone or tablet.
            </p>
          </div>
        </div>
      </section>

      {/* WHY CURRICULATE FOR PARTIES */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Why parents love Curriculate parties
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            No more awkward silences, bored kids, or expensive entertainers.
            Just pick a theme and let the AI handle the rest.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: <Clock className="w-6 h-6 text-pink-600" />, title: "Ready in 60 seconds", desc: "Pick a theme, tap generate, done. No crafting, no printing, no prep stress." },
            { icon: <Users className="w-6 h-6 text-purple-600" />, title: "Keeps every kid engaged", desc: "Teams rotate through stations so nobody is standing around waiting for a turn." },
            { icon: <Smartphone className="w-6 h-6 text-blue-600" />, title: "Phones they already have", desc: "Kids join with a room code on any device. No app install, no account needed." },
            { icon: <Trophy className="w-6 h-6 text-yellow-600" />, title: "Real competition", desc: "Points, leaderboards, sound effects, and confetti. It feels like a real game show." },
            { icon: <Rocket className="w-6 h-6 text-emerald-600" />, title: "Gets them moving", desc: "Treasure Runner, Mad Dash, Musical Chairs — physical movement baked right in." },
            { icon: <Gift className="w-6 h-6 text-orange-600" />, title: "Personal touches", desc: "Add the birthday kid's name, favorite things, and inside jokes to the games." },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="mb-3">{item.icon}</div>
              <h3 className="font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* THEME PICKER PREVIEW */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-sm font-bold text-purple-700 mb-4">
            <Palette className="w-4 h-4" />
            Themed Party Packs
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Pick a theme, we handle the rest
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            Each theme comes pre-loaded with vocabulary. You can add custom words too —
            like the birthday kid&apos;s name, their pet, or a family inside joke.
          </p>
        </div>

        {/* Theme selector chips */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {partyThemes.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTheme(t.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all ${
                activeTheme === t.id
                  ? "bg-gradient-to-r " + t.color + " text-white shadow-md scale-105"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Active theme preview */}
        <div className={`mx-auto max-w-2xl rounded-2xl border ${theme.border} ${theme.bgLight} p-6`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">{theme.emoji}</span>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">{theme.label} Party Pack</h3>
              <p className="text-sm text-slate-600">Pre-loaded vocabulary — tap any to remove, or add your own below</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {theme.vocab.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 border border-slate-200 shadow-sm"
              >
                {word}
              </span>
            ))}
          </div>

          <div className="rounded-xl bg-white border border-dashed border-slate-300 p-4 text-center">
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">+ Add custom words:</span>{" "}
              birthday kid&apos;s name, favorite food, pet&apos;s name, inside jokes...
            </p>
          </div>
        </div>
      </section>

      {/* PARTY GAMES */}
      <section className="bg-white border-y border-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-700 mb-4">
              <Gamepad2 className="w-4 h-4" />
              Party Games
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Games that actually work at parties
            </h2>
            <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
              Curriculate picks from these high-energy, team-based games — all themed to your party.
              No quiet worksheets here.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {partyGames.map((game) => (
              <div
                key={game.title}
                className={`rounded-2xl border border-slate-200 ${game.bg} p-6 hover:shadow-md transition-shadow`}
              >
                <div className={`mb-3 ${game.color}`}>{game.icon}</div>
                <h3 className="font-bold text-slate-900">{game.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{game.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            How it works
          </h2>
          <p className="mt-3 text-slate-600">Five steps from zero to party time.</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step) => (
            <div key={step.n} className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-purple-500 text-white font-extrabold text-lg shadow-md">
                {step.n}
              </div>
              <h3 className="font-bold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AGE RANGE */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Works for every age
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            The AI adjusts difficulty, vocabulary complexity, and game pacing to match your guests.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3 max-w-3xl mx-auto">
          {[
            { range: "Ages 5–8", desc: "Simple vocab, lots of movement games, big colorful visuals. Perfect for high-energy little ones.", emoji: "🎈" },
            { range: "Ages 9–12", desc: "Trivia challenges, drawing games, team strategy. Competitive enough to keep tweens hooked.", emoji: "🏆" },
            { range: "Ages 13+", desc: "Harder questions, faster pacing, social deduction games. Even teens put their phones down for this.", emoji: "🔥" },
          ].map((age) => (
            <div key={age.range} className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <span className="text-3xl">{age.emoji}</span>
              <h3 className="mt-3 font-bold text-slate-900">{age.range}</h3>
              <p className="mt-2 text-sm text-slate-600">{age.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CROSS-LINK: Events */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/events"
          className="group block rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-bold text-blue-600 mb-1">Looking for something more professional?</div>
              <div className="text-slate-800 font-extrabold text-lg">
                Curriculate for Corporate Events & Conferences
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Team building, conference breakouts, training sessions, and offsites — with industry-specific content.
              </div>
            </div>
            <div className="text-blue-600 group-hover:translate-x-1 transition-transform">
              <ChevronRight className="w-6 h-6" />
            </div>
          </div>
        </Link>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-pink-600 to-purple-600">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-3xl font-extrabold text-white">
            Ready to throw the best party ever?
          </h2>
          <p className="mt-4 text-pink-100 max-w-xl mx-auto">
            Sign up free, pick a theme, and have your party games ready in under a minute.
            The birthday kid will think you hired a professional.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup?mode=party"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-pink-700 shadow-lg hover:shadow-xl transition-all"
            >
              <PartyPopper className="w-4 h-4" />
              Plan a Party — Free
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold text-white hover:bg-white/20 transition-all"
            >
              Try the Demo First
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
