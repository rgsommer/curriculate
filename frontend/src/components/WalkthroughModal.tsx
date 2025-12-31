"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Step = {
  title: string;
  body: React.ReactNode;
};

const STORAGE_KEY = "curriculate_walkthrough_v1_dismissed";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** --- Simple inline SVG icons (currentColor) --- */
function IntroIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 22h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BuildIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 8h10M7 12h6M7 16h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 5l6 7-6 7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="5" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function StationsIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 11v2M16 11v2M10 16h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CaptureIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h12v18H6z" stroke="currentColor" strokeWidth="2" />
      <path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShell({
  accentText,
  accentBg,
  accentRing,
  children,
}: {
  accentText: string;
  accentBg: string;
  accentRing: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex justify-center">
      <div
        className={`transition-colors duration-300 rounded-2xl p-3 ring-1 ${accentRing} ${accentBg}`}
      >
        <div className={`transition-colors duration-300 ${accentText}`}>{children}</div>
      </div>
    </div>
  );
}

export default function WalkthroughModal({
  open,
  onClose,
  startAt = 0,
  showDontShowAgain = true,
}: {
  open: boolean;
  onClose: () => void;
  startAt?: number;
  showDontShowAgain?: boolean;
}) {
  // Your step copy (unchanged) — icons are rendered outside the body so we can color-shift safely.
  const steps: Step[] = useMemo(
    () => [
      {
        title: "What this is",
        body: (
          <div className="space-y-2">
            <p>
              Curriculate runs a simple loop: <b>Build</b> → <b>Launch</b> → <b>Stations</b> →{" "}
              <b>Capture</b> → <b>Reports</b>.
            </p>
            <p className="text-slate-600">
              This is a 60-second walkthrough. You’ll know the whole flow by the end.
            </p>
          </div>
        ),
      },
      {
        title: "1) Build a task set",
        body: (
          <div className="space-y-2">
            <p>
              Enter your topic, grade level, difficulty level, purpose, and (most importantly) paste in
              a list of words or concepts you want to teach or review.
            </p>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-black/5">
              Tip: Start with putting up <b>8 station posters</b>.
            </div>
          </div>
        ),
      },
      {
        title: "2) Launch a live session",
        body: (
          <div className="space-y-2">
            <p>
              Start the session on the teacher screen. Teams join quickly (scan/code). They enter a
              team name of their choice and their names. Pacing is fully automatic. Students scan their
              device at one station, complete the task shown, then scan at the next assigned station.
            </p>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-black/5">
              Everything is tracked while students work — no extra “teacher busywork. It's a teacher's
              dream!”
            </div>
          </div>
        ),
      },
      {
        title: "3) Stations + teamwork",
        body: (
          <div className="space-y-2">
            <p>
              Students rotate station-by-station. One device per team is enough—others can watch/assist.
              Some tasks are done as a group. Some have them compete with eachother or with other teams.
            </p>
            <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
              <b>Devices:</b> Phones work, but the best experience is{" "}
              <b>~1 tablet per 3 students</b> (one tablet per team). Many schools already have carts/roaming
              sets.
            </div>
          </div>
        ),
      },
      {
        title: "4) Work is captured automatically",
        body: (
          <div className="space-y-2">
            <p>
              Answers are saved by station and task type. Optional scoring/feedback can be generated
              automatically. Some tasks automatically submit recorded or photo evidence to the teacher.
            </p>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-black/5">
              No paper chase after class—everything is already organized <b>and assessed</b>.
            </div>
          </div>
        ),
      },
      {
        title: "5) Reports + reuse",
        body: (
          <div className="space-y-3">
            <p>
              End the session and you get clear reporting: whole-class overview, plus team/student detail
              (based on plan). Teachers receive a grade and feedback for each student automatically.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/how-it-works"
                className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-black/10 hover:bg-slate-50"
              >
                See the visual “How it Works” page
              </Link>
              <Link
                href="/demo"
                className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:brightness-105"
              >
                Try the demo
              </Link>
            </div>
          </div>
        ),
      },
    ],
    []
  );

  // icon per step (intro + 5 steps)
  const icons = useMemo(
    () => [
      <IntroIcon key="i0" />,
      <BuildIcon key="i1" />,
      <LaunchIcon key="i2" />,
      <StationsIcon key="i3" />,
      <CaptureIcon key="i4" />,
      <ReportIcon key="i5" />,
    ],
    []
  );

  const [idx, setIdx] = useState(startAt);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Reset to startAt whenever opened
  useEffect(() => {
    if (open) setIdx(startAt);
  }, [open, startAt]);

  // Progress & color accent (derived from idx only — avoids circular deps)
  const progress = Math.round(((idx + 1) / steps.length) * 100);

  function accentForIdx(i: number) {
    // 0-1: emerald, 2-3: indigo, 4-5: rose (tweak if you want)
    if (i >= 4)
      return { text: "text-rose-600", bar: "bg-rose-500", ring: "ring-rose-200", bg: "bg-rose-50" };
    if (i >= 2)
      return {
        text: "text-indigo-600",
        bar: "bg-indigo-500",
        ring: "ring-indigo-200",
        bg: "bg-indigo-50",
      };
    return {
      text: "text-emerald-600",
      bar: "bg-emerald-500",
      ring: "ring-emerald-200",
      bg: "bg-emerald-50",
    };
  }

  const accent = accentForIdx(idx);

  // Subtle fade/slide animation on each step change
  const [animateIn, setAnimateIn] = useState(false);
  const lastIdxRef = useRef<number>(startAt);

  useEffect(() => {
    if (!open) return;
    if (lastIdxRef.current !== idx) lastIdxRef.current = idx;

    setAnimateIn(false);
    const t = window.setTimeout(() => setAnimateIn(true), 20);
    return () => window.clearTimeout(t);
  }, [open, idx]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dontShowAgain]);

  function handleClose() {
    if (dontShowAgain) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {}
    }
    onClose();
  }

  function next() {
    setIdx((v) => clamp(v + 1, 0, steps.length - 1));
  }

  function back() {
    setIdx((v) => clamp(v - 1, 0, steps.length - 1));
  }

  if (!open) return null;

  const step = steps[idx];

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <button
        aria-label="Close walkthrough"
        onClick={handleClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
          {/* Header */}
          <div className="border-b bg-white px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  Walkthrough • {idx + 1} of {steps.length}
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900">{step.title}</div>
              </div>
              <button
                onClick={handleClose}
                className="rounded-2xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {/* Progress bar (color-shifts with idx) */}
            <div className="mt-4 h-2 w-full rounded-full bg-slate-100">
              <div
                className={`h-2 rounded-full transition-all ${accent.bar}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 text-sm leading-relaxed text-slate-800">
            <div
              className={[
                "transition-all duration-300 ease-out",
                animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              ].join(" ")}
            >
              <IconShell accentText={accent.text} accentBg={accent.bg} accentRing={accent.ring}>
                {icons[idx] ?? <IntroIcon />}
              </IconShell>

              {step.body}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-3 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {showDontShowAgain && (
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Don’t show this again
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={handleClose}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-black/10 hover:bg-slate-50"
              >
                Skip
              </button>
              <button
                onClick={back}
                disabled={idx === 0}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-black/10 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={idx === steps.length - 1 ? handleClose : next}
                className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-105"
              >
                {idx === steps.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper you can use anywhere
export function isWalkthroughDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
