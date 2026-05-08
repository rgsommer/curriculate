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
