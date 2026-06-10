"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";

type Row = { studentId: string; name: string; classGroup: string; grade?: string; strikes?: number; triggerCount?: number; count?: number; lastAt: string };
type Intervention = {
  triggerCount: number;
  fadeDays: number;
  atThreshold: Row[];
  topRepeat: Row[];
  byClass: Array<{ classGroup: string; count: number }>;
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
        <h1 className="text-xl font-semibold">Who needs attention</h1>
        <p className="text-sm text-slate-400">School-wide, read-only. Strikes use the current {data.fadeDays}-day window; repeat counts and class totals cover the last 90 days.</p>
      </div>

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
    </div>
  );
}
