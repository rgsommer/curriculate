"use client";

import { useState } from "react";
import Link from "next/link";

// A lightweight guided tour of Behaviours for teachers — a step-through overlay,
// no external library. Launched from the header; remembers nothing, so it can be
// re-run any time.
const STEPS: { title: string; body: string }[] = [
  {
    title: "Welcome to Behaviours 👋",
    body: "One shared picture of every student across all teachers. You log what you see; the app spots patterns, prepares pastoral notes home for you to review, and keeps fair, defensible records. Nothing is ever sent to a parent automatically.",
  },
  {
    title: "1 · Log an incident",
    body: "Tap “Log” (top bar). Search any student in the school, choose ✓ Positive or ✕ Negative, pick the behaviour, add an optional note or photo, and submit. Works one-handed on a phone or at your desk. The behaviours you use most rise to the top.",
  },
  {
    title: "2 · Strikes & notices home",
    body: "Negatives add to a shared count. At the threshold you’re shown a ready-to-send, tailored note — you review/edit it and press Send (or “Not this time”). It reaches families over Edsby by default, signed by you. You always get your own copy first.",
  },
  {
    title: "3 · Catch the good too",
    body: "Positives are recognised, earn house points, and enough of them sends a good-news note home. They never count against a student.",
  },
  {
    title: "4 · Uniform & the GUDD",
    body: "Some offences are uniform infractions: they count as a normal strike and toward losing the Good Uniform Dress Down. A coloured GUDD chip (green / amber / red) shows where a student stands, with the next consequence once it’s lost.",
  },
  {
    title: "5 · Record consequences",
    body: "On a student’s page you can document a consequence you actually gave — a work detention, white slip, call home, and so on. It’s kept in the record and folded into the summaries.",
  },
  {
    title: "6 · The student page",
    body: "Open any student for their full cross-teacher history, the recommended next action, an AI summary for admin (copies to your clipboard), a printable record, and the “Current log” jump.",
  },
  {
    title: "7 · Homework & reports",
    body: "The Homework tab tracks completion, runs live-scored formal discussions, sends outstanding-work reminders, and produces end-of-term reports that export to Edsby.",
  },
  {
    title: "Need help or have an idea?",
    body: "Use the 💬 Feedback button (bottom-right) any time to request changes or report something — it goes straight to your admins. The Guide has the full walkthrough.",
  },
];

export default function TourButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  function start() { setI(0); setOpen(true); }

  return (
    <>
      <button onClick={start} className={className || "text-slate-600 hover:text-slate-900"}>Tour</button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Step {i + 1} of {STEPS.length}</span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
            </div>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {STEPS.map((_, j) => (
                <span key={j} className={`h-1.5 w-1.5 rounded-full ${j === i ? "bg-slate-800" : "bg-slate-300"}`} />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">Back</button>
              {last ? (
                <Link href="/behavior/features" onClick={() => setOpen(false)}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">Open the Guide</Link>
              ) : (
                <button onClick={() => setI((x) => Math.min(STEPS.length - 1, x + 1))}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">Next</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
