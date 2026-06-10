"use client";

// Login-gated portion of the /avgs guide. The feature overview above is
// public; the Edsby honour-roll *setup* steps are operational detail for
// signed-in staff only (they reference the school's Edsby connection and
// roster). Renders only a sign-in prompt when signed out.

import { getToken, loginHref } from "../../behavior/_lib/api";
import { useEffect, useState } from "react";

const SETUP_STEPS = [
  {
    t: "Be part of a Behaviours school",
    d: "The honour roll reuses the Behaviours roster and Edsby connection. If your account isn't in a Behaviours school yet, set that up first at /behavior/setup (or ask your admin for an invite).",
  },
  {
    t: "Connect Edsby (admin, once)",
    d: "In Behaviours Setup → Edsby, paste your Edsby base URL and session cookie — stored encrypted, never shown again. Install the Cookie Sync browser extension so the session stays fresh without re-pasting.",
  },
  {
    t: "Extract student IDs (one button)",
    d: "Each student needs their internal Edsby ID on file. If any are missing, an amber “Extract student IDs” button appears on /avgs — it pulls the student list from Edsby through your session and matches names to the roster automatically. Anyone it can't match (name spelled differently, ambiguous twins) is listed so you can fix the roster name and run it again.",
  },
  {
    t: "Probe classes",
    d: "On /avgs, sign in and hit “Probe classes.” It samples a few students per grade from Edsby and discovers every class they take. Edsby doesn't tell us how often a class meets, so each one gets a days/week guess from its name — Math 4×, Art 2×, PE 1×, Career Education daily-but-half.",
  },
  {
    t: "Review weights, then Save",
    d: "Open “Class weights” and fix any guess: set days/week (weight becomes days ÷ 5), override the weight directly for special cases (CE = 0.5), or untick a class to leave it out entirely. Classes flagged “unrecognized — review” deserve a look.",
  },
  {
    t: "Set the bar",
    d: "Pick the grade range (default 6–8) and the thresholds — Honours ≥ 80 and High Honours ≥ 90 out of the box. Both are your call; Save keeps them.",
  },
  {
    t: "Refresh on demand",
    d: "“Refresh from Edsby” pulls every in-range student's current grades right now and ranks them by weighted average within each grade, with Honours / High Honours badges. Run it before assemblies, report-card windows, or whenever you want the live picture. Download CSV for the printable list.",
  },
];

const TROUBLE = [
  ["“Edsby session cookie has expired”", "Open Edsby in your browser and sign in — the Cookie Sync extension pushes the fresh session automatically. Or re-paste the cookie in Behaviours Setup."],
  ["“No students … have an Edsby nid”", "Student Edsby IDs haven't been extracted yet — hit the amber “Extract student IDs” button on /avgs. It needs the Zoom id saved in Behaviours Setup → Edsby (open My Students in Edsby; the number in the page URL is the Zoom id)."],
  ["Some students show “no course data found”", "Edsby's grade view varies by school. The refresh result includes diagnostics describing exactly what Edsby returned — pass them along and the probe can be tuned to your school without touching your setup."],
];

export default function GuideGated() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!getToken());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!authed) {
    return (
      <section id="guide" className="rounded-2xl border border-slate-200 bg-slate-50 p-7">
        <h2 className="text-xl font-semibold text-slate-900">Honour-roll setup guide</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          The step-by-step guide for connecting Edsby and running the live honour roll is for
          signed-in staff.{" "}
          <a className="font-medium text-blue-600 hover:underline" href={loginHref("/avgs/features")}>
            Sign in
          </a>{" "}
          to see it.
        </p>
      </section>
    );
  }

  return (
    <section id="guide">
      <h2 className="text-xl font-semibold text-slate-900">Honour roll from Edsby — setup guide</h2>
      <ol className="mt-4 space-y-3">
        {SETUP_STEPS.map((s, i) => (
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
        <p className="font-semibold">If something doesn&apos;t look right</p>
        <ul className="mt-1 space-y-1.5">
          {TROUBLE.map(([q, a]) => (
            <li key={q}>
              <span className="font-medium">{q}</span> — {a}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
