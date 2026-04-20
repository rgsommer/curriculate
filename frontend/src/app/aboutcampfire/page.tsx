import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Campfire — Group Engagement Reimagined",
  description:
    "Campfire is a group engagement app with sealed results — nobody sees answers until everyone responds. 12 activity types including polls, challenges, games, and accountability for families, friends, churches, and communities.",
  keywords: [
    "campfire app",
    "group engagement app",
    "sealed polls",
    "group challenges",
    "family group app",
    "church group activities",
    "community engagement platform",
    "group activities app",
    "interactive group games",
    "social engagement",
    "accountability app",
    "group poll app",
    "team building app",
    "friend group app",
    "youth group activities",
  ],
  openGraph: {
    title: "Campfire — Group Engagement Reimagined",
    description:
      "The group app where results stay sealed until everyone responds. Polls, challenges, games, accountability — for families, friends, and communities.",
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
    title: "Campfire — Group Engagement Reimagined",
    description:
      "Sealed polls, group challenges, accountability check-ins, and 12 activity types. The app that brings your group to life.",
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

export default function AboutCampfirePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50">
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
              "Voice responses",
              "Blind/anonymous mode",
              "Group streaks and health scores",
              "Recurring scheduled engagements",
              "Template packs: Icebreaker, Bible Study, Family Game Night, Party, Youth Group, Couples",
              "Themed seasons: Summer, Advent, March Madness, Spooky Season",
              "Real-time nudges and presence",
              "Export to social media with Campfire branding",
              "Spectator mode for observers",
              "Engagement chains — winners post next",
            ],
          }),
        }}
      />
      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <div className="max-w-3xl">
          <div className="flex flex-wrap gap-2 mb-4">
            <Pill>Campfire</Pill>
            <Pill>Group Engagement App</Pill>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Social media lost something.{" "}
            <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
              Campfire brings it back.
            </span>
          </h1>

          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Campfire is a social engagement app designed to replicate the richness of
            communal life — the challenges, the surprises, the accountability, the
            fun — that other platforms have left behind. Built for families, friends,
            churches, and any group that wants more than a text thread.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/campfire"
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              Try the Prototype
            </Link>
          </div>
        </div>

        {/* ── Sealed Results Callout ── */}
        <div className="mt-10 rounded-3xl border-2 border-amber-200 bg-amber-50/60 p-7 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🔒</div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">
                The sealed envelope mechanic
              </h2>
              <p className="mt-2 text-slate-700 leading-relaxed">
                This is what makes Campfire different from every other poll, challenge,
                or group activity app.{" "}
                <strong className="text-amber-800">
                  Nobody sees results until everyone has responded.
                </strong>{" "}
                Poll results stay hidden. Challenge entries stay locked. Accountability
                answers stay sealed. The moment everyone is in, the envelope opens — and
                the collective reveal becomes the highlight. It turns every engagement
                into an event.
              </p>
              <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">No peeking</div>
                  <div className="text-slate-600">Results sealed until the last person responds</div>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">Nudge stragglers</div>
                  <div className="text-slate-600">Gentle reminders keep momentum and build anticipation</div>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-3">
                  <div className="font-bold text-amber-900">Collective reveal</div>
                  <div className="text-slate-600">Everyone sees results at the same moment — together</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6">
        {/* ── Problem ── */}
        <SectionHeader
          eyebrow="The Problem"
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
          desc="From lighthearted games to meaningful accountability, Campfire offers a rich toolkit for group interaction."
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

        {/* ── How It Works ── */}
        <SectionHeader
          eyebrow="How It Works"
          title="From sign-up to celebration in 5 steps"
          desc="Getting started takes less than a minute."
        />
        <div className="max-w-xl mx-auto">
          {[
            {
              num: "1",
              title: "Sign up free",
              desc: "Create your profile. Optionally, indicate if you'd be available as a random guest in other groups.",
            },
            {
              num: "2",
              title: "Create or join a group",
              desc: "Invite 2+ people. New members can join via QR code or a shared link.",
            },
            {
              num: "3",
              title: "Start an engagement",
              desc: "Choose from 12 types. Set deadline, blind mode, ratings, reveal mode, and more.",
            },
            {
              num: "4",
              title: "Respond — results stay sealed",
              desc: "Everyone submits their vote, entry, or answer. Results are locked behind a sealed envelope until the last person responds. Nudge stragglers to keep momentum.",
            },
            {
              num: "5",
              title: "The big reveal",
              desc: "When everyone is in, the seal breaks. Results appear for the whole group at once — react, comment, rate, and crown a winner. Save favourites to replay.",
            },
          ].map((step) => (
            <div key={step.num} className="flex gap-4 py-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-sm font-bold text-white">
                {step.num}
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{step.title}</h3>
                <p className="text-sm text-slate-600">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Divider />

        {/* ── Response Mechanics ── */}
        <SectionHeader
          eyebrow="Smart Mechanics"
          title="The person who starts the engagement controls how it plays out"
          desc="Deadlines, blind mode, reveal mechanics, ratings, and rewards — all configurable per engagement."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="🔒 Sealed Results"
            desc="The core mechanic. Nobody sees poll results, challenge entries, or accountability answers until every member has responded. The reveal happens together."
            bullets={[
              "Builds anticipation and honest responses",
              "Eliminates bandwagon voting and bias",
              "Turns every engagement into a shared event",
            ]}
          />
          <Card
            title="⏱️ Deadlines"
            desc="Set a response window. If someone doesn't respond, they're temporarily locked out until they do."
          />
          <Card
            title="🙈 Blind Responses"
            desc="Hide identities so no one knows whose response is whose. Perfect for honest accountability and unbiased judging."
          />
          <Card
            title="🎬 Four Reveal Modes"
            desc="All at once, first in, as they come, or instant (on your mark, get set, go)."
          />
          <Card
            title="🏅 Ratings and Rewards"
            desc="Enable ratings. The winner can post the next engagement or claim a real reward."
          />
          <Card
            title="👋 Nudges"
            desc="Gently remind slow responders to keep momentum going."
          />
          <Card
            title="🎲 Random Guests"
            desc="Add random users who opt in during sign-up. Adult content preferences respected."
          />
          <Card
            title="🔄 Recurring Engagements"
            desc="Schedule weekly accountability check-ins, monthly challenges, or daily trivia to auto-post on a cycle."
          />
          <Card
            title="💬 Reactions & Commentary"
            desc="After the reveal, react with emojis and leave comments on individual responses for deeper interaction."
          />
          <Card
            title="📤 Export & Share"
            desc="Export video mash-ups, photo collages, and poll results to share on social media with Campfire branding."
          />
          <Card
            title="👁️ Spectator Mode"
            desc="Let some members watch without participating. Perfect for large communities or observer roles."
          />
          <Card
            title="🔗 Engagement Chains"
            desc="Winners automatically get the right to post the next engagement, creating self-sustaining activity."
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
          title="Built for mobile-first engagement"
          desc="Native apps on iOS and Android, with QR-code onboarding and privacy-first design."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Card
            title="📱 iOS and Android"
            desc="Native apps on both major stores, optimized for camera-first, notification-driven interactions."
          />
          <Card
            title="🔗 QR and Link Onboarding"
            desc="Join a specific engagement by scanning a QR code or clicking a join link — minimal sign-up friction."
          />
          <Card
            title="🔒 Privacy-First"
            desc="Blind responses, opt-in random guests, and adult content controls put users in charge."
          />
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mt-12">
        <div className="bg-gradient-to-r from-orange-500 to-rose-500 py-16 px-6 text-center text-white">
          <h2 className="text-3xl font-extrabold mb-3">
            Ready to bring your group to life?
          </h2>
          <p className="text-white/90 max-w-lg mx-auto mb-6">
            Campfire is currently in development. Try the interactive prototype or
            get in touch to discuss investment and partnership opportunities.
          </p>
          <Link
            href="/campfire"
            className="inline-block rounded-full bg-white px-8 py-3 text-sm font-bold text-orange-600 shadow-md hover:opacity-90"
          >
            Try the Prototype
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