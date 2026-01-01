// frontend/src/app/preptime/page.tsx
"use client";

import React, { useMemo, useState } from "react";

type ModeKey = "fluent" | "typical" | "conservative";

const TRADITIONAL_MINUTES = 125; // planning + setup + assessment (typical station-style lesson)
const SCHOOL_MONTHS = 9;

const MODES: Record<
  ModeKey,
  {
    label: string;
    sessionMinutes: number; // Curriculate time end-to-end
    blurb: string;
  }
> = {
  fluent: {
    label: "Fluent (≤ 5 min)",
    sessionMinutes: 5,
    blurb:
      "Once you’re set up and familiar, generating → launching → wrapping → reporting takes ~5 minutes.",
  },
  typical: {
    label: "Typical (15 min)",
    sessionMinutes: 15,
    blurb:
      "A realistic day-to-day workflow with light customization and smooth class flow.",
  },
  conservative: {
    label: "Conservative (30 min)",
    sessionMinutes: 30,
    blurb:
      "Heavier customization, extra edits, or early-stage use—still a big win vs. traditional prep.",
  },
};

const USES_PER_MONTH = [1, 2, 3, 4];

function minutesToHours(min: number) {
  return min / 60;
}

function fmtHours(hr: number) {
  // show one decimal, but avoid .0 when it's clean
  const rounded = Math.round(hr * 10) / 10;
  return rounded % 1 === 0 ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function PrepTimePage() {
  const [mode, setMode] = useState<ModeKey>("fluent");

  const data = useMemo(() => {
    const curriculate = MODES[mode].sessionMinutes;
    const savedPerSession = Math.max(0, TRADITIONAL_MINUTES - curriculate); // minutes
    const rows = USES_PER_MONTH.map((uses) => {
      const minutesSaved = savedPerSession * uses;
      const hoursSaved = minutesToHours(minutesSaved);
      const yearlyHours = hoursSaved * SCHOOL_MONTHS;
      return {
        uses,
        minutesSaved,
        hoursSaved,
        yearlyHours,
      };
    });

    const maxHours = Math.max(...rows.map((r) => r.hoursSaved), 1);

    return { curriculate, savedPerSession, rows, maxHours };
  }, [mode]);

  const headlineHoursPerUse = fmtHours(minutesToHours(data.savedPerSession));
  const topRow = data.rows;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-14 pb-10 sm:pt-16 sm:pb-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-4 py-2 text-sm text-indigo-800 shadow-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                Prep + Assessment Time Saved
              </div>

              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Get back{" "}
                <span className="text-indigo-700">{headlineHoursPerUse} hours</span>{" "}
                every time you run a Curriculate set.
              </h1>

              <p className="max-w-2xl text-base leading-relaxed text-slate-700 sm:text-lg">
                This page estimates monthly time saved by comparing a typical station-style
                lesson done manually (planning + setup + assessment) with a fluent Curriculate
                workflow.
              </p>
            </div>

            {/* Mode Toggle */}
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Choose your workflow level
                  </div>
                  <div className="text-sm text-slate-600">{MODES[mode].blurb}</div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(["fluent", "typical", "conservative"] as ModeKey[]).map((k) => {
                    const active = mode === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setMode(k)}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-medium transition",
                          active
                            ? "bg-indigo-600 text-white shadow"
                            : "bg-white text-slate-800 hover:bg-slate-50 border border-slate-200",
                        ].join(" ")}
                        aria-pressed={active}
                      >
                        {MODES[k].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Assumptions mini-line */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MiniStat
                  label="Traditional workload"
                  value={`${TRADITIONAL_MINUTES} min`}
                  sub="Plan + setup + assess"
                />
                <MiniStat
                  label="Curriculate workflow"
                  value={`${data.curriculate} min`}
                  sub="End-to-end"
                />
                <MiniStat
                  label="Saved per session"
                  value={`${data.savedPerSession} min`}
                  sub={`≈ ${headlineHoursPerUse} hrs`}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Cards */}
      <section className="px-6 pb-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {topRow.map((r) => (
              <StatCard
                key={r.uses}
                title={`${r.uses}× per month`}
                value={`${fmtHours(r.hoursSaved)} hrs`}
                subtitle={`${r.minutesSaved} minutes saved`}
                badge={`≈ ${fmtHours(r.yearlyHours)} hrs / school year`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Chart + Table */}
      <section className="px-6 pb-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Chart */}
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Monthly hours saved
                  </h2>
                  <p className="text-sm text-slate-600">
                    Based on {TRADITIONAL_MINUTES} min traditional vs {data.curriculate} min
                    Curriculate.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                  Max: {fmtHours(data.maxHours)} hrs
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {data.rows.map((r) => {
                  const pct = clamp((r.hoursSaved / data.maxHours) * 100, 2, 100);
                  return (
                    <div key={r.uses} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="font-medium text-slate-800">
                          {r.uses}× / month
                        </div>
                        <div className="text-slate-700">
                          <span className="font-semibold text-indigo-700">
                            {fmtHours(r.hoursSaved)} hrs
                          </span>{" "}
                          <span className="text-slate-500">({r.minutesSaved} min)</span>
                        </div>
                      </div>
                      <div className="h-3 w-full rounded-full bg-slate-200/70">
                        <div
                          className="h-3 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 shadow-sm"
                          style={{ width: `${pct}%` }}
                          aria-label={`${r.uses} uses per month saves ${fmtHours(
                            r.hoursSaved
                          )} hours`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <span className="font-semibold">Teacher-friendly takeaway:</span>{" "}
                Using Curriculate <span className="font-semibold">4× per month</span> saves{" "}
                <span className="font-semibold">
                  {fmtHours(data.rows[3].hoursSaved)} hours
                </span>{" "}
                monthly — basically{" "}
                <span className="font-semibold">a full workday</span> back every month.
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-lg font-semibold text-slate-900">Monthly + yearly view</h2>
              <p className="text-sm text-slate-600">
                School-year estimate assumes ~{SCHOOL_MONTHS} instructional months.
              </p>

              <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Uses / month</th>
                      <th className="px-4 py-3 font-medium">Minutes saved</th>
                      <th className="px-4 py-3 font-medium">Hours saved</th>
                      <th className="px-4 py-3 font-medium">School-year hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.rows.map((r) => (
                      <tr key={r.uses} className="text-slate-800">
                        <td className="px-4 py-3 font-medium">{r.uses}×</td>
                        <td className="px-4 py-3">{r.minutesSaved}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-indigo-700">
                            {fmtHours(r.hoursSaved)}
                          </span>
                        </td>
                        <td className="px-4 py-3">{fmtHours(r.yearlyHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Callout
                  title="What you do with that time"
                  items={[
                    "More meaningful feedback conversations",
                    "Better differentiation (without burnout)",
                    "Actually leaving on time sometimes",
                    "Planning that improves outcomes, not busywork",
                  ]}
                />
                <Callout
                  title="Credibility note"
                  items={[
                    "Some teachers save more with auto-scoring & reports",
                    "Some save less when heavily customizing tasks",
                    "This model is about prep + assessment, not teaching time",
                    "Numbers are estimates—results vary by class + subject",
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="mx-auto mt-8 max-w-6xl">
            <div className="rounded-2xl border border-slate-200 bg-white/60 p-5 text-xs leading-relaxed text-slate-600 shadow-sm backdrop-blur">
              <span className="font-semibold text-slate-700">Assumptions:</span> Traditional
              station-style lesson estimated at <span className="font-semibold">125 minutes</span>{" "}
              (planning ~60, setup/printing ~20, assessment/reporting ~45). Curriculate
              workflow varies by teacher; toggle options reflect common ranges. This page
              compares <span className="font-semibold">prep + assessment time</span> only.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ---------- Small UI components (local, no dependencies) ---------- */

function MiniStat(props: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-600">{props.label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{props.value}</div>
      <div className="text-xs text-slate-500">{props.sub}</div>
    </div>
  );
}

function StatCard(props: {
  title: string;
  value: string;
  subtitle: string;
  badge: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/75 p-5 shadow-sm backdrop-blur">
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[2rem] bg-gradient-to-br from-indigo-100 to-blue-100" />
      <div className="relative">
        <div className="text-sm font-medium text-slate-700">{props.title}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {props.value}
        </div>
        <div className="mt-1 text-sm text-slate-600">{props.subtitle}</div>
        <div className="mt-4 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800">
          {props.badge}
        </div>
      </div>
    </div>
  );
}

function Callout(props: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-semibold text-slate-900">{props.title}</div>
      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {props.items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
