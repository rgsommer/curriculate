"use client";

// "Is behaviour improving?" at a glance — last 4 weeks vs the 4 before, per
// school day (see GET /trend). Shown on Reports and, for admins, the dashboard.
import { useEffect, useState } from "react";
import { api } from "../_lib/api";

type Trend = {
  verdict: "improving" | "steady" | "worsening" | "insufficient";
  headline: string;
  sentence: string;
  offences: { recent: number; prior: number; perDayRecent: number; perDayPrior: number; changePct: number | null };
  encouragements: { recent: number; prior: number; perDayRecent: number; perDayPrior: number; changePct: number | null };
  ratio: { recent: number | null; prior: number | null };
  studentsInvolved: { recent: number; prior: number };
  nearLimit: number;
  triggerCount: number;
  windows: { schoolDaysRecent: number; schoolDaysPrior: number };
};

const STYLE: Record<Trend["verdict"], { box: string; arrow: string; head: string }> = {
  improving: { box: "border-green-300 bg-green-50", arrow: "↘", head: "text-green-800" },
  steady: { box: "border-slate-200 bg-slate-50", arrow: "→", head: "text-slate-800" },
  worsening: { box: "border-red-300 bg-red-50", arrow: "↗", head: "text-red-800" },
  insufficient: { box: "border-slate-200 bg-white", arrow: "·", head: "text-slate-600" },
};

export default function TrendCard({ compact = false }: { compact?: boolean }) {
  const [t, setT] = useState<Trend | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api<Trend>("/trend").then(setT).catch(() => setFailed(true)); }, []);
  if (failed || !t) return null;
  const st = STYLE[t.verdict];
  const chg = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}%`);
  return (
    <section className={`rounded-xl border p-4 ${st.box}`} aria-label="Behaviour trend">
      <p className={`flex items-center gap-2 text-lg font-semibold ${st.head}`}>
        <span aria-hidden className="text-2xl leading-none">{st.arrow}</span>{t.headline}
      </p>
      <p className="mt-1 text-sm text-slate-700">{t.sentence}</p>
      {!compact && t.verdict !== "insufficient" && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div><dt className="text-slate-500">Offences / school day</dt><dd className="font-semibold text-slate-800">{t.offences.perDayPrior} → {t.offences.perDayRecent} <span className="font-normal text-slate-500">({chg(t.offences.changePct)})</span></dd></div>
          <div><dt className="text-slate-500">Encouragements / school day</dt><dd className="font-semibold text-slate-800">{t.encouragements.perDayPrior} → {t.encouragements.perDayRecent} <span className="font-normal text-slate-500">({chg(t.encouragements.changePct)})</span></dd></div>
          <div><dt className="text-slate-500">Encouragements per offence</dt><dd className="font-semibold text-slate-800">{t.ratio.prior ?? "—"} → {t.ratio.recent ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Students with offences</dt><dd className="font-semibold text-slate-800">{t.studentsInvolved.prior} → {t.studentsInvolved.recent}</dd></div>
        </dl>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Last 4 weeks ({t.windows.schoolDaysRecent} school days) vs the 4 before ({t.windows.schoolDaysPrior}); weekends and holidays don&apos;t count.
        {" "}{t.nearLimit} student{t.nearLimit === 1 ? "" : "s"} at or one away from the {t.triggerCount}-strike limit now.
      </p>
    </section>
  );
}
