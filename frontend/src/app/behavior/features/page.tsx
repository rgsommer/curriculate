// src/app/behavior/features/page.tsx
//
// The Guide — a complete, administrator-ready overview of what Behaviours does.
// Reachable at /behavior/features. Includes a Print / Save-as-PDF button.

import Link from "next/link";
import GuideGated from "../_components/GuideGated";
import PrintButton from "../_components/PrintButton";

export const metadata = {
  title: "Behaviours — Guide & overview",
  description:
    "A school-wide, pastoral approach to behaviour: cross-teacher tracking of positives and negatives, early intervention, and parent communication that a teacher always reviews and sends — never auto-sent.",
};

// What it does — grouped, accurate to how it works today (nothing auto-sends).
const TRACKING = [
  {
    title: "One shared count per student — across every teacher",
    body: "Incidents pool per student, not per teacher. Two concerns with each of six teachers still add up. No more slipping through the cracks because everyone counted separately — and no teacher is left fighting a pattern alone.",
  },
  {
    title: "Positives and negatives, side by side",
    body: "Every log is ✓ Positive or ✕ Negative. Negatives accumulate toward a threshold; positives are recognised, earn house points, and can trigger a good-news note home — they never count against a student.",
  },
  {
    title: "Catch patterns early",
    body: "The dashboard surfaces “Students to encourage” (at or one away from a threshold) so staff can step in supportively before things escalate — a quiet word or a check-in while the trend can still turn around.",
  },
  {
    title: "A fade window, not a permanent record-against",
    body: "Older incidents stop counting toward the threshold after a configurable window (e.g. 30 days), so a student isn't punished forever — though the full history is always kept for context.",
  },
  {
    title: "Documented, defensible records",
    body: "Each incident snapshots the wording at log time, who logged it, and any private teacher notes. Edit, correct, or undo with a full audit trail. A clean record protects students and staff alike.",
  },
  {
    title: "Trends & summaries",
    body: "Per-student red/green timelines, division reports by behaviour / class / month, and AI summaries that fairly reflect offences, positives, interactions and follow-through.",
  },
  {
    title: "Leadership insights (admin)",
    body: "A read-only School Insights view: the 6-month behaviour trend, students at or near a notice, students to get ahead of (rising in the last two weeks), most-logged, by-class totals, and staff activity — with a gentle flag for teachers who may welcome support (a heavy offence load with few positives), never a performance verdict.",
  },
  {
    title: "Weekly admin digest",
    body: "Opt-in: a Monday email to leadership summarising the week — offences/positives/notices, who's at or nearing a notice, students to get ahead of, and supportive suggestions for staff — so the picture comes to you without logging in.",
  },
];

const COMMUNICATION = [
  {
    title: "Nothing is sent automatically",
    body: "When a threshold is reached, the app PREPARES a message — it does not send it. The teacher reviews the exact wording, edits it freely, and explicitly presses Send. If they do nothing, nothing goes out.",
  },
  {
    title: "A pastoral, tailored message — not a form letter",
    body: "Each proposed note is written for this student and this situation: it names the behaviour plainly and respectfully, adapts its tone to the history (gentler on a first contact), and can suggest constructive next steps. The one-size-fits-all standard letter is gone.",
  },
  {
    title: "Parents recognise who it's from",
    body: "By default the proposed note is emailed to the teacher with a recommendation to post it to Edsby, so families recognise the sender — signed by the actual teacher(s), addressed to the parent by name, never a stray placeholder. Direct email to families is off unless an admin deliberately turns it on.",
  },
  {
    title: "Leadership looped in — on your terms",
    body: "Copy the VP never, on the first notice, or (default) on the second-and-later — your choice in Setup. A second notice forming is exactly when leadership should know.",
  },
  {
    title: "Evidence only if you choose",
    body: "A teacher can attach a photo/video (kept private to the record) and decide, per message, whether to share it with the parent or keep it staff-side. Default: kept staff-side.",
  },
  {
    title: "Request a meeting in one tick",
    body: "Before sending, a teacher can add a request to meet — woven into the note — so a concern becomes a conversation, not just a notification.",
  },
];

// Worked examples — concrete flows that show how the pieces fit together.
const SCENARIOS = [
  {
    title: "1 · A concern builds across two teachers",
    steps: [
      "Mr. Okafor logs a negative (disrupting the lesson) for Jordan.",
      "Ms. Bennett logs a positive (helped a classmate) — it's recorded and earns house points, but it does not cancel out the concern.",
      "Later, Mr. Okafor logs another negative, and Jordan reaches the division's threshold.",
    ],
    outcome:
      "A tailored, respectful note home is prepared and handed to Mr. Okafor to review, edit and send — nothing goes out until he does. Both teachers' entries (the concern and the praise) stay on Jordan's record, so the picture is fair.",
  },
  {
    title: "2 · Catching a student doing well",
    steps: [
      "Three different teachers — Ms. Bennett, Mr. Singh and Mrs. Adeyemi — each log a positive for Jordan over a couple of weeks.",
      "Jordan crosses the good-news threshold.",
    ],
    outcome:
      "A warm, affirming note is prepared for the most recent teacher (Mrs. Adeyemi), naming all three teachers' praise and copying the other two. She reviews it and sends it home — good news only, no concerns, no points mentioned.",
  },
  {
    title: "3 · A repeat pattern, with a recommended consequence",
    steps: [
      "Mr. Okafor logs three negatives for Jordan over several weeks.",
      "The first passes the 30-day fade window, so it stops counting toward the threshold (it stays in the history).",
      "A fourth negative comes in — the active count reaches the threshold again, and Jordan has already had a notice home this period.",
    ],
    outcome:
      "Because it's a repeat, the prepared note recommends sending via Edsby and copying the VP. Alongside it, the recommended-actions panel shows the objective step (e.g. a white slip) plus AI coaching from your approved list (e.g. a 200-word reflection, or a detention) with a short rationale. Mr. Okafor reviews, adjusts, and sends.",
  },
];

const ACTIONS = [
  {
    title: "An objective consequence ladder",
    body: "Admins define a rule-based ladder by notice number — e.g. 2nd notice → white slip, 3rd → in-school suspension. It shows up automatically on the dashboard and the student's page so consequences are consistent and predictable.",
  },
  {
    title: "AI coaching — from your approved list only",
    body: "Given the pattern of behaviour, the app can suggest next steps in a supportive, coaching tone (meet with the student, restorative task, loss of a privilege, refer to the VP…). It only ever proposes consequences your admin has pre-approved — it never invents its own — and the teacher decides.",
  },
  {
    title: "Privileges — lost and earned",
    body: "Consequences can include losing a privilege (a place on a sports team, a year-end class/field trip). On the positive side, exemplary behaviour earns privileges — and the winning house can earn a reward outing (e.g. a day at Wonderland).",
  },
  {
    title: "Uniform infractions & the GUDD",
    body: "Flag a behaviour as a uniform infraction and it counts as a normal strike and toward losing the Good Uniform Dress Down (GUDD). Admins set the threshold, a separate fade window, and an escalation ladder — once the GUDD is lost, each further infraction triggers the next consequence. An always-visible GUDD indicator (green / amber / red) shows on the teacher's logging view and the student page, and leadership sees who's lost it or is at risk in School Insights.",
  },
];

const HOUSES = [
  {
    title: "Behaviour feeds house spirit",
    body: "Positive behaviour earns house points; negatives can cost them (your choice per behaviour). The everyday work of citizenship becomes a shared, visible team effort rather than only a record of problems.",
  },
  {
    title: "A live, student-facing leaderboard",
    body: "Students follow standings, recent points and monthly competitions at a code-protected portal — house-level totals only, never individual names or records.",
  },
  {
    title: "Reward the behaviour, not just the house",
    body: "Because everything is tracked per student, the winning-house reward can be merit-based: include a student from another house whose conduct was exemplary, and hold back a student in the winning house whose conduct fell short. The privilege follows the behaviour.",
  },
];

const HOMEWORK = [
  {
    title: "Homework, class work & formal discussions",
    body: "A Homework tab tracks completion per class and subject: a single tap marks work shown (auto-scoring by how late it is), with excused (E) and edit options. Formal discussions are scored live — tap +/− as students speak, with a built-in fair-turns rule.",
  },
  {
    title: "Outstanding-work reminders & term reports",
    body: "See who has fallen behind (current + previous term) and send a supportive “catch-up” note home. End-of-term reports show class averages and each student's mark, and export to a CSV ready for Edsby import.",
  },
];

const SAFEGUARDS = [
  "No notice ever reaches a parent without a teacher reading the final wording and pressing Send.",
  "Edsby-first delivery so families recognise the sender; direct email to parents is off by default.",
  "Role-based access: teachers log & view; only admins change Setup; the principal gets a read-only overview.",
  "Every notice and change is audit-logged. Sensitive roster fields (e.g. ethnicity) are never stored.",
  "Photo/video evidence is stored privately and is never sent to a parent unless the teacher opts in for that message.",
  "Encrypted in transit (HTTPS) and at rest; secrets like Edsby session credentials are stored AES-256 encrypted and never shown again.",
  "Data residency: storage can be set to keep data in the school's country of origin (e.g. a Canadian data region), in compliance with local data-residency and privacy requirements (such as PIPEDA in Canada).",
];

const TEACHER_STEPS = [
  { t: "Sign in", d: "Use your school account. Invited staff open the invite email, set a password, and they're in." },
  { t: "Tap “Log an incident”", d: "Works on any device or desktop — one-handed on a phone while you're still in the room, or at your desk later. Search any student in the school — if you saw it, you can log it." },
  { t: "Pick positive or negative, then the behaviour", d: "Add an optional note (and a photo/video if helpful). Most behaviours add to the shared count; serious ones flag immediately." },
  { t: "Decide on the message", d: "If a threshold is reached, you're shown the proposed note. Edit it, choose whether to copy the VP or include evidence, then Send — or “Not this time”, which keeps the strikes for next time." },
  { t: "Use the supports", d: "Open a student for their full cross-teacher history, the recommended next action, AI coaching, and a printable record. Clear your morning follow-ups as consequences come due." },
];

export default function FeaturesPage() {
  return (
    <div className="space-y-10">
      {/* Print styling — makes the browser's "Save as PDF" of this page look
          like the designed leadership document (color bands, teal headings,
          card boxes), while staying live. */}
      <style>{`@media print {
        @page { margin: 1.4cm 1.5cm; }
        .no-print { display: none !important; }
        nav, header, footer { display: none !important; }
        html, body { background: #fff !important; }
        /* Print the background fills (callouts, cards, title band). */
        *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        a { color: inherit !important; text-decoration: none !important; }
        /* Dark title band like the document. */
        #guide-hero { background: #0f172a !important; border: none !important; box-shadow: none !important; }
        #guide-hero h1, #guide-hero p { color: #ffffff !important; }
        #guide-hero .uppercase { color: #cbd5e1 !important; }
        /* Teal section headings with an accent underline. */
        section > h2 { color: #0f766e !important; border-bottom: 2px solid #99f6e4; padding-bottom: 3px; }
        /* Keep cards and examples from splitting across pages. */
        .rounded-xl, .rounded-2xl { break-inside: avoid; page-break-inside: avoid; }
        h1, h2, h3 { break-after: avoid; }
        .space-y-10 > * + * { margin-top: 1rem !important; }
      }`}</style>

      {/* Hero */}
      <section id="guide-hero" className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">Behaviours — Guide &amp; overview</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          A school-wide, pastoral approach to behaviour.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Behaviours helps a whole staff support students together: it tracks the positive and the negative across
          every teacher, catches patterns early, keeps clear records, and turns a concern into a thoughtful,
          teacher-written message home — one a teacher always reviews and sends. Nothing is ever sent automatically.
        </p>
        <div className="no-print mt-5 flex flex-wrap gap-3">
          <Link href="/behavior" className="rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white">Open the app</Link>
          <Link href="/behavior/setup" className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700">Set up your school</Link>
          <PrintButton className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700" />
        </div>
      </section>

      {/* For administrators — addresses the messaging concern head-on */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">For administrators: how messaging home works</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-900/90">
          The biggest worry with any behaviour system is automated, impersonal messages going to families. Behaviours is
          built the other way around. When a threshold is reached, the app <strong>prepares</strong> a message and hands
          it to the teacher — it never sends on its own. The teacher reads the exact wording, edits it freely, and
          decides whether (and how) to send. Modern composition means we can do far better than a standard form letter:
          each note is <strong>pastoral and specific</strong> — it names the behaviour plainly and respectfully, reflects
          the student's history, and can suggest constructive next steps. By default it's <strong>emailed to the teacher with
          a recommendation to post it to Edsby</strong>, so families recognise the sender and it's <strong>signed by the
          actual teacher</strong>. Leadership is copied on
          your schedule (off / first notice / second-and-later). In short: the school's voice, the teacher's judgement,
          a kinder message — with the efficiency and consistency of shared tracking behind it.
        </p>
      </section>

      <Group title="Tracking, documenting & catching things early" items={TRACKING} />
      <Group title="Communication home — reviewed and sent by a teacher" items={COMMUNICATION} />

      {/* Worked examples */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900">What it looks like in practice</h2>
        <div className="mt-4 space-y-4">
          {SCENARIOS.map((s) => (
            <div key={s.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">{s.title}</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                {s.steps.map((st, i) => <li key={i}>{st}</li>)}
              </ol>
              <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-semibold">Result:</span> {s.outcome}</p>
            </div>
          ))}
        </div>
      </section>

      <Group title="Recommended actions & consequences" items={ACTIONS} />

      {/* Houses */}
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600 text-sm text-white">🏆</span>
          <h2 className="text-xl font-semibold text-slate-900">Houses &amp; a culture of citizenship</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          An optional house system that turns everyday behaviour into shared team spirit — rewarding the good, not just
          policing the difficult.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {HOUSES.map((f) => (
            <div key={f.title} className="rounded-xl border border-green-200 bg-green-50/50 p-5">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Group title="Homework, class work & discussions" items={HOMEWORK} />

      {/* Safeguards */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Privacy &amp; safeguards</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          {SAFEGUARDS.map((s, i) => (
            <li key={i} className="flex gap-2"><span className="text-emerald-600">✓</span><span>{s}</span></li>
          ))}
        </ul>
      </section>

      {/* For teachers */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900">For teachers — the everyday flow</h2>
        <ol className="mt-4 space-y-3">
          {TEACHER_STEPS.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{i + 1}</span>
              <div>
                <p className="font-semibold text-slate-900">{s.t}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Houses / Edsby / portal SETUP detail — only for signed-in staff, and
          kept out of the printed overview (operational, not for the VP doc). */}
      <div className="no-print">
        <GuideGated />
      </div>

      <p className="pb-6 text-center text-xs text-slate-400">
        Behaviours stores sensitive student information. Access is role-based and every notice is audit-logged. Ask your
        administrator about your board&apos;s privacy approval before go-live.
      </p>
    </div>
  );
}

function Group({ title, items }: { title: string; items: { title: string; body: string }[] }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((f) => (
          <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
