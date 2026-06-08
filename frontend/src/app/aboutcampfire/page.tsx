import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Campfire Works — Group Engagement Reimagined",
  description:
    "New to Campfire? Here's how it works: join a group, answer the question, and nobody sees the results until everyone responds. Then it all opens at once. A friendly walkthrough plus the full feature tour — 12 activity types, sealed reveals, streaks, and template packs for families, friends, churches, classes, and communities.",
  keywords: [
    "campfire app",
    "how campfire works",
    "campfire intro",
    "campfire getting started",
    "group engagement app",
    "sealed polls",
    "sealed reveal",
    "group challenges",
    "join a campfire group",
    "classroom engagement app",
    "family group app",
    "church group activities",
    "community engagement platform",
    "group activities app",
    "interactive group games",
    "accountability app",
    "youth group activities",
  ],
  openGraph: {
    title: "How Campfire Works — Group Engagement Reimagined",
    description:
      "Join a group, answer the question, and watch everyone's answers unlock at the same moment. A friendly walkthrough plus the full tour of what Campfire can do.",
    url: "https://curriculate.net/aboutcampfire",
    siteName: "Campfire",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "https://curriculate.net/images/og/og-campfire-live.png",
        width: 1200,
        height: 630,
        alt: "Campfire — Group Engagement App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "How Campfire Works — Group Engagement Reimagined",
    description:
      "Join a group, answer the question, and watch everyone's answers unlock together. Here's the flow — plus the full feature tour.",
    images: ["https://curriculate.net/images/og/og-campfire-live.png"],
  },
  alternates: {
    canonical: "https://curriculate.net/aboutcampfire",
  },
};

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-6">
      <div className="inline-flex items-center rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-slate-600">{desc}</p>
    </div>
  );
}

function Card({
  title,
  desc,
  bullets,
}: {
  title: string;
  desc: string;
  bullets?: string[];
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-slate-600">{desc}</p>
      {bullets?.length ? (
        <ul className="mt-4 grid gap-2 text-slate-700">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-orange-500">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Divider() {
  return (
    <div className="my-10 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
  );
}

function EngCard({
  icon,
  name,
  desc,
}: {
  icon: string;
  name: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="font-bold text-sm text-slate-900 mb-1">{name}</div>
      <div className="text-xs text-slate-500 leading-relaxed">{desc}</div>
    </div>
  );
}

function FlowStep({
  num,
  title,
  desc,
  you,
}: {
  num: string;
  title: string;
  desc: string;
  you?: string;
}) {
  return (
    <div className="flex gap-4 py-4">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-sm font-bold text-white">
        {num}
      </div>
      <div>
        <h3 className="font-bold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
        {you ? (
          <p className="mt-1 text-sm font-semibold text-orange-700">👉 {you}</p>
        ) : null}
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold text-slate-900">{q}</h3>
      <p className="mt-1 text-sm text-slate-600 leading-relaxed">{a}</p>
    </div>
  );
}

export default function AboutCampfirePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50">
      {/* HowTo schema — for the "flow" */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "How to use Campfire",
            description:
              "Join a group, start or answer an engagement, and reveal everyone's answers together once all members have responded.",
            step: [
              {
                "@type": "HowToStep",
                name: "Sign in",
                text: "Create an account or continue with Google. Your free trial starts automatically.",
              },
              {
                "@type": "HowToStep",
                name: "Create or join a group",
                text: "Start a new group and invite people, or tap an invite link / scan a QR code to join one.",
              },
              {
                "@type": "HowToStep",
                name: "Start an engagement",
                text: "Pick an activity type — a poll, a challenge, a check-in — and send it to the group.",
              },
              {
                "@type": "HowToStep",
                name: "Everyone responds",
                text: "Each person submits their answer. Results stay sealed until the last person is in.",
              },
              {
                "@type": "HowToStep",
                name: "The reveal",
                text: "When everyone has responded, the envelope opens and the whole group sees the results at the same moment.",
              },
            ],
          }),
        }}
      />
      {/* SoftwareApplication schema — for the product/features */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Campfire",
            applicationCategory: "SocialNetworkingApplication",
            operatingSystem: "iOS, Android, Web",
            description:
              "Campfire is a group engagement app with 12 activity types. Results stay sealed until everyone responds — turning every poll, challenge, and game into a shared reveal event.",
            url: "https://curriculate.net/aboutcampfire",
            offers: [
              {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                name: "Free Trial",
                description: "3-month free trial with full access",
              },
              {
                "@type": "Offer",
                price: "4.99",
                priceCurrency: "USD",
                name: "Premium",
                description:
                  "Monthly subscription — no ads, analytics, exclusive engagement types",
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: "4.99",
                  priceCurrency: "USD",
                  billingDuration: "P1M",
                },
              },
            ],
            featureList: [
              "Sealed results — nobody sees answers until everyone responds",
              "12 engagement types: polls, challenges, truth or dare, photo pose, share, accountability, games, trivia, anonymous judge, guess, surprise, advice",
              "Celebration Cards — private surprise cards for birthdays, anniversaries, Mother's/Father's Day",
              "Guest signing — sign a single card with just your name, no account",
              "Edit your response any time before the reveal",
              "Voice responses",
              "Blind/anonymous mode",
              "Group streaks and health scores",
              "Recurring engagements — daily, weekly, monthly, yearly, and floating holidays",
              "Template packs: Icebreaker, Classroom, Family Night, Bible Study, Group Care (pastoral check-ins, prayer requests)",
              "Themed seasons: Summer, Advent, March Madness, Spooky Season",
              "Real-time nudges and presence",
              "Export to social media with Campfire branding",
              "Spectator mode for observers",
              "Engagement chains — winners post next",
            ],
          }),
        }}
      />
      {/* FAQ schema — for FAQ rich results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Do I need an account to use Campfire?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes, a quick one — so the app knows who's responded and can keep the envelope sealed until everyone's in. Continuing with Google is the fastest way.",
                },
              },
              {
                "@type": "Question",
                name: "Is Campfire free?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "You start with a free trial that gives you full access. After that there's an optional premium plan, but everything you need to join in and play is available from day one.",
                },
              },
              {
                "@type": "Question",
                name: "Can people see my answer before I'm ready?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Your response stays sealed — even from the person who started the engagement — until the last group member has responded.",
                },
              },
              {
                "@type": "Question",
                name: "Can I answer honestly but privately?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Many engagements can be set to blind mode, where answers reveal without showing whose is whose. Great for honest check-ins and unbiased judging.",
                },
              },
              {
                "@type": "Question",
                name: "What happens if someone doesn't respond?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "The engagement waits on them, and anyone can send a gentle nudge. Some engagements have a deadline, so the reveal still happens on time.",
                },
              },
              {
                "@type": "Question",
                name: "How do I join the group my teacher set up?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Just tap the invite link they shared or scan the QR code on the screen. It drops you straight into the right group — no code to type.",
                },
              },
            ],
          }),
        }}
      />

      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <div className="max-w-3xl">
          <div className="flex flex-wrap gap-2 mb-4">
            <Pill>Campfire</Pill>
            <Pill>A 2-minute intro</Pill>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
            New here?{" "}
            <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
              Here&apos;s how Campfire works.
            </span>
          </h1>

          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Campfire is a place where your group — your class, your friends, your
            family — actually does things together. Someone posts a question,
            challenge, or game. Everyone answers. And here&apos;s the twist:{" "}
            <strong className="text-slate-800">
              nobody sees a single answer until everyone has responded.
            </strong>{" "}
            Then it all opens at once.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/campfirelive"
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              Get started
            </Link>
            <Link
              href="/campfire"
              className="rounded-full border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              See a quick preview
            </Link>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Got an invite link or QR code from your teacher or group leader? Just
            tap or scan it — it brings you straight to the right group.
          </p>
        </div>

        {/* ── The big idea ── */}
        <div className="mt-10 rounded-3xl border-2 border-amber-200 bg-amber-50/60 p-7 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🔒</div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">
                The one thing that makes Campfire different
              </h2>
              <p className="mt-2 text-slate-700 leading-relaxed">
                On most apps, you see other people&apos;s answers as they come in —
                so it&apos;s easy to just follow the crowd. Campfire seals every
                response in an envelope.{" "}
                <strong className="text-amber-800">
                  You answer honestly, because you can&apos;t see anyone else yet.
                </strong>{" "}
                The moment the last person is in, the envelope opens and everyone
                sees the results together. That shared reveal is the fun part.
              </p>
              <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">No peeking</div>
                  <div className="text-slate-600">
                    Answers stay hidden until the last person responds
                  </div>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">Answer honestly</div>
                  <div className="text-slate-600">
                    No bandwagon voting — your answer is your own
                  </div>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">Reveal together</div>
                  <div className="text-slate-600">
                    Everyone sees the results at the exact same moment
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6">
        {/* ── The flow ── */}
        <SectionHeader
          eyebrow="The Flow"
          title="What actually happens, step by step"
          desc="From opening the app to the big reveal — here's the whole loop. The orange line is what you do."
        />
        <div className="max-w-2xl">
          <FlowStep
            num="1"
            title="Sign in"
            desc="Create an account or continue with Google. It takes a few seconds, and your free trial starts right away."
            you="Tap “Get started,” then sign in."
          />
          <FlowStep
            num="2"
            title="Create or join a group"
            desc="A group is just the people you'll play with — a class, a club, a family. Start your own and invite people, or join one that already exists."
            you="Joining? Tap the invite link or scan the QR code you were given. You'll land right in the group."
          />
          <FlowStep
            num="3"
            title="An engagement gets posted"
            desc="An engagement is one activity — a poll, a photo challenge, a quick check-in, a trivia question. Anyone in the group can start one and choose how it works (deadline, anonymous or not, how it reveals)."
            you="Watch for it, or start your own once you're comfortable."
          />
          <FlowStep
            num="4"
            title="Everyone responds — sealed"
            desc="Each person submits their answer privately. You won't see anyone else's yet, and they won't see yours. A little tracker shows how many people are still to go, and you can nudge the stragglers."
            you="Answer the question. Then wait for the rest of the group."
          />
          <FlowStep
            num="5"
            title="The big reveal"
            desc="The moment the last person responds, the envelope breaks and everyone's answers appear at once — for the whole group, at the same time. React with emojis, leave comments, rate entries, or crown a winner."
            you="Enjoy the reveal — this is the payoff."
          />
          <FlowStep
            num="6"
            title="Keep it going"
            desc="Groups build streaks the more they play, and a group health score shows how active you are. The next engagement is usually just a tap away — sometimes the winner gets to post it."
            you="Come back for the next one and keep your streak alive."
          />
        </div>

        <Divider />

        {/* ── Quickstart (classroom / demo) ── */}
        <SectionHeader
          eyebrow="Quickstart"
          title="Joining a group in under a minute"
          desc="The fastest path — perfect if your teacher or group leader just shared a link or put a QR code on the screen."
        />
        <div className="rounded-3xl border border-orange-200 bg-white p-6 shadow-sm">
          <ol className="grid gap-4 sm:grid-cols-2">
            {[
              ["Tap the link or scan the QR code", "It opens Campfire on the exact group you're joining."],
              ["Continue with Google", "One tap, no password to remember. Your trial starts automatically."],
              ["You're in the group", "You'll see the group and any engagement that's waiting for you."],
              ["Answer the question", "Submit your response — remember, nobody can see it yet."],
              ["Wait for the reveal", "Once everyone's answered, all the results open at the same moment."],
              ["React and join the next one", "Drop a reaction or comment, then keep the streak going."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">
                  {i + 1}
                </span>
                <div>
                  <div className="font-semibold text-slate-900">{t}</div>
                  <div className="text-sm text-slate-600">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <Divider />

        {/* ── Why Campfire (the problem it solves) ── */}
        <SectionHeader
          eyebrow="Why Campfire Exists"
          title="Group chats killed the group experience"
          desc="Social media became passive and performative. Group chats became noise. Nobody built a structured group activity layer — until now."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Card
            title="📱 Social Media = Spectating"
            desc="Feeds are algorithmically driven, not relationship-driven. Connection has been replaced by consumption."
            bullets={[
              "Passive scrolling over genuine interaction",
              "No structured activities",
              "Optimized for engagement, not relationships",
            ]}
          />
          <Card
            title="👥 Group Chats = Noise"
            desc="Unstructured text streams with no shared activities, no surprises, no accountability."
            bullets={[
              "Messages disappear into the void",
              "No challenges, games, or surprises",
              "No way to keep special moments",
            ]}
          />
          <Card
            title="🔥 Campfire = Structure + Suspense"
            desc="Gives groups a reason to engage — and a reason to wait. Results stay sealed until every member responds."
            bullets={[
              "12 engagement types from polls to games",
              "Sealed results — nobody sees anything until everyone is in",
              "The reveal is the event, not just the answer",
              "Deadline-driven participation with nudges",
            ]}
          />
        </div>

        <Divider />

        {/* ── Engagement Types ── */}
        <SectionHeader
          eyebrow="Engagement Types"
          title="12 ways to bring your group to life"
          desc="From lighthearted games to meaningful accountability, Campfire offers a rich toolkit for group interaction. Every one uses the same sealed-reveal magic."
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          <EngCard icon="📊" name="Poll" desc="Multiple choice, yes/no, or open questions. Shareable via QR code." />
          <EngCard icon="🏆" name="Challenge" desc="Video, photo, or task-based challenges with deadlines and ratings." />
          <EngCard icon="🎯" name="Truth or Dare" desc="Classic game with the option to put real money on the line." />
          <EngCard icon="📸" name="Photo Pose" desc="Request a picture in a specific scenario." />
          <EngCard icon="💬" name="Share" desc="Request a favourite recipe, memory, or anything meaningful." />
          <EngCard icon="🙏" name="Accountability" desc="Structured check-in questions. Blind or open. Built for distance." />
          <EngCard icon="♟️" name="Game" desc="Turn-based games: chess, word games, spelling bees." />
          <EngCard icon="🧠" name="Instant" desc="Trivia, math facts, Pictionary — quick-fire fun." />
          <EngCard icon="⚖️" name="Anonymous Judge" desc="Submit entries anonymously. Group rates blind." />
          <EngCard icon="🔍" name="Guess" desc="Post a mystery photo for the group to guess." />
          <EngCard icon="🎉" name="Surprise" desc="Coordinate greetings or video mash-ups, hidden from the recipient." />
          <EngCard icon="🎂" name="Celebration Card" desc="A surprise card everyone signs — birthday, anniversary, Mother's/Father's Day. Each wish stays private to the recipient; it opens on the special day and recurs yearly." />
          <EngCard icon="💡" name="Advice" desc="Ask your group or filtered random users for counsel." />
          <EngCard icon="🎤" name="Voice Response" desc="Leave voice notes instead of text. Lower friction, higher personality." />
        </div>

        <Divider />

        {/* ── Template Packs ── */}
        <SectionHeader
          eyebrow="Pre-built Packs"
          title="Engagement templates to get started instantly"
          desc="Browse curated template packs tailored to your group's interests and gatherings."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <EngCard
            icon="🧊"
            name="Icebreaker Pack"
            desc="Quick two-truths, would-you-rather, and speed questions to warm up new groups."
          />
          <EngCard
            icon="📖"
            name="Bible Study Pack"
            desc="Reflection prompts, verse discussion, and faith-based accountability check-ins."
          />
          <EngCard
            icon="🤝"
            name="Group Care Pack"
            desc="Pastoral & small-group care: a weekly wellbeing check-in, prayer/support requests, praise reports, and a quick wellness pulse — built for groups up to 30+."
          />
          <EngCard
            icon="🎮"
            name="Family Game Night Pack"
            desc="Trivia, word games, photo challenges, and team-based competitions."
          />
          <EngCard
            icon="🎉"
            name="Party Games Pack"
            desc="Dare challenges, truth or dare, Pictionary, and group guessing games."
          />
          <EngCard
            icon="👥"
            name="Youth Group Pack"
            desc="Scavenger hunts, video challenges, group accountability, and milestone celebrations."
          />
          <EngCard
            icon="💑"
            name="Couples Pack"
            desc="Relationship questions, date night ideas, anniversary countdowns, and memory shares."
          />
        </div>

        <Divider />

        {/* ── Response Mechanics ── */}
        <SectionHeader
          eyebrow="Smart Mechanics"
          title="The person who starts the engagement controls how it plays out"
          desc="Deadlines, blind mode, reveal mechanics, ratings, and recurrence — all configurable per engagement, all live today."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="🔒 Sealed Results"
            desc="The core mechanic. Nobody sees poll results, challenge entries, or accountability answers until every member has responded — then the reveal happens together, automatically."
            bullets={[
              "Builds anticipation and honest responses",
              "Eliminates bandwagon voting and bias",
              "Turns every engagement into a shared event",
            ]}
          />
          <Card
            title="🎬 Four Reveal Modes"
            desc="Sealed (wait for everyone), all-at-once (you trigger the reveal), or as-they-come / instant (responses show live as they land)."
          />
          <Card
            title="⭐ Ratings & Winner"
            desc="After the reveal, members rate each other's entries 1–5 stars. The highest average is crowned the winner — who gets a prompt to start the next one."
          />
          <Card
            title="⏱️ Deadlines, Enforced"
            desc="Set a response window. Reminders go out automatically as it nears, and the reveal auto-fires after the deadline so one straggler can't freeze it."
          />
          <Card
            title="🙈 Blind Responses"
            desc="Hide identities so no one knows whose response is whose. Perfect for honest accountability and unbiased judging."
          />
          <Card
            title="👋 Real Nudges"
            desc="One tap emails everyone who hasn't responded yet; the system also nudges automatically as a deadline approaches."
          />
          <Card
            title="🔄 Recurring Engagements"
            desc="Repeat daily, weekly, monthly, or yearly — including floating holidays like Mother's Day (2nd Sunday of May). A fresh copy auto-posts each cycle; yearly cards re-open a couple of weeks before the date."
          />
          <Card
            title="🎂 Celebration Cards"
            desc="A surprise card everyone signs for someone — birthday, anniversary, Mother's/Father's Day. Each wish is private to the recipient (even after it opens), it reveals on the special day, and it comes back every year on its own."
            bullets={[
              "Hidden from the recipient until the big day",
              "Every wish private to them — the rest of the group never sees it",
              "On open, everyone learns it was delivered + how many wishes",
            ]}
          />
          <Card
            title="✉️ Guest Signing"
            desc="Invite anyone to sign one card with just their name — no account, no app, and they never join your group. A host can later promote a guest to a full member."
          />
          <Card
            title="✏️ Edit Before Reveal"
            desc="Changed your mind? Edit your answer any time before the reveal — your response re-opens pre-filled."
          />
          <Card
            title="📤 Share Card"
            desc="Export a clean results image — poll bars or the crowned winner — to drop on a class screen or share on socials."
          />
          <Card
            title="💬 Reactions & Comments"
            desc="After the reveal, react with emojis and leave comments on individual responses for deeper interaction."
          />
          <Card
            title="🛡️ Moderation & Safety"
            desc="Hosts can remove a response, any member can report one, and a profanity filter keeps things kind — built with classrooms in mind."
          />
          <Card
            title="📊 Host Analytics"
            desc="Admins see participation rates, invite conversion, and a live streak leaderboard at a glance."
          />
          <Card
            title="🏅 Badges"
            desc="Members earn badges — On a roll, Streak leader, Recruiter, 100% crew — for showing up and keeping the group going."
          />
        </div>

        <Divider />

        {/* ── Streaks & Group Health ── */}
        <SectionHeader
          eyebrow="Group Engagement"
          title="Streaks & group health at a glance"
          desc="Track participation, build momentum, and celebrate collective milestones."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="🔥 Streak Counters"
            desc="Individual and group participation streaks. Keep the chain alive and unlock streak badges."
          />
          <Card
            title="📊 Participation Dashboard"
            desc="Real-time view of who's responded, who's still pending, and overall group engagement metrics."
          />
          <Card
            title="💪 Group Health Score"
            desc="A single score reflecting participation rates, response quality, and consistency. Trending up or down."
          />
          <Card
            title="🎖️ Group Milestones"
            desc="Celebratory milestones at 10, 25, 50, and 100 engagements. Shareable graphics for each achievement."
          />
        </div>

        <Divider />

        {/* ── Themed Seasons ── */}
        <SectionHeader
          eyebrow="Seasonal Engagement"
          title="Themed seasons to keep things fresh"
          desc="Time-limited engagement themes tailored to seasons, holidays, and group moments."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <EngCard
            icon="☀️"
            name="Summer Challenge Series"
            desc="Weekly outdoor challenges, travel stories, and summer bucket list countdown."
          />
          <EngCard
            icon="🕯️"
            name="Advent Calendar"
            desc="Daily devotions, gratitude shares, and surprise gift reveals for the season."
          />
          <EngCard
            icon="🏀"
            name="March Madness Bracket"
            desc="Collaborative bracket competitions, pick-the-winner games, and playoff predictions."
          />
          <EngCard
            icon="🎃"
            name="Spooky Season Pack"
            desc="Halloween costume votes, scary story challenges, and haunted house recommendations."
          />
          <EngCard
            icon="🌱"
            name="New Year Resolution Check-ins"
            desc="Weekly accountability on goals, progress shares, and celebration of wins."
          />
          <EngCard
            icon="💝"
            name="Love & Gratitude Series"
            desc="Appreciation shares, compliment exchanges, and love-letter submissions."
          />
        </div>

        <Divider />

        {/* ── Good to Know (FAQ) ── */}
        <SectionHeader
          eyebrow="Good to Know"
          title="Quick answers before you jump in"
          desc="The things first-timers usually wonder about."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Faq
            q="Do I need an account?"
            a="Yes, a quick one — so the app knows who's responded and can keep the envelope sealed until everyone's in. Continuing with Google is the fastest way."
          />
          <Faq
            q="Is it free?"
            a="You start with a free trial that gives you full access. After that there's an optional premium plan, but everything you need to join in and play is available from day one."
          />
          <Faq
            q="Can people see my answer before I'm ready?"
            a="No. That's the whole point. Your response stays sealed — even from the person who started the engagement — until the last group member has responded."
          />
          <Faq
            q="What if I want to answer honestly but privately?"
            a="Many engagements can be set to blind mode, where answers reveal without showing whose is whose. Great for honest check-ins and unbiased judging."
          />
          <Faq
            q="What happens if someone doesn't respond?"
            a="The engagement waits on them, and anyone can send a gentle nudge. Some engagements have a deadline, so the reveal still happens on time."
          />
          <Faq
            q="How do I join the group my teacher set up?"
            a="Just tap the invite link they shared or scan the QR code on the screen. It drops you straight into the right group — no code to type."
          />
        </div>

        <Divider />

        {/* ── Competitive Landscape ── */}
        <SectionHeader
          eyebrow="Differentiation"
          title="What makes Campfire different"
          desc="No other app combines structured group activities with this flexibility."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left p-3 font-semibold border-b-2 border-slate-200">
                  Feature
                </th>
                <th className="text-left p-3 font-semibold border-b-2 border-slate-200 text-orange-600">
                  Campfire
                </th>
                <th className="text-left p-3 font-semibold border-b-2 border-slate-200 text-slate-500">
                  WhatsApp / iMessage
                </th>
                <th className="text-left p-3 font-semibold border-b-2 border-slate-200 text-slate-500">
                  Instagram / TikTok
                </th>
                <th className="text-left p-3 font-semibold border-b-2 border-slate-200 text-slate-500">
                  Discord
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {[
                ["Results sealed until all respond", "Yes", "-", "-", "-"],
                ["Structured group engagements", "Yes", "-", "-", "-"],
                ["Polls with QR code access", "Yes", "-", "-", "Basic"],
                ["Accountability check-ins", "Yes", "-", "-", "-"],
                ["Blind / anonymous responses", "Yes", "-", "-", "-"],
                ["Photo / video challenges", "Yes", "-", "Partial", "-"],
                ["Turn-based games", "Yes", "-", "-", "Bots"],
                ["Video greeting mash-ups", "Yes", "-", "-", "-"],
                ["Deadline-enforced responses", "Yes", "-", "-", "-"],
                ["Random guest opt-in", "Yes", "-", "-", "-"],
                ["Favourites tab for replaying greetings", "Yes", "-", "-", "-"],
                ["Recurring / scheduled engagements", "Yes", "-", "-", "-"],
                ["Template packs", "Yes", "-", "-", "-"],
                ["Reactions on responses", "Yes", "-", "Partial", "Partial"],
                ["Streak tracking", "Yes", "-", "-", "-"],
                ["Export to social media", "Yes", "-", "-", "-"],
                ["Voice note responses", "Yes", "Yes", "-", "Yes"],
              ].map(([feat, ...vals]) => (
                <tr key={feat} className="hover:bg-slate-50/50">
                  <td className="p-3 border-b border-slate-100">{feat}</td>
                  {vals.map((v, i) => (
                    <td
                      key={i}
                      className={`p-3 border-b border-slate-100 font-semibold ${
                        i === 0
                          ? v === "Yes"
                            ? "text-orange-500"
                            : "text-slate-400"
                          : "text-slate-400"
                      }`}
                    >
                      {v === "Yes" ? "✓ Yes" : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Divider />

        {/* ── Revenue ── */}
        <div id="investor">
          <SectionHeader
            eyebrow="Revenue Model"
            title="Free to use with a clear path to premium"
            desc="Campfire is free with ads, with premium and enterprise tiers."
          />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 mb-3">
                Free Tier
              </span>
              <h3 className="text-lg font-bold text-slate-900">Ad-Supported</h3>
              <p className="mt-2 text-slate-600">
                All core engagement types free. Revenue through non-intrusive ads.
                Groups of any size, unlimited engagements.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex items-center rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 mb-3">
                Premium
              </span>
              <h3 className="text-lg font-bold text-slate-900">Power Features</h3>
              <p className="mt-2 text-slate-600">
                Remove ads, expanded random guest pools, exclusive engagement types,
                priority support, and group analytics.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
                Enterprise
              </span>
              <h3 className="text-lg font-bold text-slate-900">Organizations</h3>
              <p className="mt-2 text-slate-600">
                White-label for churches, schools, and organizations. Bulk group
                management, admin dashboards, and custom branding.
              </p>
            </div>
          </div>
        </div>

        <Divider />

        {/* ── Platform ── */}
        <SectionHeader
          eyebrow="Platform"
          title="Works everywhere — install it like an app"
          desc="A fast web app you can add to your home screen, with friction-free joining and privacy-first design."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Card
            title="📲 Installable (PWA)"
            desc="Add Campfire to your home screen on iOS or Android — app icon, full-screen, offline-aware — with no app store download."
          />
          <Card
            title="🔗 One-Tap Joining"
            desc="Join a group from a link, and sign in with Google or just your name — no account or email required for students."
          />
          <Card
            title="✉️ Email Invites"
            desc="Invite a whole class by email; track who's joined, add more, and nudge anyone who hasn't — or copy a ready-made invite to paste anywhere."
          />
        </div>

        <Divider />

        {/* ── Recap ── */}
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-extrabold text-slate-900">
            The whole thing in one sentence
          </h2>
          <p className="mt-3 text-lg text-slate-700 leading-relaxed">
            Join a group → answer the question →{" "}
            <strong className="text-orange-600">
              everyone&apos;s answers unlock together
            </strong>{" "}
            the moment the last person responds. That&apos;s Campfire.
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mt-12">
        <div className="bg-gradient-to-r from-orange-500 to-rose-500 py-16 px-6 text-center text-white">
          <h2 className="text-3xl font-extrabold mb-3">Ready to jump in?</h2>
          <p className="text-white/90 max-w-lg mx-auto mb-6">
            Sign in, join your group, and answer your first question. The reveal is
            waiting on the other side.
          </p>
          <Link
            href="/campfirelive"
            className="inline-block rounded-full bg-white px-8 py-3 text-sm font-bold text-orange-600 shadow-md hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Campfire. All rights reserved.
      </footer>
    </main>
  );
}
