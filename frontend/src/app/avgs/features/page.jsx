// src/app/avgs/features/page.jsx
//
// Public features/overview page for the Weighted Averages tool at /avgs.
// Mirrors /behavior/features: public marketing copy + a login-gated setup
// guide (GuideGated) for the Edsby honour-roll mode.

import Link from "next/link";
import GuideGated from "./GuideGated";

export const metadata = {
  title: "Weighted Averages — Features",
  description:
    "Turn a pile of report cards into ranked weighted averages. Drop one PDF of every student, or pull grades live from Edsby, weight each class by how often it meets, and see who makes Honours.",
};

const STEPS = [
  { n: "1", t: "Get the grades in", d: "Drop one big PDF of every report card (any size, scans included) — or skip the PDF and pull current grades straight from Edsby." },
  { n: "2", t: "Weight each class", d: "A class that meets twice a week shouldn't count like one that meets four times. Weights come pre-guessed from each class — every one editable." },
  { n: "3", t: "Read the rankings", d: "Students ranked by weighted average within each grade level, with Honours and High Honours called out. Export the CSV for the assembly list." },
];

const FEATURES = [
  {
    title: "Dump the whole PDF",
    body: "Drag one file holding every student's report card onto the page — hundreds of pages are fine. Text pages are read directly; scanned pages are handled too. CSV, text and photos also work.",
  },
  {
    title: "Final grades only",
    body: "AI pulls each student's final grade per course and ignores the noise — term marks when a final exists, comments, learning-skills ratings, attendance.",
  },
  {
    title: "Days-per-week weighting",
    body: "Weight = days the class meets ÷ 5. Math at 4×/week counts 0.8; Art at 2×/week counts 0.4; PE at 1×/week counts 0.2; Career Education meets daily but counts at half value (0.5). The rules are right on the page — edit them before you run.",
  },
  {
    title: "Letter grades and proficiency scales",
    body: "A−, B+, Proficient, Extending — all converted to percentages on a standard scale so every course can join the average. Grades that can't convert (like “Incomplete”) are left out rather than counted as zero.",
  },
  {
    title: "Exact arithmetic",
    body: "The AI extracts; the math is computed in code. Weighted average = Σ(grade × weight) ÷ Σ(weight), to the decimal, every time.",
  },
  {
    title: "Ranked by grade level",
    body: "Results group by grade and rank highest to lowest, with each student's full course breakdown — grade, days/week, weight — one click away. Download everything as CSV.",
  },
  {
    title: "Honour roll, live from Edsby",
    body: "Signed-in staff can skip the upload: probe Edsby once to discover every class in your grade range, set the weights and thresholds, then refresh on demand to see who currently makes Honours (≥ 80) and High Honours (≥ 90) — your numbers, your call.",
  },
  {
    title: "Knows what it doesn't know",
    body: "Students missing an Edsby ID are named after every refresh, unrecognized classes are flagged for review, and an expired Edsby session says so plainly — no silent gaps in the honour roll.",
  },
];

export default function AvgsFeaturesPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">Weighted Averages</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          From a pile of report cards to a ranked honour roll.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          A straight average treats a once-a-week class like daily Math. This tool weights every
          course by how often it meets, computes each student&apos;s true weighted average — from one
          dropped PDF or live from Edsby — and ranks every grade level in seconds.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/avgs" className="rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white">
            Open the tool
          </Link>
          <Link href="#guide" className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700">
            Setup guide
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

      {/* Edsby honour-roll setup — only for signed-in staff */}
      <GuideGated />

      {/* CTA */}
      <section className="rounded-2xl border border-slate-200 bg-slate-900 p-7 text-center text-white">
        <h2 className="text-2xl font-bold">Got the report cards?</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-300">
          Drop the PDF and have every grade level ranked before your coffee cools.
        </p>
        <Link href="/avgs" className="mt-5 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-slate-900">
          Try it now
        </Link>
      </section>

      <p className="pb-6 text-center text-xs text-slate-400">
        Report cards stay on your screen except for the grade text/pages sent for AI extraction;
        the Edsby honour roll is sign-in only and reuses your school&apos;s encrypted Edsby connection.
      </p>
    </main>
  );
}
