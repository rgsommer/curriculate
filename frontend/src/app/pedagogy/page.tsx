// frontend/src/app/pedagogy/page.tsx
import Link from "next/link";
import {
  ArrowRight,
  Footprints,
  Users,
  BarChart3,
  ShieldCheck,
  Camera,
  Brain,
  BookOpen,
  Wrench,
  Search,
  Scale,
  Sparkles,
} from "lucide-react";

/* ─── Five pedagogical pillars (existing content) ─── */

const pillars = [
  {
    icon: <Footprints className="w-6 h-6 text-blue-600" />,
    title: "Movement With Structure",
    body: "Students move with clear prompts, time limits, and scavenger hunt accountability — increasing focus and reducing off-task behavior.",
    bullets: [
      "Improves attention",
      "Reduces restlessness",
      "Supports kinesthetic learners",
    ],
  },
  {
    icon: <Users className="w-6 h-6 text-purple-600" />,
    title: "Collaboration That Matters",
    body: "Teams submit one shared response, which naturally drives peer teaching and shared responsibility — without 30 individual devices doing 30 isolated tasks.",
    bullets: [
      "Peer teaching",
      "Shared responsibility",
      "Communication + leadership practice",
    ],
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-emerald-600" />,
    title: "Assessment During Learning",
    body: "Teachers see understanding in real time. Misconceptions become visible while students are still working — so you can intervene immediately.",
    bullets: [
      "Live misconception detection",
      "Immediate reteaching",
      "Less grading after class",
    ],
  },
  {
    icon: <Camera className="w-6 h-6 text-pink-600" />,
    title: "Evidence You Can Defend",
    body: "Photos, drawings, and written explanations create artifacts of learning. Reports aren't just scores — they're proof of thinking.",
    bullets: [
      "Great for conferencing",
      "Clear for parents",
      "Strong for admin conversations",
    ],
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-indigo-600" />,
    title: "AI That Respects Teachers",
    body: "AI is optional and teacher-controlled: generate task sets, assist with feedback, and provide rubric-style scoring — while keeping teacher judgment central.",
    bullets: [
      "Zero-prep generation (optional)",
      "Consistent feedback support",
      "Always overrideable",
    ],
  },
];

/* ─── Bloom's Taxonomy data (mirrors shared/taskTypes.js) ─── */

type BloomLevel = {
  key: string;
  label: string;
  verb: string;
  color: string;
  description: string;
  icon: React.ReactNode;
  primary: number;
  secondary: number;
  tasks: string[];
  secondaryTasks: string[];
};

const bloomsData: BloomLevel[] = [
  {
    key: "REMEMBER",
    label: "Remember",
    verb: "Recall",
    color: "#ef4444",
    description: "Retrieving relevant knowledge from long-term memory",
    icon: <Brain className="w-5 h-5" />,
    primary: 9,
    secondary: 8,
    tasks: [
      "Multiple Choice",
      "True/False",
      "Flashcards",
      "Flashcards Race",
      "Hangman Duel",
      "Riddle",
      "Trivia",
      "Spinner",
      "Cloze",
    ],
    secondaryTasks: [
      "Short Answer",
      "Matching",
      "Mad Dash",
      "Musical Chairs",
      "Mystery Clues",
      "Physical Mystery",
      "Brain Blitz",
      "Legends",
    ],
  },
  {
    key: "UNDERSTAND",
    label: "Understand",
    verb: "Explain",
    color: "#f97316",
    description: "Constructing meaning from instructional messages",
    icon: <BookOpen className="w-5 h-5" />,
    primary: 6,
    secondary: 6,
    tasks: [
      "Short Answer",
      "Reading Comp",
      "Brain Spark Notes",
      "Pronunciation",
      "Speech Recognition",
      "Teach-Back",
    ],
    secondaryTasks: [
      "Multiple Choice",
      "True/False",
      "Trivia",
      "Echo Chain",
      "Record Audio",
      "Cloze",
    ],
  },
  {
    key: "APPLY",
    label: "Apply",
    verb: "Use",
    color: "#eab308",
    description: "Carrying out or using a procedure in a given situation",
    icon: <Wrench className="w-5 h-5" />,
    primary: 15,
    secondary: 10,
    tasks: [
      "Sort",
      "Sequence",
      "Matching",
      "Timeline",
      "VennSort",
      "Mad Dash",
      "Mad Dash Sequence",
      "Pet Feeding",
      "Tower Builder",
      "Musical Chairs",
      "Word Weaver",
      "Mystery Clues",
      "Hide & Seek",
      "Quest",
      "Hole in One",
    ],
    secondaryTasks: [
      "Physical MC",
      "Flashcards Race",
      "Pronunciation",
      "Speech Rec",
      "Mime",
      "Draw Mime",
      "Speed Draw",
      "Make & Snap",
      "Interview",
      "Cloze",
    ],
  },
  {
    key: "ANALYZE",
    label: "Analyze",
    verb: "Distinguish",
    color: "#22c55e",
    description: "Breaking material into parts and detecting relationships",
    icon: <Search className="w-5 h-5" />,
    primary: 13,
    secondary: 14,
    tasks: [
      "Mind Mapper",
      "Brain Blitz",
      "TF Tic-Tac-Toe",
      "TF Connect Four",
      "Diff Detective",
      "Case Study",
      "Art View",
      "Historical Doc",
      "Fake Out",
      "Guess Who",
      "What Am I?",
      "Current Events",
      "Legends",
    ],
    secondaryTasks: [
      "Sort",
      "Sequence",
      "Timeline",
      "VennSort",
      "Mad Dash Sequence",
      "Reading Comp",
      "Brain Spark Notes",
      "Live Debate",
      "AI Debate Judge",
      "Peer Editing",
      "Interview",
      "Brainstorm Battle",
      "Careers",
      "Hole in One",
    ],
  },
  {
    key: "EVALUATE",
    label: "Evaluate",
    verb: "Judge",
    color: "#3b82f6",
    description: "Making judgments based on criteria and standards",
    icon: <Scale className="w-5 h-5" />,
    primary: 10,
    secondary: 16,
    tasks: [
      "Open Text",
      "Live Debate",
      "AI Debate Judge",
      "Collaboration",
      "Narration Synthesize",
      "Letter",
      "Peer Editing",
      "Interview",
      "Photo Journal",
      "Careers",
    ],
    secondaryTasks: [
      "Tower Builder",
      "TF Tic-Tac-Toe",
      "TF Connect Four",
      "Case Study",
      "Art View",
      "Historical Doc",
      "Fake Out",
      "Role Play",
      "Role Play Deck",
      "Script Play",
      "Open Text",
      "Photo Journal",
      "Teach-Back",
      "What Am I?",
      "Quest",
      "Current Events",
    ],
  },
  {
    key: "CREATE",
    label: "Create",
    verb: "Produce",
    color: "#8b5cf6",
    description: "Putting elements together to form a novel, coherent whole",
    icon: <Sparkles className="w-5 h-5" />,
    primary: 14,
    secondary: 6,
    tasks: [
      "Draw",
      "Mime",
      "Draw Mime",
      "Speed Draw",
      "Photo",
      "Make & Snap",
      "Photo Journal",
      "Echo Chain",
      "Brainstorm Battle",
      "Role Play",
      "Role Play Deck",
      "Script Play",
      "Record Audio",
      "Storytelling",
    ],
    secondaryTasks: [
      "Mind Mapper",
      "Word Weaver",
      "Collaboration",
      "Narration Synthesize",
      "Letter",
      "Echo Chain",
    ],
  },
];

const TOTAL_COGNITIVE = 67; // total primary classifications across all levels

/* ─── Other frameworks ─── */

const webbsDOK = [
  { level: "DOK 1 — Recall", pct: 16, color: "#f87171" },
  { level: "DOK 2 — Skill / Concept", pct: 35, color: "#fbbf24" },
  { level: "DOK 3 — Strategic Thinking", pct: 33, color: "#34d399" },
  { level: "DOK 4 — Extended Thinking", pct: 16, color: "#818cf8" },
];

const soloTaxonomy = [
  { level: "Unistructural", pct: 15, color: "#f87171" },
  { level: "Multistructural", pct: 25, color: "#fbbf24" },
  { level: "Relational", pct: 35, color: "#34d399" },
  { level: "Extended Abstract", pct: 25, color: "#818cf8" },
];

const modalities = [
  { mode: "Visual", pct: 30, color: "#f472b6", desc: "Drawing, photo, art view, diagrams" },
  { mode: "Auditory", pct: 12, color: "#60a5fa", desc: "Pronunciation, speech, record audio, debate" },
  { mode: "Kinesthetic", pct: 25, color: "#34d399", desc: "Stations, movement, mad dash, hide & seek" },
  { mode: "Read / Write", pct: 33, color: "#a78bfa", desc: "Cloze, short answer, letter, open text, peer editing, teach-back" },
];

/* ─── Component ─── */

export default function PedagogyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        {/* ───────── Hero ───────── */}
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">
          Pedagogy &amp; Learning Science
        </h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-12">
          Designed around how students actually learn: active participation,
          retrieval practice, collaboration, and real evidence — backed by
          Bloom&apos;s Taxonomy coverage across every task type.
        </p>

        {/* ───────── Five Pillars ───────── */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-800 mb-4">
            Teaching Philosophy
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">
            Five pillars of Curriculate
          </h2>
          <p className="text-gray-600 font-medium max-w-2xl mb-6">
            Every feature in the platform traces back to one of these
            principles.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-20">
          {pillars.map((s) => (
            <div
              key={s.title}
              className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  {s.icon}
                </div>
                <h3 className="text-2xl font-extrabold text-gray-900">
                  {s.title}
                </h3>
              </div>
              <p className="text-gray-700 font-medium mb-4">{s.body}</p>
              <ul className="space-y-2 text-gray-800 font-medium">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════
            BLOOM'S TAXONOMY SECTION
        ═══════════════════════════════════════════════════════ */}

        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-4 py-1.5 text-sm font-bold text-purple-800 mb-4">
            <Brain className="w-4 h-4" /> Learning Science
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-2">
            Bloom&apos;s Taxonomy coverage
          </h2>
          <p className="text-gray-600 font-medium max-w-3xl mb-2">
            Every Curriculate task type is mapped to one or more levels of
            Bloom&apos;s Taxonomy. Here&apos;s the breakdown across all 61
            cognitive task types — showing exactly where each level of thinking
            is exercised.
          </p>
          <p className="text-gray-500 text-sm font-medium max-w-3xl">
            7 additional meta tasks (team selfie, mood check-in, body break,
            etc.) are excluded from cognitive analysis.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-8">
          {bloomsData.map((b) => (
            <div
              key={b.key}
              className="bg-white rounded-2xl border border-gray-200 shadow-lg p-4 text-center"
            >
              <div
                className="text-3xl font-black"
                style={{ color: b.color }}
              >
                {b.primary}
              </div>
              <div className="text-xs font-bold text-gray-500 mt-1">
                {b.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tier summary */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8 mb-8">
          <h3 className="text-xl font-extrabold text-gray-900 mb-4">
            Cognitive tier distribution
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-red-50 border border-red-200 p-5">
              <div className="text-2xl font-black text-red-700">25%</div>
              <div className="font-bold text-red-900 mt-1">
                Know It — Remember + Understand
              </div>
              <p className="text-red-700 text-sm font-medium mt-2">
                15 tasks focus on recall and explanation — the foundation of
                learning, but not where Curriculate stops.
              </p>
            </div>
            <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-5">
              <div className="text-2xl font-black text-yellow-700">38%</div>
              <div className="font-bold text-yellow-900 mt-1">
                Use It — Apply + Analyze
              </div>
              <p className="text-yellow-700 text-sm font-medium mt-2">
                23 tasks require students to sort, sequence, compare,
                deconstruct, and apply knowledge in context.
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-5">
              <div className="text-2xl font-black text-blue-700">38%</div>
              <div className="font-bold text-blue-900 mt-1">
                Own It — Evaluate + Create
              </div>
              <p className="text-blue-700 text-sm font-medium mt-2">
                23 tasks push students to judge, critique, design, and produce
                — the highest cognitive demands.
              </p>
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium mt-4">
            Compare this to quiz-only platforms like Kahoot or Blooket, where
            nearly 100% of activity stays in the Remember tier.
          </p>
        </div>

        {/* Per-level detail */}
        <div className="space-y-4 mb-16">
          {bloomsData.map((b) => {
            const pct = Math.round((b.primary / TOTAL_COGNITIVE) * 100);
            return (
              <div
                key={b.key}
                className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: b.color + "18", color: b.color }}
                  >
                    {b.icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-gray-900">
                      {b.label}{" "}
                      <span className="text-gray-400 font-bold text-base">
                        — {b.verb}
                      </span>
                    </h3>
                    <p className="text-sm text-gray-500 font-medium">
                      {b.description}
                    </p>
                  </div>
                </div>

                {/* Bar */}
                <div className="mt-4 mb-3 flex items-center gap-3">
                  <div className="flex-1 h-7 rounded-lg bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-lg flex items-center px-3 text-white text-xs font-bold"
                      style={{
                        width: `${Math.max(pct, 8)}%`,
                        backgroundColor: b.color,
                      }}
                    >
                      {pct}%
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-500 whitespace-nowrap">
                    {b.primary} primary · {b.secondary} secondary
                  </span>
                </div>

                {/* Task chips */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {b.tasks.map((t) => (
                    <span
                      key={t}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg"
                      style={{
                        backgroundColor: b.color + "14",
                        color: b.color,
                      }}
                    >
                      {t}
                    </span>
                  ))}
                  {b.secondaryTasks.map((t) => (
                    <span
                      key={t}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-500"
                    >
                      {t} ²
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ═══════════════════════════════════════════════════════
            OTHER FRAMEWORKS
        ═══════════════════════════════════════════════════════ */}

        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-800 mb-4">
            Beyond Bloom&apos;s
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">
            Additional learning frameworks
          </h2>
          <p className="text-gray-600 font-medium max-w-3xl mb-6">
            Bloom&apos;s is the most widely known, but educators use other
            lenses too. Here&apos;s how Curriculate&apos;s task library maps
            against three more.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {/* Webb's DOK */}
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
            <h3 className="text-lg font-extrabold text-gray-900 mb-1">
              Webb&apos;s Depth of Knowledge
            </h3>
            <p className="text-sm text-gray-500 font-medium mb-5">
              Measures how deeply students must engage with content.
            </p>
            <div className="space-y-3">
              {webbsDOK.map((d) => (
                <div key={d.level}>
                  <div className="flex justify-between text-sm font-bold mb-1">
                    <span className="text-gray-700">{d.level}</span>
                    <span style={{ color: d.color }}>{d.pct}%</span>
                  </div>
                  <div className="h-4 rounded bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${d.pct}%`,
                        backgroundColor: d.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SOLO Taxonomy */}
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
            <h3 className="text-lg font-extrabold text-gray-900 mb-1">
              SOLO Taxonomy
            </h3>
            <p className="text-sm text-gray-500 font-medium mb-5">
              Measures the structural complexity of student responses.
            </p>
            <div className="space-y-3">
              {soloTaxonomy.map((s) => (
                <div key={s.level}>
                  <div className="flex justify-between text-sm font-bold mb-1">
                    <span className="text-gray-700">{s.level}</span>
                    <span style={{ color: s.color }}>{s.pct}%</span>
                  </div>
                  <div className="h-4 rounded bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${s.pct}%`,
                        backgroundColor: s.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* VARK Modalities */}
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
            <h3 className="text-lg font-extrabold text-gray-900 mb-1">
              VARK Learning Modalities
            </h3>
            <p className="text-sm text-gray-500 font-medium mb-5">
              Ensures all sensory channels are addressed.
            </p>
            <div className="space-y-3">
              {modalities.map((m) => (
                <div key={m.mode}>
                  <div className="flex justify-between text-sm font-bold mb-1">
                    <span className="text-gray-700">{m.mode}</span>
                    <span style={{ color: m.color }}>{m.pct}%</span>
                  </div>
                  <div className="h-4 rounded bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${m.pct}%`,
                        backgroundColor: m.color,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Competitor comparison callout ─── */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10 mb-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-4">
            How this compares
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-6">
              <div className="font-black text-blue-900 mb-2">Curriculate</div>
              <p className="text-blue-800 font-medium text-sm leading-relaxed">
                25% Remember/Understand · 38% Apply/Analyze · 38%
                Evaluate/Create. Higher-order thinking is built into the task
                library — not an optional add-on. Four VARK modalities covered.
                Station rotation adds kinesthetic engagement that no screen-only
                tool can match.
              </p>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">
                Quiz-based platforms
              </div>
              <p className="text-gray-700 font-medium text-sm leading-relaxed">
                Kahoot, Blooket, and Quizlet concentrate almost entirely in the
                Remember tier — multiple-choice recall and flashcard
                memorization. They excel at engagement but provide limited
                opportunities for analysis, evaluation, or creation.
              </p>
            </div>
          </div>
        </div>

        {/* ─── CTAs ─── */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/demo"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
          >
            Try the Demo <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/features"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
          >
            Explore Features
          </Link>
          <Link
            href="/compare"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
          >
            Compare Tools
          </Link>
        </div>
      </div>
    </main>
  );
}
