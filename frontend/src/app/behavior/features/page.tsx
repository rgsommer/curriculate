// src/app/behavior/features/page.tsx
//
// Public features/overview page for the Behaviours app. Reachable at
// /behavior/features (and /behaviors/features via a redirect in next.config.js).

import Link from "next/link";

export const metadata = {
  title: "Behaviours — Features",
  description:
    "Track student behaviour across a whole school. One shared strike count per student, across every teacher, with automatic parent notices.",
};

const FEATURES = [
  {
    title: "One count per student — across every teacher",
    body: "Incidents pool per student, not per teacher. Two strikes with each of six teachers still reaches the trigger. No more slipping through the cracks because each teacher counts separately.",
  },
  {
    title: "Threshold & immediate triggers",
    body: "Most behaviours count toward a shared strike total that fires a notice home at the trigger number. Serious ones (insolence, cheating) notify a parent immediately on a single incident.",
  },
  {
    title: "30-day fade window",
    body: "Old incidents stop counting toward the threshold after a configurable window, so a student isn't punished forever — but the full history is always kept.",
  },
  {
    title: "AI-written notes home (with a safety net)",
    body: "Each notice is composed to read naturally and adapt its tone to the history — gentler on a first contact, clearer on a repeat. If the AI is ever unavailable, a deterministic template still sends. A notice never silently fails.",
  },
  {
    title: "Signed by the right teachers",
    body: "A notice is from the teachers whose incidents made up the strikes — each named with the behaviour they logged — not a single homeroom teacher.",
  },
  {
    title: "VP escalation",
    body: "The Vice-Principal is automatically copied on the second and later notices home for a student, so leadership is looped in exactly when a pattern is forming.",
  },
  {
    title: "Edsby or email — your choice",
    body: "Notices deliver over Edsby, email, or both. Email works on day one; if an Edsby post ever fails, it falls over to email automatically.",
  },
  {
    title: "Mobile-first, in-the-moment logging",
    body: "Search any student, tap the behaviour(s), submit — a few taps on a phone while you're still in the classroom. No hunting through spreadsheets.",
  },
  {
    title: "Roster import in seconds",
    body: "Upload your student list as CSV or XLSX — messy rows and duplicates are handled, skipped rows are reported, and sensitive fields are dropped automatically.",
  },
  {
    title: "Per-student communication history",
    body: "Every notice — who it went to, on which channel, the full wording, whether the VP was copied — is kept in a timeline you can review before a parent meeting.",
  },
  {
    title: "Shared, consistent expectations",
    body: "One division-wide list of behaviours and consequences keeps expectations predictable. Teachers can add their own private behaviours without changing the shared set.",
  },
  {
    title: "Roles, invites & privacy",
    body: "Invite staff by email (locked to your school's domain). Teachers log and view; only admins edit setup; the principal gets a read-only view. Every send and change is audit-logged.",
  },
  {
    title: "Houses & points",
    body: "Define houses, assign students (by import or in Setup), and attach a point value to any behaviour — negative to deduct for an offence, positive to reward a good one. The dashboard shows a live house leaderboard, and you can award points to a whole house at once.",
  },
  {
    title: "Positive behaviours, properly separated",
    body: "Positives never touch the strike count — they don't add to it and never subtract from it. They earn house points, are documented, and are warmly acknowledged in a note home rather than weighed against the student.",
  },
  {
    title: "Good-news notes home",
    body: "When a student racks up enough positives within the window (3 within 3× the fade range), a celebratory note home is queued automatically — no concerns, no points mentioned, just good news for the parents.",
  },
  {
    title: "Log several students at once",
    body: "For 'these five weren't ready for class' moments, flip to the reverse flow: pick one behaviour, tap the students, log them all in one go. Each still gets their own record and trigger check.",
  },
  {
    title: "House standings report",
    body: "Turn on an email report in Setup that ranks the houses by total points and names the top 3 contributing students for each — send it on demand for assemblies or newsletters.",
  },
];

const STEPS = [
  { n: "1", t: "Set up your division", d: "Upload the roster, set the trigger count and fade window, name your VP, and invite your staff." },
  { n: "2", t: "Log in the moment", d: "Any teacher logs any student in a few taps. The shared count updates instantly across the whole school." },
  { n: "3", t: "Notices go home automatically", d: "When a student hits the threshold (or an immediate behaviour is logged), a clear, history-aware note goes to the parents — and the VP when it's a repeat." },
];

const TEACHER_STEPS = [
  { t: "Sign in", d: "Use your school account. If you were invited, open the invite email, set your password, and you're in." },
  { t: "Tap “Log an incident”", d: "From your dashboard, hit the big Log button — it's built to work one-handed on a phone while you're still in the room." },
  { t: "Find the student", d: "Search by name (any student in the school) and tap them. No need to teach them — if you saw it, you can log it." },
  { t: "Pick the behaviour(s) and submit", d: "Tap one or more behaviours, add an optional note, and submit. Most behaviours add to the student's shared strike count; ones marked “immediate” notify the parent on the spot." },
  { t: "Watch the result", d: "If that incident reaches the threshold, you'll see a notice was triggered — with a short window to cancel the send if it was a mistake." },
  { t: "Check status & history", d: "Open a student any time to see their current strikes across all teachers and every note that's gone home." },
  { t: "Catch the good too", d: "Log positive behaviours the same way — they earn the student's house points and are documented, but never count as a strike. Enough of them triggers a good-news note home on their own." },
  { t: "Log a group in one go", d: "On the Log screen, tap “Several students” to apply one behaviour to a whole group at once — handy for a quick “not ready for class.”" },
  { t: "Clear your morning follow-ups", d: "Each morning you'll get a “Reminder for today” list of consequences to check off — mark each Done, Not done, or Waived." },
];

export default function FeaturesPage() {
  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">Behaviours</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          One shared behaviour count per student — across every teacher.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          When each teacher tracks strikes separately, a student can misbehave all day and never
          hit a consequence. Behaviours aggregates every incident per student across the whole
          school, then notifies parents the moment a threshold is reached.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/behavior" className="rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white">
            Open the app
          </Link>
          <Link href="/behavior/setup" className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700">
            Set up your school
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900">How it works</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-3 font-semibold text-slate-900">{s.t}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900">What it does</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For teachers */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900">For teachers — how to use it</h2>
        <ol className="mt-4 space-y-3">
          {TEACHER_STEPS.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-slate-900">{s.t}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Good to know</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>You can log <span className="font-medium">any</span> student in the school — not just your own class.</li>
            <li>The count is <span className="font-medium">shared</span>: your strike adds to whatever other teachers have logged today.</li>
            <li>When a notice fires you get a brief window to <span className="font-medium">cancel</span> before it sends.</li>
            <li>Open a student to see their full cross-teacher status and every past notice.</li>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-2xl border border-slate-200 bg-slate-900 p-7 text-center text-white">
        <h2 className="text-2xl font-bold">Ready to make expectations consistent?</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-300">
          Set up your division in minutes — upload your roster, invite your staff, and start logging.
        </p>
        <Link
          href="/behavior/setup"
          className="mt-5 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-slate-900"
        >
          Get started
        </Link>
      </section>

      <p className="pb-6 text-center text-xs text-slate-400">
        Behaviours stores sensitive student information. Access is role-based and every notice is
        audit-logged. Ask your administrator about your board&apos;s privacy approval before go-live.
      </p>
    </div>
  );
}
