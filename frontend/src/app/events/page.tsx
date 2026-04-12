// frontend/src/app/events/page.tsx
"use client";
import React from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  Sparkles,
  Clock,
  Smartphone,
  ChevronRight,
  Zap,
  Gamepad2,
  Target,
  Trophy,
  Mic2,
  Brain,
  Palette,
  BarChart3,
  GraduationCap,
  Handshake,
  Megaphone,
  ArrowRight,
  CheckCircle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const eventTypes = [
  {
    id: "team-building",
    emoji: "🤝",
    label: "Team Building",
    desc: "Icebreakers, energizers, and competitive games that get people talking and collaborating.",
    icon: <Handshake className="w-6 h-6" />,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  {
    id: "conference",
    emoji: "🎤",
    label: "Conferences & Summits",
    desc: "Turn keynote content into interactive team challenges during breakout sessions.",
    icon: <Mic2 className="w-6 h-6" />,
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
  },
  {
    id: "training",
    emoji: "🎓",
    label: "Training & Onboarding",
    desc: "Reinforce new-hire material, compliance content, or skill development with games.",
    icon: <GraduationCap className="w-6 h-6" />,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  {
    id: "offsite",
    emoji: "🏔️",
    label: "Offsites & Retreats",
    desc: "High-energy activities for team retreats that mix fun with strategic thinking.",
    icon: <Target className="w-6 h-6" />,
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
];

const industryThemes = [
  { id: "tech", emoji: "💻", label: "Tech / SaaS", vocab: ["API", "deployment", "sprint", "standup", "pull request", "latency", "microservice", "agile", "refactor", "CI/CD"] },
  { id: "finance", emoji: "📊", label: "Finance", vocab: ["portfolio", "hedge", "dividend", "equity", "liquidity", "amortization", "yield curve", "arbitrage", "compliance", "fiduciary"] },
  { id: "healthcare", emoji: "🏥", label: "Healthcare", vocab: ["triage", "diagnosis", "protocol", "patient outcome", "HIPAA", "clinical trial", "prognosis", "formulary", "EHR", "palliative"] },
  { id: "marketing", emoji: "📣", label: "Marketing", vocab: ["conversion", "funnel", "attribution", "impressions", "engagement rate", "retargeting", "brand equity", "CTA", "A/B test", "churn"] },
  { id: "sales", emoji: "🤝", label: "Sales", vocab: ["pipeline", "discovery call", "quota", "close rate", "objection handling", "upsell", "champion", "BANT", "POC", "renewal"] },
  { id: "hr", emoji: "👥", label: "HR / People", vocab: ["retention", "onboarding", "DEI", "performance review", "engagement survey", "HRIS", "succession planning", "employer brand", "attrition", "PIP"] },
  { id: "legal", emoji: "⚖️", label: "Legal", vocab: ["liability", "indemnity", "compliance", "due diligence", "NDA", "arbitration", "precedent", "statute", "injunction", "jurisdiction"] },
  { id: "product", emoji: "🛠️", label: "Product / Design", vocab: ["user story", "wireframe", "MVP", "iteration", "A/B test", "persona", "roadmap", "OKR", "feature flag", "design system"] },
  { id: "general", emoji: "🏢", label: "General Business", vocab: ["stakeholder", "ROI", "synergy", "bandwidth", "deliverable", "alignment", "KPI", "scalable", "leverage", "pivot"] },
];

const eventTypeThemes = [
  { id: "icebreaker", emoji: "🧊", label: "Icebreaker", vocab: ["two truths and a lie", "fun fact", "bucket list", "hidden talent", "first job", "guilty pleasure", "unpopular opinion", "pet peeve", "dream vacation", "superpower"] },
  { id: "team-building", emoji: "🏗️", label: "Team Building", vocab: ["collaboration", "trust", "communication", "leadership", "problem solving", "brainstorm", "consensus", "delegation", "feedback", "team spirit"] },
  { id: "conference-recap", emoji: "📝", label: "Conference Recap", vocab: ["keynote", "takeaway", "action item", "insight", "trend", "disruption", "innovation", "panel", "Q&A", "breakout session"] },
  { id: "onboarding", emoji: "🚀", label: "New Hire Onboarding", vocab: ["company values", "org chart", "mission statement", "benefits", "code of conduct", "mentor", "probation", "handbook", "culture", "all-hands"] },
  { id: "quarterly", emoji: "📈", label: "Quarterly Kickoff", vocab: ["OKR", "target", "roadmap", "retrospective", "milestone", "forecast", "pipeline review", "win", "challenge", "north star metric"] },
  { id: "holiday", emoji: "🎄", label: "Holiday Party", vocab: ["celebration", "gratitude", "highlights", "year in review", "toast", "award", "recognition", "tradition", "resolution", "team spirit"] },
];

const eventGames = [
  {
    icon: <Zap className="w-6 h-6" />,
    title: "Flashcards Race",
    desc: "Buzzer-style trivia where teams race to answer first. Perfect for reinforcing keynote content or testing product knowledge.",
    color: "text-yellow-600",
    bg: "bg-yellow-50",
  },
  {
    icon: <Brain className="w-6 h-6" />,
    title: "Brain Blitz",
    desc: "Jeopardy-style progressive clue reveals. Great for industry trivia, company history, or training material recall.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: <Palette className="w-6 h-6" />,
    title: "Speed Draw",
    desc: "Pictionary meets the boardroom. Draw industry concepts while your team shouts guesses. An instant icebreaker.",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: <Users className="w-6 h-6" />,
    title: "Fake Out",
    desc: "Bluffing game where teams write fake definitions for real terms. Who can fool the most people?",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: <Gamepad2 className="w-6 h-6" />,
    title: "Guess Who",
    desc: "Deduction game with yes/no questions. Use company trivia, product features, or industry figures as the secret targets.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: <Trophy className="w-6 h-6" />,
    title: "Live Debate",
    desc: "Structured team debates with AI judging. Tackle industry hot takes, strategy decisions, or fun hypotheticals.",
    color: "text-pink-600",
    bg: "bg-pink-50",
  },
];

const steps = [
  { n: "1", title: "Pick your event type", desc: "Team building, conference, training, or offsite — each shapes the game mix." },
  { n: "2", title: "Choose an industry", desc: "Tech, Finance, Healthcare, or others — we pre-load relevant vocabulary." },
  { n: "3", title: "Add your content", desc: "Paste in keynote takeaways, training terms, company values, or inside jokes." },
  { n: "4", title: "AI builds the games", desc: "In under 60 seconds, Curriculate generates a full set of event-ready games." },
  { n: "5", title: "Attendees join on phones", desc: "Share a room code. No app, no accounts — any phone or laptop works." },
];

const stats = [
  { value: "60s", label: "to generate a full event" },
  { value: "300+", label: "attendees per session" },
  { value: "30+", label: "interactive game types" },
  { value: "0", label: "apps to download" },
];

const useCases = [
  {
    title: "Conference breakout session",
    scenario: "200-person SaaS conference. Between keynotes, attendees break into teams of 5 and compete in Flashcards Race + Brain Blitz using vocabulary from the morning talks.",
    result: "92% engagement rate vs. 40% for traditional Q&A. Attendees actually remembered the content.",
  },
  {
    title: "New hire onboarding week",
    scenario: "30 new hires across 3 offices. HR pastes company values, org structure terms, and product names into Curriculate. Teams compete in Speed Draw + Fake Out.",
    result: "New hires learned 3x more company terminology in half the time. Plus they actually knew each other's names by Friday.",
  },
  {
    title: "Quarterly sales kickoff",
    scenario: "Sales team of 60. Manager pastes the new product positioning, objection-handling phrases, and competitor names. Teams battle through Flashcards Race + Guess Who.",
    result: "Reps retained product messaging 2x better than slide-deck-only kickoffs. The leaderboard got competitive fast.",
  },
];

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function EventsPage() {
  const [activeIndustry, setActiveIndustry] = React.useState("tech");
  const [activeEventType, setActiveEventType] = React.useState("icebreaker");

  const industry = industryThemes.find((t) => t.id === activeIndustry) || industryThemes[0];
  const evtType = eventTypeThemes.find((t) => t.id === activeEventType) || eventTypeThemes[0];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Corporate Event Games — AI-Powered Team Activities",
            description:
              "Interactive team games for conferences, offsites, and corporate events. AI generates custom activities from your event content.",
            url: "https://curriculate.net/events",
            mainEntity: {
              "@type": "SoftwareApplication",
              name: "Curriculate Events",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free tier available for events",
              },
            },
          }),
        }}
      />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-100/30 via-transparent to-indigo-100/30 pointer-events-none" />
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 relative">
          <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-700 mb-6">
              <Building2 className="w-4 h-4" />
              <span>Corporate Events & Conferences</span>
            </div>

            <h1 className="text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Turn any event into an{" "}
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                unforgettable experience
              </span>
            </h1>

            <p className="mt-6 text-lg text-slate-600 max-w-2xl">
              Paste your conference content, training material, or company vocabulary —
              and Curriculate builds interactive team games in 60 seconds.
              Attendees join on their phones. No app. No awkward silence.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/signup?mode=event"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:shadow-xl hover:shadow-blue-300 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Plan an Event — Free
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
              No credit card required. Works on any device.
            </p>
          </div>

          {/* Stats bar */}
          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-extrabold text-slate-900">{s.value}</div>
                <div className="text-sm text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Built for every type of event
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            Whether it&apos;s a 20-person offsite or a 500-person conference,
            Curriculate adapts the game mix, pacing, and content to match.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {eventTypes.map((evt) => (
            <div
              key={evt.id}
              className={`rounded-2xl border ${evt.border} ${evt.bg} p-6 hover:shadow-md transition-shadow`}
            >
              <div className={`mb-3 ${evt.color}`}>{evt.icon}</div>
              <h3 className="font-bold text-slate-900">{evt.label}</h3>
              <p className="mt-1 text-sm text-slate-600">{evt.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DUAL-AXIS THEME PICKER */}
      <section className="bg-white border-y border-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-700 mb-4">
              <Target className="w-4 h-4" />
              Smart Theming
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Pick your industry + event type
            </h2>
            <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
              Both axes contribute vocabulary. You can also paste in your own content —
              keynote notes, training docs, company jargon, or inside jokes.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Industry axis */}
            <div>
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400" />
                Industry
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {industryThemes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveIndustry(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                      activeIndustry === t.id
                        ? "bg-blue-600 text-white shadow-md"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                  {industry.emoji} {industry.label} vocabulary
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {industry.vocab.map((word) => (
                    <span
                      key={word}
                      className="inline-block rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Event type axis */}
            <div>
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-slate-400" />
                Event Type
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {eventTypeThemes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveEventType(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                      activeEventType === t.id
                        ? "bg-indigo-600 text-white shadow-md"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                  {evtType.emoji} {evtType.label} vocabulary
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {evtType.vocab.map((word) => (
                    <span
                      key={word}
                      className="inline-block rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Combined preview */}
          <div className="mt-8 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/50 p-5 text-center">
            <div className="text-sm font-bold text-indigo-700 mb-2">
              Combined vocab: {industry.label} + {evtType.label}
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {[...industry.vocab.slice(0, 5), ...evtType.vocab.slice(0, 5)].map((word, i) => (
                <span
                  key={`${word}-${i}`}
                  className="inline-block rounded-full bg-white border border-indigo-200 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                >
                  {word}
                </span>
              ))}
              <span className="inline-block rounded-full bg-indigo-100 border border-indigo-200 px-2.5 py-0.5 text-xs font-bold text-indigo-600">
                + your custom content
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* GAMES */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-700 mb-4">
            <Gamepad2 className="w-4 h-4" />
            Event Games
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Games that work for professionals
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            High-energy and competitive, but never cringeworthy. Every game is themed
            to your event content so it feels purposeful, not forced.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {eventGames.map((game) => (
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
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-white border-y border-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
              How it works
            </h2>
            <p className="mt-3 text-slate-600">From zero to live event in five steps.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((step) => (
              <div key={step.n} className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-extrabold text-lg shadow-md">
                  {step.n}
                </div>
                <h3 className="font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700 mb-4">
            <BarChart3 className="w-4 h-4" />
            Real Scenarios
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            How teams are using it
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {useCases.map((uc) => (
            <div
              key={uc.title}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <h3 className="font-bold text-slate-900 mb-3">{uc.title}</h3>
              <p className="text-sm text-slate-600 mb-4">{uc.scenario}</p>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm font-medium text-emerald-800">{uc.result}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SCALE */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Scales from 10 to 500+
          </h2>
          <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
            Whether it&apos;s a leadership lunch or a multi-day conference, the experience scales seamlessly.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3 max-w-3xl mx-auto">
          {[
            { range: "10–30 people", desc: "Small team lunches, offsites, or training workshops. Everyone competes head to head.", emoji: "👥" },
            { range: "30–100 people", desc: "Department events, onboarding cohorts, or regional meetups. Auto-balanced teams keep it fair.", emoji: "🏢" },
            { range: "100–500+", desc: "Company all-hands, conferences, or multi-room events. Room codes segment the crowd into parallel sessions.", emoji: "🏟️" },
          ].map((size) => (
            <div key={size.range} className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <span className="text-3xl">{size.emoji}</span>
              <h3 className="mt-3 font-bold text-slate-900">{size.range}</h3>
              <p className="mt-2 text-sm text-slate-600">{size.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CROSS-LINK: Parties */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/parties"
          className="group block rounded-2xl border border-pink-200 bg-gradient-to-r from-pink-50 to-purple-50 p-6 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-bold text-pink-600 mb-1">Planning a birthday or personal celebration?</div>
              <div className="text-slate-800 font-extrabold text-lg">
                Curriculate for Parties
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Themed party packs, kid-friendly games, and personal touches — perfect for birthdays and celebrations.
              </div>
            </div>
            <div className="text-pink-600 group-hover:translate-x-1 transition-transform">
              <ChevronRight className="w-6 h-6" />
            </div>
          </div>
        </Link>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-3xl font-extrabold text-white">
            Make your next event the one people talk about
          </h2>
          <p className="mt-4 text-blue-100 max-w-xl mx-auto">
            Sign up free, paste your content, and have event-ready games in under a minute.
            Your attendees will think you hired an experience agency.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup?mode=event"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-blue-700 shadow-lg hover:shadow-xl transition-all"
            >
              <Building2 className="w-4 h-4" />
              Plan an Event — Free
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold text-white hover:bg-white/20 transition-all"
            >
              Talk to Us About Enterprise
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
