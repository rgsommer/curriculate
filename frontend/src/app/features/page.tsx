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

function SectionHeader({
  eyebrow,
  title,
  desc,
  mascot,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  mascot?: string;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      {mascot && (
        <img
          src={mascot}
          alt=""
          className="hidden h-16 w-16 flex-shrink-0 rounded-full object-cover shadow-sm md:block"
        />
      )}
      <div>
        <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
          {eyebrow}
        </div>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-2 max-w-3xl text-slate-600">{desc}</p>
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <img
              src="/images/mascot/promo/1.png"
              alt=""
              className="h-24 w-24 flex-shrink-0 rounded-full object-cover shadow-md md:h-32 md:w-32"
            />
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm">
                Features
              </div>
              <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">
                Curriculate is AI lesson planning — then AI task generation
              </h1>
              <p className="mt-4 text-lg text-slate-600">
                Most "AI classroom tools" generate activities. Curriculate plans the learning experience first:
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
                <Link
                  href="/pdfs/Curriculate-Report-WATER-42.pdf"
                  className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                  target="_blank"
                  rel="noopener"
                >
                  See a sample report
                </Link>
              </div>
            </div>
          </div>

          <SmartPlanningBlock />

          <div className="mt-10">
            <SectionHeader
              eyebrow="Planning & Pacing"
              title="Time-aware, student-aware task sets"
              desc="Pick a lesson length and learning goal. Teachers choose the time window; Curriculate chooses the task count and mix using expected task durations — without dead time or rushed endings."
              mascot="/images/mascot/thinking/1.png"
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
              desc="Curriculate is designed for real classrooms: color-coded CurricQR stations, physical display integration, multi-room scavenger hunts, and repeatable routines that students learn once and run every time."
              mascot="/images/mascot/promo/2.png"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="📍 Station-Ready by Design"
                body="Print color-coded CurricQR posters once, stick them around the room, and reuse them for every session. Students scan to arrive at a station and receive their next task."
                bullets={[
                  "8 color-coded stations with printable CurricQR posters",
                  "Automatic team-to-station assignment and rotation",
                  "Students scan to arrive — no teacher direction needed",
                  "Designed for quick launch and smooth transitions",
                ]}
              />
              <FeatureCard
                title="🔬 Fixed Stations with Physical Displays"
                body='Attach real objects to stations — a microscope at Red, an art print at Blue, a map at Green — and the AI generates tasks that reference what students are actually looking at.'
                bullets={[
                  "Name and describe the physical display at each station",
                  "AI writes tasks tied to each object (observation, analysis, comparison)",
                  "Pre-launch checklist confirms everything is in place",
                  "Works for science labs, art galleries, museum exhibits, and more",
                ]}
              />
              <FeatureCard
                title="🗺️ Multi-Room & Scavenger Hunts"
                body="Spread stations across the hallway, library, gym, or campus. Define your room list in your profile and select which rooms to use each session."
                bullets={[
                  "Configure room list once in your teacher profile",
                  "Select rooms per session — single-room or multi-room",
                  "Location-aware scanning enforces correct station visits",
                  "Great for review days, field trips, and engagement boosts",
                ]}
              />
              <FeatureCard
                title="🎯 Zero-Prep Reuse"
                body="The station routine is the same every session. Students learn the scan-arrive-work loop once, and it works for any subject, any taskset, any day."
                bullets={[
                  "Same CurricQR posters, different tasks every session",
                  "No re-printing, no new instructions, no wasted time",
                  "Works with all task types and game modes",
                ]}
              />
              <FeatureCard
                title="🖥️ On-Screen-Only Mode (per session)"
                body="For days when up-and-around won't fit — small rooms, mixed-mobility classes, indoor recess, a substitute teacher, an exam-review afternoon — flip the 'On-screen only' checkbox before launch. Curriculate becomes a rich at-desk learning platform. The 6 tasks that need physical movement around the room are skipped automatically; everything else runs unchanged."
                bullets={[
                  "Per-session checkbox in the launch panel — never the default",
                  "Skips Musical Chairs, Mad Dash, Mad Dash Sequence, Station Dash Quiz, Hide & Seek, Treasure Runner",
                  "Keeps all 50+ cognitive, creative, and discussion-based tasks",
                  "At-desk movement breaks (Body Break, Motion Mission) still play",
                  "Zero printer setup required — no QR posters needed",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Worldview Alignment"
              title="Specify the lens for prompts and scoring"
              desc="Teachers can define a worldview lens and use it to shape how tasks are framed and how responses are evaluated — without outsourcing judgment. The teacher sets the criteria; the system helps apply it consistently."
              mascot="/images/mascot/ambassador/1.png"
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
              mascot="/images/mascot/thinking/2.png"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="🎯 Retrieval & Review"
                body="Fast, confidence-building checks for key facts and terms."
                bullets={[
                  "Multiple choice and true/false formats",
                  "Cloze (fill-in-the-blank) with drag-and-drop word bank and instant scoring",
                  "Flashcards and speed rounds",
                  "Trivia breaks: bluff catcher, true/false rapid-fire, estimation",
                ]}
              />
              <FeatureCard
                title="🧠 Reasoning & Thinking"
                body="Tasks that require sorting, sequencing, comparing, and explaining."
                bullets={[
                  "Sorting/categorizing and matching formats",
                  "Label Me — match markers A–E on an AI-generated diagram, map, or illustration",
                  "Spot the Difference — compare two passages, two images, or two real subjects",
                  "Sequencing/timeline-style tasks",
                  "Explain-your-thinking prompts",
                ]}
              />
              <FeatureCard
                title="🎨 Expression & Creativity"
                body="Let students show understanding in more than one modality."
                bullets={[
                  "Live AI interviews — talk to historical figures, scientists, or characters in real time",
                  "Letter writing — write to a historical character, get an AI reply back",
                  "Case study — solve a real-world scenario, get AI expert feedback",
                  "Drawing/visual response and photo journal formats",
                  "Handwriting bonus — write on paper, snap a photo, earn extra points",
                ]}
              />
              <FeatureCard
                title="🤝 Collaboration & Communication"
                body="Structured discussion and team formats designed for real classrooms."
                bullets={[
                  "Peer editing with 38 teacher-style correction marks (tap any word to annotate)",
                  "Teach-back — explain concepts to a younger audience; AI-assessed for clarity and completeness",
                  "Intra-team and inter-team challenge options",
                  "Debate/discussion structures",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Game Modes & Engagement"
              title="Keep energy high with built-in game elements"
              desc="Curriculate adds moments of fun, team bonding, and surprise to every session — without losing focus."
              mascot="/images/mascot/treat/2.png"
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
              <FeatureCard
                title="🧠 Trivia Breaks"
                body="Quick trivia rounds mixing subject facts with pop culture — three fun formats in one task."
                bullets={[
                  "Bluff Catcher: spot the fake fact among two real ones",
                  "True/False rapid-fire with instant explanations",
                  "Closer To: estimation game with two choices",
                  "Each round mixes a subject fact with a pop culture / student-world fact",
                ]}
              />
              <FeatureCard
                title="🎰 Spinner Rewards"
                body="Wheel of Fortune-style animated spinner — teams spin for bonus points, perks, and a rare jackpot."
                bullets={[
                  "Colorful animated wheel with smooth deceleration",
                  "Point wedges (+50 to +200), fun perks, and a jackpot (+500)",
                  "Perks like 'Team High Five!' and 'Pick the next song'",
                  "Builds anticipation and energy between tasks",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Data & Reflection"
              title="Useful outputs — not noise"
              desc="Curriculate emphasizes teacher usability: clear tasks, predictable pacing, and outputs that help you teach."
              mascot="/images/mascot/email-results/1.png"
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
                  "Speech & text quality score per speaker — sustained, varied language vs. filler-heavy",
                  "Team selfie photos included in reports",
                ]}
              />
              <FeatureCard
                title="🔒 Quality Guardrails & Validation"
                body="AI-generated tasks are automatically validated and fixed before reaching students."
                bullets={[
                  "Deterministic auto-fixes for chronology, answer keys, and item counts",
                  "Tied-date detection, description-item filtering, and dangling reference checks",
                  "Only generator-eligible, implemented task types make it through",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Class Linking & Edsby Integration"
              title="Bind a class once, get gradebook-ready reports forever"
              desc="Upload your class roster from Edsby once. Curriculate connects every student to their canonical identity so attendance, grades, parent emails, and progress travel with them — across sessions, across teachers, across both Curriculate and Pulse Grading."
              mascot="/images/mascot/streak/1.png"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="📋 Three Ways to Link a Session"
                body="Whether you launch live, hand off to a sub, or fix things up after the fact, students end up matched to the right roster entry."
                bullets={[
                  "Live launch: pick a class on launch — students see a name dropdown when joining",
                  "Sub-teacher links: bind a class to the share link itself, so the sub doesn't touch class settings",
                  "Match-a-Session: post-hoc reconciliation tool with Levenshtein-suggested matches for unmatched names",
                  "Server-side identity validation — students can't claim Edsby IDs that aren't theirs",
                ]}
              />
              <FeatureCard
                title="📥 Edsby-Ready CSV in Every Email"
                body="Every session report email includes a CSV ready to upload into Edsby Gradebook — no manual editing, no name-matching headaches."
                bullets={[
                  "Standard Edsby format: Student ID, First Name, Last Name, Assessment Name, Date, Grade, Out Of, Comment",
                  "Roster-matched students get their Edsby Student IDs filled in automatically",
                  "Comments include direct links to each student's full feedback page",
                  "Generic CSV fallback if no class is bound — still useful for any LMS",
                ]}
              />
              <FeatureCard
                title="🔥 Streaks & Progress Tracking"
                body="Linked students see their running streak and total points the moment they pick their name on join — turning every session into a step in a longer story."
                bullets={[
                  "Per-student streak count (consecutive school days played)",
                  "Lifetime sessions played + lifetime points earned",
                  "'Welcome back!' banner shown automatically on join",
                  "Aggregated across teachers — same student keeps their streak in any class",
                ]}
              />
              <FeatureCard
                title="📈 Improvement Reports (Pro)"
                body="Every Pro session report includes a per-student trend column: are they improving, holding steady, or slipping vs. last session and vs. their average?"
                bullets={[
                  "Color-coded trend indicator: ▲ up, ▼ down, ▬ flat",
                  "Comparison vs. last session and vs. multi-session average",
                  "First-time-player baseline marker — no false 'down' signal on debut",
                  "Per-student narrative line in the individual one-page PDF report",
                ]}
              />
              <FeatureCard
                title="📧 Student & Parent Email Auto-Capture"
                body="Linked students supply their email once, then a gentle end-of-session prompt offers to add their parent's email too — no admin chase, no spreadsheet."
                bullets={[
                  "Email collected on first link; reused on every session and every grading run",
                  "End-of-session prompt: 'Would your parents want to see this result?'",
                  "Decline once and we never ask again for that student",
                  "Reports auto-CC the parent address on file — Curriculate sessions and Pulse Grading both",
                ]}
              />
              <FeatureCard
                title="🧑‍🏫 Class Roster Admin (Profile)"
                body="Review, fill in, or override any student's stored email or parent email directly from your Profile. Bulk-save, with row-level dirty-state highlighting."
                bullets={[
                  "Full-class table with editable Student Email + Parent Email columns",
                  "Inline validation, yellow change-indicator, single 'Save N changes' button",
                  "Teacher overrides win — even if a student previously declined the prompt",
                  "Tier-gated to Plus and above; identity verified server-side",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="New: AI Game Modes"
              title="Seven new ways for curriculum to come alive"
              desc="In addition to the 23 core task types, Curriculate now ships seven new game modes that turn a classroom into a live simulation. Each one is a different way for academic understanding to drive progress — earn coins, escape rooms, deduce the spy, race the tilt board, debate careers, deduce concepts, or connect today's lesson to this week's news."
              mascot="/images/mascot/promo/2.png"
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                title="🧠 What Am I?"
                body="A deduction game. Students see a vague clue and decide: guess now for max points, or reveal another clue and accept a lower ceiling. The earlier they commit, the more they earn — but with less information."
                bullets={[
                  "Inter-team mode: server-locked global clue ceiling — fair race across all teams",
                  "Server-validated answer matcher (exact / substring / fuzzy)",
                  "AI generator guards against dictionary-style clues; the answer must NEVER appear in a clue",
                  "Teacher controls: force-reveal a clue, freeze submissions, skip task",
                  "Demo pool of 6 concepts (Photosynthesis, the Nile, Gravity, Mitochondria, Magna Carta, Solar Eclipse)",
                ]}
              />
              <FeatureCard
                title="🪙 Quest Mode — a live trading economy"
                body="An expedition simulation with a real economy. Teams earn coins from academic work, hold a scarce specialty resource, and must TRADE with each other to assemble what a mission needs — no team can self-supply everything. Comparative advantage, scarcity, and rising prices make academic effort the engine of a market."
                bullets={[
                  "Each team is seeded with a different scarce specialty → real gains from trade (you need what they have)",
                  "Peer-to-peer QR trade: show a QR to sell, scan one to buy — coins + resources move between teams, server-validated with rollback",
                  "Specialty directory tells buyers which team to find; price defaults to a fair anchor, adjustable to negotiate",
                  "Time-based price inflation (on by default) — buy early before the depot gets expensive",
                  "Renewable specialties: refill slowly on their own, faster when you complete tasks (diligence beats free-riding)",
                  "Diligent teams can invest coins to open a franchise — become a second supplier of the scarcest resource",
                  "Per-session trade log in the teacher report; bonus + hidden tasks unlock for early finishers",
                  "Server-validated atomic spend + teacher console (grant coins, force-unlock tasks)",
                ]}
              />
              <FeatureCard
                title="🔐 Escape Room"
                body="Knowledge unlocks progress. Tasks award keys; keys open locks; locks reveal puzzle fragments; the final lock requires synthesis of everything earned. Curriculum terms are woven into every lock hint — pure escape doesn't work, only understanding does."
                bullets={[
                  "AI generator binds the config to teacher-supplied curriculum terms (≥ 80% coverage required)",
                  "Cascading lock evaluation — open one lock, its keys cascade",
                  "Three final-puzzle types: PIN entry, image-tile assembly, cipher-wheel alignment",
                  "Anti-brute-force: synthesis answer never leaves the server",
                  "Teacher mercy controls: grant any key directly when a team is stuck",
                ]}
              />
              <FeatureCard
                title="🕵 Whodunnit"
                body="At the start of a session, one player is secretly assigned a hidden role (spy / saboteur / infiltrator). As real gameplay happens — scans, submissions, movements — the engine surfaces TRUE clues about who they are. Teams investigate and accuse."
                bullets={[
                  "Real-gameplay clue generator (movement / identity / timing types)",
                  "Ambiguity-band guard: every clue intentionally fits 2+ students",
                  "Anti-toxicity: wrong accusations NEVER publicly name the accused",
                  "Per-team private clue purchases — buy investigation depth with points",
                  "Cooldown + max-accusation caps prevent spam-accuse",
                ]}
              />
              <FeatureCard
                title="📰 Current Events Connection"
                body="The only Curriculate task that's resolved LIVE at session launch — not at creation. A web search fetches a real news story from the past 7 days that connects to today's lesson, then AI generates discussion questions in your teacher worldview profile."
                bullets={[
                  "Live web search via Anthropic's tool — no curated feeds to maintain",
                  "Publisher exclusion list — configurable per teacher",
                  "Worldview profile: general, secular, or Christian framing (event itself stays neutral)",
                  "12-hour cache (Mongo-backed) + 10-entry evergreen fallback",
                  "Never skips: world → country → stale-cache → evergreen library",
                ]}
              />
              <FeatureCard
                title="🎯 Hole in One"
                body="A physics-tilt mini-game. Students answer curriculum questions to earn coins → buy rails → place them on the board → tilt the device to roll a ball into the hole. Knowledge literally builds the path."
                bullets={[
                  "DeviceOrientation API with iOS permission gate + keyboard / joystick fallback",
                  "Three phases: Earn (questions → coins) → Build (drag-place rails) → Tilt (physics)",
                  "Rotating tilter system encourages every teammate to take a turn",
                  "Server-clamped scoring prevents client-side cheating",
                  "Theme-aware AI board generation",
                ]}
              />
              <FeatureCard
                title="🧭 Careers"
                body="Six discussion-driven modes for Grades 6-12: Best Fit, Pathway Builder, Aptitude Match, Salary vs Lifestyle, Who Should Be Hired, Career Myths. Anti-prestige-bias guardrails throughout — trades and ministry count just as much as STEM."
                bullets={[
                  "Six modes in a single unified renderer",
                  "AI justification scorer (1 / 2 / 3 tiers) maps to participation / justification / strong-justification points",
                  "Anti-toxicity: Best Fit picks are private; 'worst fit' is never a prompt",
                  "Salary always shown as ranges, never single numbers",
                  "Category rotation (no STEM bias) baked into the AI prompt",
                ]}
              />
              <FeatureCard
                title="⚔️ Auto-Duels"
                body="When two teams are neck-and-neck (top-two score gap ≤ 10), the server automatically picks one player from each team for a head-to-head challenge. Question pulled from the active taskset; first correct answer wins a 1.5× bonus."
                bullets={[
                  "Triggered automatically — no teacher button. The score gap IS the criterion.",
                  "3-2-1 countdown + full-screen overlay for both duelists and spectators",
                  "30-second timeout + draw fallback",
                  "Loser team gets a 2-point consolation — no public shaming",
                  "Cooldown (4 min default) prevents back-to-back interruptions",
                ]}
              />
              <FeatureCard
                title="🔥 Truth or Dare"
                body="The classroom party game, rebuilt with academic safety rails. A weighted spotlight picks a student, they choose TRUTH (a curriculum-tied question) or DARE (a curriculum-tied performance), then the class judges. Five-layer moderation makes every prompt safe; an evergreen library guarantees the game never breaks."
                bullets={[
                  "AI generator + 5-layer safety pipeline: phrase blacklist → regex → category whitelist → intensity caps → OpenAI moderation API",
                  "Curated evergreen library auto-falls-back when moderation blocks an AI prompt — the game never stalls",
                  "Weighted-random spotlight with per-team cooldowns (no one gets picked twice in a row, quiet kids get gentle boosts)",
                  "Three tiers (🌱 Sprout → 🌿 Stem → 🌳 Big) escalate after 3 successes, demote on fail — every student climbs",
                  "Teacher peek window (1.5s) lets you Approve / Reroll / Edit before students ever see a challenge",
                  "Per-room dedupe + worldview-aware prompts (secular / faith / general) + safe-classroom mode (no movement, no noise)",
                ]}
              />
              <FeatureCard
                title="🗺 Map It"
                body="Match-on-a-map for any geography-flavoured unit. Students see a real cartographic image with 3–5 numbered coloured markers and match each marker to the correct location, event, or person from a shuffled choice list — the same two-tap interaction as Matching, but anchored to a place."
                bullets={[
                  "AI generator detects geographic vocab automatically and refuses to ship a Map It task for non-geographic topics (math operations, grammar rules, abstract concepts)",
                  "Heavy subject affinity for history, religion, and physical geography — appears naturally in those subjects' tasksets, stays out of math/arts",
                  "Reuses the Matching grading + review flow, so it inherits all the per-student strictness adjustment and answer-overlay polish",
                  "Bloom mapping: APPLY (primary) + ANALYZE (secondary) — students don't just recall a place, they reason about where it fits",
                ]}
              />
              <FeatureCard
                title="🏷 Label Me"
                body="Matching, but on a diagram. The AI generates a clean, high-contrast educational illustration — a heart, a cell, a watershed, a Roman forum, a Bible-times map — overlays markers A–E, and students match each marker to the correct term from a shuffled list."
                bullets={[
                  "Image generation happens at taskset creation time so students see the diagram instantly — no in-session image latency",
                  "Markers are overlaid on top of the rendered image so the prompt never contains baked-in text labels (no cheating from caption-reading)",
                  "Highest subject affinity for science, history, and health — anatomy, ecosystems, historical maps, civics diagrams",
                  "Bloom mapping: REMEMBER (primary) + UNDERSTAND (secondary) — the visual anchor makes recall stickier than text-only Matching",
                ]}
              />
            </div>
            <div className="mt-6">
              <Link
                href="/sample-sessions"
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-700"
              >
                See 5 sample sessions across subjects &amp; grades →
              </Link>
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Pulse Grading"
              title="AI grading at curriculate.net/grading"
              desc="A companion product, sharing the same identity layer and class-linking infrastructure. Snap a photo, paste text, upload a batch PDF, record a speech, or upload a video — Pulse Grading gives every student rubric-matched feedback and a personal results page in seconds."
              mascot="/images/mascot/email-results/2.png"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                title="📷 Five Input Modes"
                body="Grade work in whatever form it arrives. Pulse Grading handles handwriting, typing, batch print-outs, oral presentations, and video performances."
                bullets={[
                  "Photo: snap a single student's work, get instant feedback",
                  "Paste: drop in typed responses",
                  "Batch PDF: upload a stack of handwritten papers — AI classifies each page and grades each student",
                  "Audio: speeches, music, drama performances with rubric scoring",
                  "Video: full performance grading with multi-modal feedback",
                ]}
              />
              <FeatureCard
                title="🎙️ 13 Feedback Voices"
                body="Match the feedback tone to your teaching style — encouraging, rigorous, journal-response, growth-mindset, and more — with optional per-question audit toggle."
                bullets={[
                  "13 distinct feedback voices, plus a rigorous-review modifier",
                  "Per-question audit lets you spot-check any AI judgment",
                  "Rubric override: paste, upload PDF/DOCX, or auto-detect from photos",
                  "Saved rubrics for one-click reuse across assignments",
                ]}
              />
              <FeatureCard
                title="📑 Per-Student Result Pages"
                body="Every graded submission gets a short result code. Students and parents visit /results/{code} for full feedback, rubric breakdown, and original work photos."
                bullets={[
                  "Stable result page per submission with persistent URL",
                  "CurricQR-coded student PDFs for paper hand-back",
                  "Feedback emailed to the student's stored email and parent's stored email automatically",
                  "Progress portal aggregates a student's results across the year",
                ]}
              />
              <FeatureCard
                title="🤝 Shared Identity with Curriculate"
                body="A student linked once is linked everywhere. Their email, parent email, streak, and progress are the same record across products."
                bullets={[
                  "Single StudentContact identity keyed by Edsby ID",
                  "Email collection in Curriculate flows into Pulse Grading and vice versa",
                  "One Edsby roster import powers both products",
                  "Per-student emails sent from one pipeline, no matter which product graded the work",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Care & Attention"
              title="What AI grading shouldn't lose: the human read"
              desc="When you grade by hand, you catch the moment a student's journal turns serious — a passing line about home, a flicker of struggle, something that deserves a follow-up. Pulse Grading is built to keep that signal visible, not bury it under a pile of efficiency."
              mascot="/images/mascot/feedback/2.png"
            />
            <FeatureCard
              title="🚩 Well-being check — alongside every grade"
              body="When the AI reads a student's writing, it's also watching for signals a caring teacher would want to know about — and surfaces them in two clearly-marked tiers, with a short snippet so you can locate the passage."
              bullets={[
                "⚠️ Possible safety concern — explicit signals (self-harm references, abuse disclosure, persistent bullying, severe hopelessness)",
                "💛 Wellbeing — notable personal context worth a check-in (recent loss, family stress, anxiety mentioned in passing, identity concerns)",
                "Short snippet (≤15 words) so you can locate the passage — never a long quote, never third-party identifying details",
                "Surfaces in the on-screen results banner AND in the session-summary email — you can't miss it in batch grading",
                "Strict guardrails: no diagnosis, no prescription, signal-only — you remain the decision-maker",
                "Teacher-only: never in CSV exports, parent emails, student result pages, or any grade analytics",
              ]}
            />
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-sm font-bold text-amber-900 mb-1">A note on what this is and isn't</div>
              <p className="text-sm leading-relaxed text-amber-900/85">
                This is an AI signal, not a clinical judgment. It catches what's plausibly visible in the
                writing — it cannot replace your judgment, your knowledge of the student, or your school's
                safeguarding policy. The detection is intentionally biased toward "none" when uncertain, so
                the few flags that do surface are the ones genuinely worth your attention.
              </p>
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Plans"
              title="Three tiers — Free, Plus, Pro"
              desc="Free is full-featured for live engagement. Plus unlocks class linking and gradebook integration. Pro adds per-student improvement reports for teachers and admins who want to track impact over time."
              mascot="/images/mascot/recommend/1.png"
            />
            <div className="grid gap-4 md:grid-cols-3">
              <FeatureCard
                title="Free — $0"
                body="Run unlimited Curriculate sessions and Pulse Grading with all 23+ task types and the full AI generation pipeline. Capacity-limited."
                bullets={[
                  "All task types and game modes",
                  "AI lesson planning + generation",
                  "Standard session reports",
                  "Pulse Grading basics (photo, paste, batch)",
                ]}
              />
              <FeatureCard
                title="Plus — $6.99/mo"
                body="Everything in Free, plus the class-linking platform — for teachers who want their work to flow into Edsby and stay connected to specific students over time."
                bullets={[
                  "Edsby class roster upload",
                  "Class-bound launches + sub-teacher link binding",
                  "Match-a-Session post-hoc reconciliation tool",
                  "Roster admin: edit student + parent emails directly",
                  "Student-level reports and PDF exports",
                  "AI gradebook with strands; XLSX export",
                ]}
              />
              <FeatureCard
                title="Pro — $12.99/mo"
                body="Everything in Plus, plus per-student improvement and trend reports — the data view that demonstrates impact over time."
                bullets={[
                  "Per-student improvement column (vs. last session, vs. average)",
                  "Color-coded trend indicators in email + PDF reports",
                  "Individual one-page student PDFs",
                  "Expanded AI generation; advanced analytics",
                  "Full classroom capacity",
                ]}
              />
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Replayability"
              title="40 weeks. 40 unique sessions."
              desc="If you ran Curriculate with your class once a week for a full school year, the odds that any two weeks would feel the same are effectively zero. Here's the math."
              mascot="/images/mascot/recommend/1.png"
            />

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-3xl">🎲</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">67 cognitive task types</h3>
                <p className="mt-2 text-sm text-slate-600">
                  A typical 12-task session is drawn from 67 cognitive task types across all six Bloom&apos;s levels.
                  Just choosing which task types appear (without ordering) yields more than 10<sup>13</sup>{" "}
                  unordered combinations.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-3xl">🧠</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">AI-generated content, every time</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Each task&apos;s questions, distractors, clues, suspect lists, fact pools, riddles, and rubrics are
                  freshly generated. Even the same topic at the same grade produces different items, options, and
                  framings on every run.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-3xl">📰</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">Runtime resolution</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Current Events pulls live news at launch. Whodunnit picks a different suspect per team. Legends
                  rotates figures. Hole-in-One randomizes the rail order. Quest hides bonus tasks behind different
                  unlock conditions. The board state changes mid-session.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">The math, briefly</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Pick 12 task types out of 67: C(67, 12) ≈ 4.8 × 10<sup>13</sup>. Multiply by the AI content
                  variation per task — different items, different rubrics, different decoys — and the effective
                  sample space dwarfs the number of seconds in a teacher&apos;s career.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  The probability of two sessions over 40 weeks looking even superficially identical is essentially
                  zero. The number of distinct learning experiences a single classroom can produce is, for
                  practical purposes, unbounded.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">What this means in practice</h3>
                <ul className="mt-2 grid gap-2 text-sm text-slate-700">
                  <li>• Run the same unit twice — students never see the same questions.</li>
                  <li>• Teach the same topic across periods — each section gets fresh content.</li>
                  <li>• Use the platform every week — novelty stays high, engagement compounds.</li>
                  <li>• Re-teach a concept the next year — the experience is genuinely new.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <SectionHeader
              eyebrow="Sample Reports"
              title="See exactly what teachers and parents receive"
              desc="Real PDF reports generated from real classroom sessions — exactly what lands in inboxes after every Curriculate run."
              mascot="/images/mascot/feedback/1.png"
            />

            {/* Featured: the headline PDF — full session report from a real run.
                Larger card with a "Recommended" tag to anchor the gallery. */}
            <a
              href="/pdfs/Curriculate-Report-WATER-42.pdf"
              target="_blank"
              rel="noopener"
              className="group block rounded-3xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-8 shadow-md transition hover:shadow-lg"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="text-5xl">💧</div>
                <div className="flex-1">
                  <div className="inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    Recommended sample
                  </div>
                  <h3 className="mt-3 text-2xl font-extrabold text-slate-900 group-hover:text-blue-700">
                    Full Session Report — Water Cycle (PDF)
                  </h3>
                  <p className="mt-2 text-slate-700">
                    End-to-end report from a real Grade 5 Water Cycle session: AI summary, Bloom's cognitive
                    profile, team rankings, exit feedback, gradebook with per-student trend column, parent note.
                    This is what your inbox looks like after a live session.
                  </p>
                  <span className="mt-3 inline-flex items-center text-sm font-bold text-blue-700">
                    Open PDF →
                  </span>
                </div>
              </div>
            </a>

            {/* Primary samples: the per-audience PDFs */}
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <a
                href="/pdfs/Curriculate-Teacher-Report-Sample.pdf"
                target="_blank"
                rel="noopener"
                className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="text-2xl">📎</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-blue-700">
                  Teacher Report (PDF)
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  The teacher-facing PDF — class summary, team table, gradebook with trend column, parent note,
                  ready to share or print.
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-semibold text-blue-700">
                  View PDF →
                </span>
              </a>
              <a
                href="/pdfs/Curriculate-Student-Report-SampleGr5.pdf"
                target="_blank"
                rel="noopener"
                className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="text-2xl">🧒</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-blue-700">
                  Student Report — Grade 5 (PDF)
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  One-page student PDF: their score, category breakdown, and personalized teacher comment. Sent
                  directly to the student and (with consent) the parent.
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-semibold text-blue-700">
                  View PDF →
                </span>
              </a>
              <a
                href="/pdfs/Curriculate-Student-Report-SampleGr7.pdf"
                target="_blank"
                rel="noopener"
                className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="text-2xl">🧑‍🎓</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-blue-700">
                  Student Report — Grade 7 (PDF)
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Same one-page format scaled for older students — denser feedback, more nuanced category language.
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-semibold text-blue-700">
                  View PDF →
                </span>
              </a>
            </div>

            {/* Companion / utility — secondary row */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <a
                href="/sample-report.html"
                target="_blank"
                rel="noopener"
                className="group rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 transition hover:border-slate-400 hover:bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="text-xl">📨</div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-700">
                      Companion: HTML email-format preview
                    </h4>
                    <p className="mt-1 text-xs text-slate-600">
                      See the same data in the email layout that gets sent — for visualizing the inbox view.
                    </p>
                  </div>
                </div>
              </a>
              <a
                href="/pdfs/Curriculate-Station-Posters.pdf"
                target="_blank"
                rel="noopener"
                className="group rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 transition hover:border-slate-400 hover:bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="text-xl">🎯</div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-700">
                      Utility: CurricQR Station Posters
                    </h4>
                    <p className="mt-1 text-xs text-slate-600">
                      Print-ready color-coded station posters — stick them around the room once and reuse forever.
                    </p>
                  </div>
                </div>
              </a>
            </div>
          </div>

          <div className="mt-14 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-start gap-4">
              <img
                src="/images/mascot/celebrate/1.png"
                alt=""
                className="hidden h-20 w-20 flex-shrink-0 rounded-full object-cover shadow-sm md:block"
              />
              <div>
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
          </div>
        </div>
      </section>
    </main>
  );
}
