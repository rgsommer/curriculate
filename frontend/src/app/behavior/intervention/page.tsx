"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";
import GuddChip from "../_components/GuddChip";

type Row = { studentId: string; name: string; classGroup: string; grade?: string; strikes?: number; triggerCount?: number; count?: number; lastAt: string };
type GuddRow = { studentId: string; name: string; classGroup: string; grade?: string; count: number; threshold: number; lost: boolean; atRisk: boolean; consequence?: string; lastAt: string };
type Trend = { month: string; neg: number; pos: number };
type TeacherRow = { teacherId: string; name: string; negatives: number; positives: number; students: number; posRatio: number | null; flag?: boolean };
type Proactive = { studentId: string; name: string; classGroup: string; recent: number; prior: number; notices: number };
type Intervention = {
  triggerCount: number;
  fadeDays: number;
  atThreshold: Row[];
  topRepeat: Row[];
  byClass: Array<{ classGroup: string; count: number }>;
  trends: Trend[];
  teachers: TeacherRow[];
  proactive: Proactive[];
  usage?: Array<{ name: string; role: string; loads: number; lastSeenAt: string | null }>;
  activeThisWeek?: number;
  gudd?: { enabled: boolean; name?: string; threshold?: number; students: GuddRow[] };
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function InterventionPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<Intervention | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api<Me>("/me").then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<Intervention>("/intervention").then(setData).catch((e) => setErr(e.message));
  }, []);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/intervention")}>sign in</Link>.</p>;
  const isAdmin = me?.membership?.role === "originator" || me?.membership?.role === "admin";
  if (me && !isAdmin) return <p className="text-slate-500">This view is for admins / VP only.</p>;
  if (err) return <p className="text-red-600">{err}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const maxClass = Math.max(1, ...data.byClass.map((c) => c.count));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">School insights</h1>
        <p className="text-sm text-slate-400">Admin-only, read-only. Objective signals to act early and support staff — not a verdict on anyone.</p>
      </div>

      {/* Behaviour trend */}
      {data.trends && data.trends.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Behaviour trend (last 6 months)</h2>
          <p className="mt-0.5 text-xs text-slate-400"><span className="text-red-500">■</span> offences · <span className="text-green-600">■</span> positives</p>
          {(() => {
            const max = Math.max(1, ...data.trends.map((t) => t.neg + t.pos));
            return (
              <ul className="mt-3 space-y-1.5">
                {data.trends.map((t) => (
                  <li key={t.month} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-slate-500">{t.month}</span>
                    <span className="flex h-3 flex-1 overflow-hidden rounded bg-slate-100">
                      <span className="bg-red-500" style={{ width: `${(t.neg / max) * 100}%` }} />
                      <span className="bg-green-500" style={{ width: `${(t.pos / max) * 100}%` }} />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-slate-500">{t.neg}✕ {t.pos}✓</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>
      )}

      {/* Proactive — students to get ahead of */}
      {data.proactive && data.proactive.length > 0 && (
        <section className="rounded-xl border border-orange-200 bg-orange-50/50 p-5">
          <h2 className="font-semibold text-orange-900">Students to get ahead of</h2>
          <p className="mt-0.5 text-xs text-slate-500">Offences rising in the last 2 weeks — a chance to step in before it reaches a notice.</p>
          <ul className="mt-2 divide-y divide-orange-100">
            {data.proactive.map((p) => (
              <li key={p.studentId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/behavior/student/${p.studentId}`} className="font-medium hover:underline">
                  {p.name}<span className="ml-2 text-xs font-normal text-slate-400">{p.classGroup !== "—" ? p.classGroup : ""}{p.notices ? ` · ${p.notices} notice${p.notices === 1 ? "" : "s"}` : ""}</span>
                </Link>
                <span className="shrink-0 text-xs font-semibold text-orange-700">{p.recent} in 2 wks{p.prior ? ` (was ${p.prior})` : ""} ↑</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* At or near threshold */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">At or near a notice ({data.triggerCount} strikes)</h2>
        {data.atThreshold.length === 0 && <p className="mt-1 text-sm text-slate-400">No students near the threshold right now.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {data.atThreshold.map((r) => {
            const at = (r.strikes || 0) >= (r.triggerCount || data.triggerCount);
            return (
              <li key={r.studentId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/behavior/student/${r.studentId}`} className="font-medium hover:underline">
                  {r.name}
                  <span className="ml-2 text-xs font-normal text-slate-400">{[r.classGroup, r.grade].filter((x) => x && x !== "—").join(" · ")}</span>
                </Link>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">last {fmtDate(r.lastAt)}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${at ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {r.strikes} / {r.triggerCount || data.triggerCount}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* GUDD — students who've lost or are at risk of losing the dress-down */}
      {data.gudd?.enabled && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">{data.gudd.name || "GUDD"} — lost or at risk</h2>
          {(!data.gudd.students || data.gudd.students.length === 0) && (
            <p className="mt-1 text-sm text-slate-400">No uniform infractions on record right now.</p>
          )}
          <ul className="mt-2 divide-y divide-slate-100">
            {(data.gudd.students || []).map((r) => (
              <li key={r.studentId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/behavior/student/${r.studentId}`} className="font-medium hover:underline">
                  {r.name}
                  <span className="ml-2 text-xs font-normal text-slate-400">{[r.classGroup, r.grade].filter((x) => x && x !== "—").join(" · ")}</span>
                </Link>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">last {fmtDate(r.lastAt)}</span>
                  <GuddChip name={data.gudd!.name} count={r.count} threshold={r.threshold} consequence={r.consequence} size="xs" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Most-logged */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Most-logged (last 90 days)</h2>
        {data.topRepeat.length === 0 && <p className="mt-1 text-sm text-slate-400">No incidents logged recently.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {data.topRepeat.map((r) => (
            <li key={r.studentId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <Link href={`/behavior/student/${r.studentId}`} className="font-medium hover:underline">
                {r.name}
                <span className="ml-2 text-xs font-normal text-slate-400">{r.classGroup !== "—" ? r.classGroup : ""}</span>
              </Link>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-400">last {fmtDate(r.lastAt)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{r.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* By class */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Incidents by class (last 90 days)</h2>
        {data.byClass.length === 0 && <p className="mt-1 text-sm text-slate-400">No data yet.</p>}
        <ul className="mt-3 space-y-2">
          {data.byClass.map((c) => (
            <li key={c.classGroup} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">{c.classGroup}</span>
                <span className="text-slate-500">{c.count}</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-slate-700" style={{ width: `${Math.max(2, Math.round((c.count / maxClass) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* App usage this week */}
      {data.usage && data.usage.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">App usage this week</h2>
          <p className="mt-0.5 text-xs text-slate-400">{data.activeThisWeek ?? 0} of {data.usage.length} staff have opened it this week (page loads). A quick read on adoption.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.usage.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="font-medium">{u.name}{u.role === "principal" ? " (principal)" : u.role === "admin" || u.role === "originator" ? " (admin)" : ""}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">{u.lastSeenAt ? `last ${fmtDate(u.lastSeenAt)}` : "not yet"}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${u.loads > 0 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>{u.loads} {u.loads === 1 ? "open" : "opens"}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Teachers who may welcome support */}
      {data.teachers && data.teachers.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Staff activity (last 90 days)</h2>
          <p className="mt-0.5 text-xs text-slate-400">Offences vs positives logged. A ★ flags a heavier-than-typical offence load with few positives — a teacher who may welcome support or co-planning, not a performance judgement.</p>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">Teacher</th><th className="text-right">Offences</th><th className="text-right">Positives</th><th className="text-right">Students</th><th className="text-right">Positive%</th></tr></thead>
            <tbody>
              {data.teachers.map((t) => (
                <tr key={t.teacherId} className={`border-t border-slate-100 ${t.flag ? "bg-amber-50" : ""}`}>
                  <td className="py-1">{t.flag ? "★ " : ""}{t.name}</td>
                  <td className="text-right tabular-nums">{t.negatives}</td>
                  <td className="text-right tabular-nums">{t.positives}</td>
                  <td className="text-right tabular-nums text-slate-400">{t.students}</td>
                  <td className="text-right tabular-nums">{t.posRatio == null ? "—" : `${t.posRatio}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
