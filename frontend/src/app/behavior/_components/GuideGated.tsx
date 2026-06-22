"use client";

// Login-gated portion of the Guide. The marketing copy above is public, but the
// Houses, Edsby and student-portal *setup* details are only shown to signed-in
// staff (they're operational, not a sales pitch). Renders nothing meaningful on
// the server / when signed out, so search engines and the public see only the
// feature overview.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken, loginHref } from "../_lib/api";

const HOUSES = [
  {
    title: "Houses & points",
    body: "Define houses (name + colour) and assign students by import or in Setup. Any behaviour can carry points — negative deducts for an offence, positive rewards a good one — and they roll straight onto a live leaderboard on the dashboard. Award points to a whole house at once for a spirit day.",
  },
  {
    title: "Balanced auto-assign",
    body: "One click sorts every student into four houses, balancing grade and gender and keeping same-last-name students (siblings) together. A “rebalance only unassigned” mode slots in new students mid-year without reshuffling everyone.",
  },
  {
    title: "House captains",
    body: "Mark a student leader for each house in Setup. Captains appear on the standings report and on the student portal (first name + last initial only).",
  },
  {
    title: "Monthly competitions (Sept–June)",
    body: "A built-in calendar of house events (quiz, kindness marathon, mini-Olympics, spirit week…). Scoring an event awards capped placement points (1st 500 / 2nd 300 / 3rd 200 / 4th 100) on top of everyday points, so a single event can't run away with the year.",
  },
  {
    title: "Student leaderboard portal",
    body: "Students see live standings, recent points and competition results at curriculate.net/houses by entering a short school code — house-level totals only, no student names. Set your own code (e.g. 1977); it's shown right on the dashboard.",
  },
  {
    title: "Term reset",
    body: "Start a new term in Setup to zero the standings from that date forward — earlier points stay in history but stop counting toward the leaderboard and competitions.",
  },
  {
    title: "House standings report",
    body: "Turn on an email report that ranks the houses by total points, names each house's captains, and lists the top 3 contributing students — send it on demand for assemblies or the newsletter.",
  },
];

const EDSBY = [
  {
    title: "Connect Edsby in Setup",
    body: "Paste your Edsby base URL and session cookie in Setup → Edsby. The cookie is stored encrypted and never sent back to the browser. Use “Test connection” to confirm and refresh the form key.",
  },
  {
    title: "Keep your session fresh (browser extension)",
    body: "Edsby cookies are HttpOnly, so they can't be read by a page. A small browser extension (download in Setup) pushes a fresh cookie and the jver/cver version headers into the app for you — so notices keep delivering without you re-pasting.",
  },
  {
    title: "Reliable delivery",
    body: "The Edsby form key is refreshed before each broadcast so posts don't fail on a stale session. If an Edsby post does fail, it's recorded as failed for you to retry — it falls back to a parent's email only if your division has opted into email (so families are never emailed by surprise).",
  },
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
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Houses, Edsby &amp; portal setup</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-slate-600">
          The setup details for the optional house system, Edsby delivery and the student leaderboard portal are shown to
          signed-in staff.
        </p>
        <Link href={loginHref("/behavior/features")} className="mt-4 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
          Sign in to view
        </Link>
      </section>
    );
  }

  return (
    <>
      {/* Houses — its own section */}
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600 text-sm text-white">🏆</span>
          <h2 className="text-xl font-semibold text-slate-900">Houses &amp; house points</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          An optional house system that turns everyday behaviour into team spirit — rewarding the good, not just policing
          the bad. Toggle it on in Setup; when it&apos;s off, the whole house aspect stays hidden.
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

      {/* Edsby & delivery */}
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm text-white">✉️</span>
          <h2 className="text-xl font-semibold text-slate-900">Edsby &amp; delivery setup</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Notices deliver over email on day one. Connecting Edsby lets notes post straight to parents there too.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {EDSBY.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
