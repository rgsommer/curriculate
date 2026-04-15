"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";

import introAnim from "@/assets/modal/intro.json";
import buildAnim from "@/assets/modal/card1.json";
import launchAnim from "@/assets/modal/card2.json";
import stationsAnim from "@/assets/modal/card3.json";
import captureAnim from "@/assets/modal/card4.json";
import reportAnim from "@/assets/modal/card5.json";

type Step = {
  title: string;
  body: React.ReactNode;
};

const STORAGE_KEY = "curriculate_walkthrough_v1_dismissed";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function accentForIdx(i: number) {
  // 0-1: emerald, 2-3: indigo, 4-5: rose
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

function LottieBadge({
  animation,
  accentText,
  accentBg,
  accentRing,
  isVisible,
}: {
  animation: any;
  accentText: string;
  accentBg: string;
  accentRing: string;
  isVisible: boolean;
}) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  // Pause/play when modal hidden/shown (if it stays mounted in future).
  // With current "if (!open) return null" it unmounts anyway, but this makes it robust.
  useEffect(() => {
    const inst = lottieRef.current;
    if (!inst) return;
    if (isVisible) inst.play();
    else inst.pause();
  }, [isVisible]);

  return (
    <div className="mb-3 flex justify-center">
      <div className={`rounded-2xl p-3 ring-1 transition-colors duration-300 ${accentRing} ${accentBg}`}>
        <div className={`transition-colors duration-300 ${accentText}`}>
          <Lottie
            lottieRef={lottieRef}
            animationData={animation}
            loop
            autoplay
            style={{ width: 56, height: 56 }}
          />
        </div>
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
              This is a 60-second walkthrough. You'll know the whole flow by the end.
            </p>
          </div>
        ),
      },
      {
        title: "1) Build a task set",
        body: (
          <div className="space-y-2">
            <p>
              Enter your topic, grade level, difficulty level, purpose, and (most importantly) your list of terms/concepts. Your worldview is integrated throughout! Then, play in just your room or multi-room – think giant scavenger hunt?
            </p>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-black/5">
              Tip: One-time setup in your classroom: print and post the <><b>8 station</b> posters.</>
            </div>
          </div>
        ),
      },
      {
        title: "2) Launch a live session",
        body: (
          <div className="space-y-2">
            <p>
              Start the session on the teacher screen. Teams join quickly (scan/code), and the flow is controlled automatically.
            </p>
            <p className="text-slate-600 text-sm">
              Everything is tracked while students work — no extra "teacher busywork."
            </p>
          </div>
        ),
      },
      {
        title: "3) Stations + teamwork",
        body: (
          <div className="space-y-2">
            <p>
              Students rotate from color station to color station. One device per team is enough.
            </p>
            <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
              <b>Devices:</b> Phones work, but the best experience is{" "}
              <b>~1 tablet per 3 students</b> (one tablet per team). Many schools already have carts/roaming
              sets. 
              <b>~Nothing to download or install.</b>
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
              automatically.
            </p>
            <p className="text-slate-600 text-sm">
              No paper chase after class — everything is already organized AND assessed!
            </p>
          </div>
        ),
      },
      {
        title: "5) Reports + reuse",
        body: (
          <div className="space-y-3">
            <p>
              Session ends and you get clear reporting: whole-class overview, plus team/student
              detail (based on plan).
            </p>
            <p className="text-slate-600 text-sm">
              <b>Reports include grades, topics covered, and anecdotal comments!</b>
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/how-it-works"
                className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-black/10 hover:bg-slate-50"
              >
                See the visual "How it Works" page
              </Link>
              <Link
                href="/demo"
                className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:brightness-105"
              >
                Try the demo! It's revolutionary!
              </Link>
            </div>
          </div>
        ),
      },
    ],
    []
  );

  const animations = useMemo(
    () => [introAnim, buildAnim, launchAnim, stationsAnim, captureAnim, reportAnim],
    []
  );

  const [idx, setIdx] = useState(startAt);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (open) setIdx(startAt);
  }, [open, startAt]);

  const accent = accentForIdx(idx);
  const progress = Math.round(((idx + 1) / steps.length) * 100);

  // Subtle fade/slide per step (optional but nice)
  const [animateIn, setAnimateIn] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAnimateIn(false);
    const t = window.setTimeout(() => setAnimateIn(true), 20);
    return () => window.clearTimeout(t);
  }, [open, idx]);

  function handleClose() {
    if (dontShowAgain) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {}
    }
    onClose();
  }

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

  function next() {
    setIdx((v) => clamp(v + 1, 0, steps.length - 1));
  }

  function back() {
    setIdx((v) => clamp(v - 1, 0, steps.length - 1));
  }

  if (!open) return null;

  const step = steps[idx];
  const currentAnim = animations[idx];

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

            {/* Progress bar (color-shifts with step) */}
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
              {currentAnim ? (
                <LottieBadge
                  animation={currentAnim}
                  accentText={accent.text}
                  accentBg={accent.bg}
                  accentRing={accent.ring}
                  isVisible={open}
                />
              ) : (
                <div className="mb-3 flex justify-center">
                  <div className={`rounded-2xl p-6 ring-1 ${accent.ring} ${accent.bg}`}>
                    <div className="h-14 w-14 animate-pulse rounded-xl bg-black/10" />
                  </div>
                </div>
              )}

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
                  Don't show this again
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
