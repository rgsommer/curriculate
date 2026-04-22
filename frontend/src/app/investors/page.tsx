// src/app/investors/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

export const metadata: Metadata = {
  title: "Investors",
  description:
    "Curriculate is AI lesson orchestration for real classrooms — time-aware planning, intentional movement, and classroom scavenger hunt delivery.",
};

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
              <span className="text-green-600">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
      <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-slate-600">{desc}</p>
    </div>
  );
}

function Divider() {
  return (
    <div className="my-10 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
  );
}

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <Pill>Investor Overview</Pill>
              <Pill>Private URL</Pill>
              <Pill>Curriculate</Pill>
            </div>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">
              Curriculate is AI lesson orchestration for real classrooms
            </h1>

            <p className="mt-4 text-lg text-slate-600">
              Most "AI in education" products generate content. Curriculate plans an
              experience first — selecting grade-appropriate task formats, fitting the
              lesson time you specify, spacing movement breaks intentionally, and only
              generating formats the student app can run — then it generates the tasks
              to match that plan.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Try the demo
              </Link>
              <Link
                href="/features"
                className="rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                See features
              </Link>
              <Link
                href="/how-it-works"
                className="rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                How it works
              </Link>
            </div>
          </div>

          {/* TL;DR */}
          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
                  TL;DR
                </div>
                <h2 className="mt-3 text-2xl font-bold text-slate-900">
                  "Not AI worksheets — AI pacing + scavenger hunts + task variety"
                </h2>
                <p className="mt-2 text-slate-600">
                  Curriculate turns teacher intent (topic, vocab, grade, goal, and time)
                  into a ready-to-run classroom scavenger hunt. The planning layer is the moat:
                  time-aware task counts, intentional movement spacing, and only supported
                  UI task formats.
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-900">
                  What's defensible here
                </div>
                <ul className="mt-3 grid gap-2 text-slate-700">
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>
                      Orchestration: AI plans the set, then generates to match the plan
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Time-fit generation using expected task durations</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Movement is intentional, capped, and never back-to-back</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Only implemented, UI-supported task types can be generated</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <Divider />

          {/* Problem / Solution */}
          <div>
            <SectionHeader
              eyebrow="Problem"
              title="Teachers don't need more content — they need better classroom flow"
              desc="Most classrooms fail on pacing and engagement: too much dead time, rushed endings, and activities that don't translate into engaging scavenger hunt routines. Generic AI tools produce content, but not a coherent experience."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Card
                title="What breaks in real classrooms"
                desc="A lesson is a system: timing, transitions, movement, group dynamics, and fatigue."
                bullets={[
                  "Activity timing is unpredictable",
                  "Too many similar tasks in a row",
                  "Movement is either missing or chaotic",
                  "Formats don't match delivery (stations/QR/displays)",
                  "Teachers spend time reworking AI output",
                ]}
              />
              <Card
                title="Curriculate's solution"
                desc="Plan first, generate second — with hard guardrails."
                bullets={[
                  "Time-aware planning creates realistic task counts",
                  "Task variety by learning intent (retrieval, reasoning, collaboration, creativity)",
                  "Movement inserted intentionally and limited",
                  "Only supported task types are eligible",
                  "Scavenger-hunt-ready delivery for repeatable routines",
                ]}
              />
            </div>
          </div>

          <Divider />

          {/* Product */}
          <div>
            <SectionHeader
              eyebrow="Product"
              title="A classroom scavenger hunt engine"
              desc="Curriculate is designed for teachers who want a repeatable, low-prep scavenger hunt routine that students understand quickly."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Card
                title="⏱️ Time-aware task sets"
                desc="Set a lesson length (e.g., 45 minutes). Curriculate uses expected completion time per task type to size and compose the set."
                bullets={[
                  "Teacher selects time; system chooses task count",
                  "Mix of short + deeper tasks to match goals",
                  "Less dead time; fewer rushed endings",
                ]}
              />
              <Card
                title="🏃 Movement, done right"
                desc="Movement tasks are planned as instructional design — not a gimmick."
                bullets={[
                  "At least one movement break when appropriate",
                  "Capped to a small fraction of tasks",
                  "Never back-to-back movement tasks",
                ]}
              />
              <Card
                title="📍 Scavenger hunt + QR-friendly delivery"
                desc="Designed for classroom scavenger hunts and student scanning routines."
                bullets={[
                  "Scavenger-hunt-ready task formats",
                  "QR station placement across the room or building",
                  "Multi-room hunts (hallway/library/gym)",
                ]}
              />
              <Card
                title="🧠 Task variety by learning intent"
                desc="Rather than a giant static list, task types are grouped and selected to match how students learn."
                bullets={[
                  "Retrieval & review",
                  "Reasoning & thinking",
                  "Creativity & expression",
                  "Collaboration & communication",
                  "Movement & physical tasks",
                ]}
              />
            </div>
          </div>

          <Divider />

          {/* Why different */}
          <div>
            <SectionHeader
              eyebrow="Differentiation"
              title="Why Curriculate is different from AI worksheets"
              desc="Worksheets generate content. Curriculate generates a classroom scavenger hunt — with pacing, movement, and task variety designed for real students."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl bg-slate-50 p-6">
                <div className="text-lg font-bold text-slate-900">
                  AI worksheets / generic generators
                </div>
                <ul className="mt-4 grid gap-2 text-slate-700">
                  {[
                    "Outputs content, but doesn't plan an experience",
                    "Task count is guesswork",
                    "Timing often breaks in real classrooms",
                    "Movement is random (or missing)",
                    "Formats may not match your delivery system",
                    "Teachers still rewrite and reformat",
                  ].map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="text-slate-400">•</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl bg-blue-50 p-6">
                <div className="text-lg font-bold text-slate-900">Curriculate</div>
                <ul className="mt-4 grid gap-2 text-slate-700">
                  {[
                    "Plans the learning flow first, then generates to match",
                    "Uses task durations to fit the lesson window",
                    "Pacing designed for scavenger hunt flow",
                    "Movement inserted intentionally, capped, and spaced",
                    "Only generates formats the student app supports",
                    "Guardrails + slot-regeneration for reliable structure",
                  ].map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="text-green-600">✓</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <Divider />

          {/* Market / wedge / expansion */}
          <div>
            <SectionHeader
              eyebrow="Go-to-market"
              title="Wedge: classroom scavenger hunts + time-fit planning"
              desc="Curriculate wins where teachers feel pain the most: engagement days, review days, mixed-ability classes, and low-prep scavenger hunt routines."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Card
                title="Initial buyer"
                desc="Individual teachers and small schools looking for a reliable scavenger hunt routine with low prep."
                bullets={[
                  "Middle school and upper elementary are strong fits",
                  "Review + introduction workflows",
                  "Works with existing classroom devices",
                ]}
              />
              <Card
                title="Expansion path"
                desc="Once habitual, expansion follows naturally into analytics, standards alignment, and admin reporting."
                bullets={[
                  "Department-wide adoption",
                  "School-wide license",
                  "District pilots (with reporting/SSO later)",
                ]}
              />
            </div>
          </div>

          <Divider />

          {/* Vision / Roadmap */}
          <div>
            <SectionHeader
              eyebrow="Roadmap"
              title="From orchestration to measurable outcomes"
              desc="The near-term roadmap focuses on making the system even more repeatable for teachers and more legible for admins."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Card
                title="Near-term (product)"
                desc="Improve teacher confidence and repeatability."
                bullets={[
                  "Expose planning toggles (movement allowed, pacing tempo)",
                  "Better preview of planned time + task count before generate",
                  "Improved taskset templates and reuse workflows",
                ]}
              />
              <Card
                title="Medium-term (school/district)"
                desc="Make Curriculate easier to adopt at scale."
                bullets={[
                  "Admin dashboards + reporting",
                  "SSO / rostering integrations",
                  "Standards mapping and outcome tracking",
                ]}
              />
            </div>
          </div>

          <Divider />

          {/* Founder / credibility */}
          <div>
            <SectionHeader
              eyebrow="Founder"
              title="Built by a veteran educator for real classrooms"
              desc="Curriculate is built from the inside of the classroom — focused on what teachers can actually run."
            />
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-slate-600">
                Curriculate is designed and built by an experienced teacher and school
                administrator, with daily classroom iteration. The product emphasis is
                not "cool AI," but repeatable routines: pacing, scavenger hunts, and structured
                outputs that reduce teacher prep and increase student engagement.
              </p>
            </div>
          </div>

          <Divider />

          {/* Ask / contact placeholder */}
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">
              Interested in learning more?
            </h2>
            <p className="mt-2 max-w-3xl text-slate-600">
              This page is intentionally not linked in site navigation. Share the URL
              privately as needed. If you'd like, we can add a short "data room" section
              (traction, pricing, pipeline, unit economics) once you share what you want public.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Try the demo
              </Link>
              <Link
                href="/pricing"
                className="rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                View pricing
              </Link>
            </div>
          </div>

          <p className="text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Curriculate. This page is for informational purposes and may evolve as the product develops.
          </p>
        </div>
      </section>
    </main>
  );
}
