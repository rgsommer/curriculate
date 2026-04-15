import Link from "next/link";
import { SmartPlanningBlock } from "@/components/SmartPlanningBlock";

function FeatureCard({
  title,
  body,
  bullets,
}: {
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-slate-600">{body}</p>
      <ul className="mt-4 grid gap-2 text-slate-700">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-green-600">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="mb-6">
      <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-2 max-w-3xl text-slate-600">{desc}</p>
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-6">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm">
              Features
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">
              Curriculate is AI lesson planning — then AI task generation
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Most “AI classroom tools” generate activities. Curriculate plans the learning experience first:
              time-fit pacing, grade-appropriate task selection, intentional movement breaks, and station-ready delivery —
              then it generates tasks to match that plan.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/how-it-works"
                className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                See how it works
              </Link>
              <Link
                href="/pricing"
                className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                View pricing
              </Link>
            </div>
          </div>

          <SmartPlanningBlock />

          <div className="mt-10">
            <SectionHeader
              eyebrow="Planning & Pacing"
              title="Time-aware, student-aware task sets"
              desc="Pick a lesson length and learning goal. Teachers choose the time window; Curriculate chooses the task count and mix using expected task durations — without dead time or rushed endings."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="⏱️ Time-Aware Task Sets"
                body="Curriculate uses task definitions (expected completion time) to decide how many tasks to include and what mix fits."
                bullets={[
                  "Lesson-length planning (e.g., 20, 35, 45, 60 minutes)",
                  "Grade + goal + topic-aware task type planning",
                  "A mix of short + deep tasks, tuned to your goal",
                  "More consistent pacing across classes",
                ]}
              />
              <FeatureCard
                title="🏃 Movement, Done Right"
                body="Movement tasks are intentionally placed, capped to a small portion of the set, and never stacked back-to-back."
                bullets={[
                  "At least one movement break when appropriate",
                  "Capped percentage (teacher-adjustable)",
                  "Never back-to-back movement tasks",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Stations & Delivery"
              title="Built for station rotation, not worksheets"
              desc="Curriculate is designed for real classrooms: station cards, QR-coded stations, multi-room scavenger options, and repeatable routines."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="📍 Station-Ready by Design"
                body="Generate station-based sets that are ready to run with minimal prep."
                bullets={[
                  "Station-friendly task formats",
                  "Supports fixed-station display assignment",
                  "Designed for quick launch and smooth transitions",
                ]}
              />
              <FeatureCard
                title="🗺️ Multi-Room & Scavenger Options"
                body="Enable multi-room tasksets for hallway / library / gym / campus rotations."
                bullets={[
                  "Optional room list for scavenger-style runs",
                  "Works with station scanning routines",
                  "Great for review days and engagement boosts",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Worldview Alignment"
              title="Specify the lens for prompts and scoring"
              desc="Teachers can define a worldview lens and use it to shape how tasks are framed and how responses are evaluated — without outsourcing judgment. The teacher sets the criteria; the system helps apply it consistently."
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="🧭 Define a worldview lens"
                body="Set the values, virtues, assumptions, or guiding principles you want reflected in tasks and discussion."
                bullets={[
                  "Lens can be broad (values) or specific (a short statement)",
                  "Applies to prompts, reflection questions, and teacher guidance",
                  "Optional per-class / per-unit / per-task",
                ]}
              />
              <FeatureCard
                title="✅ Score against your criteria"
                body="Use your worldview criteria as part of the scoring rubric, so feedback and evaluation match your intent."
                bullets={[
                  "Rubric-driven scoring aligned to your stated lens",
                  "Transparent criteria (teachers can edit before use)",
                  "Consistent evaluation across teams and tasks",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Task Variety"
              title="Task types grouped by learning intent"
              desc="Rather than a static list, Curriculate selects task formats that match how students learn — and adapts the mix to your context."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="🎯 Retrieval & Review"
                body="Fast, confidence-building checks for key facts and terms."
                bullets={[
                  "Multiple choice and true/false formats",
                  "Flashcards and speed rounds",
                  "Quick feedback loops",
                ]}
              />
              <FeatureCard
                title="🧠 Reasoning & Thinking"
                body="Tasks that require sorting, sequencing, comparing, and explaining."
                bullets={[
                  "Sorting/categorizing and matching formats",
                  "Sequencing/timeline-style tasks",
                  "Explain-your-thinking prompts",
                ]}
              />
              <FeatureCard
                title=”🎨 Expression & Creativity”
                body=”Let students show understanding in more than one modality.”
                bullets={[
                  “Letter writing — write to a historical character, get an AI reply back”,
                  “Case study — solve a real-world scenario, get AI expert feedback”,
                  “Drawing/visual response and photo journal formats”,
                  “Narration/synthesis and vocabulary paragraph prompts”,
                ]}
              />
              <FeatureCard
                title="🤝 Collaboration & Communication"
                body="Structured discussion and team formats designed for real classrooms."
                bullets={[
                  "Intra-team and inter-team options",
                  "Debate/discussion structures",
                  "Peer explanation and reasoning",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Game Modes & Engagement"
              title="Keep energy high with built-in game elements"
              desc="Curriculate adds moments of fun, team bonding, and surprise to every session — without losing focus."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="🎁 Mystery Box Navigation"
                body="An alternative to linear task delivery: teams see shuffled gift boxes and choose their own path."
                bullets={[
                  "Self-directed task navigation with star-rated difficulty hints",
                  "Inter-team challenge beacons with bonus points",
                  "Pre-queuing so the next task is ready instantly",
                  "Global countdown timer for session pacing",
                ]}
              />
              <FeatureCard
                title="📸 Team Selfie & Themed Images"
                body="Sessions start with a fun team photo. On Plus, AI generates a themed version matching the subject."
                bullets={[
                  "Front-facing camera selfie before the game starts",
                  "AI-themed team card: history era, lab scene, movie poster, and more",
                  "Selfie included in session reports as team photo",
                  "Configurable in teacher profile (on by default)",
                ]}
              />
              <FeatureCard
                title="🤔 Riddle Breathers"
                body="AI-generated riddles related to the lesson topic — no scoring, just a fun mental reset."
                bullets={[
                  "Automatically injected mid-set via teacher profile toggle",
                  "Topic-relevant riddles with optional hints",
                  "Zero-point comic relief between heavier tasks",
                ]}
              />
              <FeatureCard
                title="🔍 Mystery Clue Cards"
                body="Cross-taskset memory challenge: clue cards appear throughout, then students recall them all at the end."
                bullets={[
                  "Reveal tasks interleaved through the set",
                  "Final recall task tests observation and memory",
                  "Auto-injected via teacher profile toggle",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Data & Reflection"
              title="Useful outputs — not noise"
              desc="Curriculate emphasizes teacher usability: clear tasks, predictable pacing, and outputs that help you teach."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="📊 Session Reports & Parent Notes"
                body="After each session, get a comprehensive report with AI-generated summaries and parent-ready blurbs."
                bullets={[
                  "Per-student grades with team member names and letter grades",
                  "AI-generated class chat blurb (copy-paste for Google Classroom or newsletters)",
                  "Parent note with engagement level, skills practiced, and proficiency",
                  "Skills developed badges, concepts covered, and activity highlights",
                  "Team selfie photos included in reports",
                ]}
              />
              <FeatureCard
                title=”🔒 Quality Guardrails & Validation”
                body=”AI-generated tasks are automatically validated and fixed before reaching students.”
                bullets={[
                  “Deterministic auto-fixes for chronology, answer keys, and item counts”,
                  “Tied-date detection, description-item filtering, and dangling reference checks”,
                  “Only generator-eligible, implemented task types make it through”,
                ]}
              />
            </div>
          </div>

          <div className="mt-14 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Ready to see it in action?</h2>
            <p className="mt-2 text-slate-600">
              Generate a task set, run it in stations, and feel the pacing difference.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Try the demo
              </Link>
              <Link
                href="/how-it-works"
                className="rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                How it works
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
