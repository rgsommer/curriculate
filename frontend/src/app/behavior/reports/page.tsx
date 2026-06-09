"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { api, getToken, loginHref } from "../_lib/api";

type Stats = {
  months: number;
  triggerCount: number;
  totals: { incidents: number; notices: number; noticesSent: number; students: number; atOrNearThreshold: number; interactions: number };
  monthly: Array<{ month: string; incidents: number; notices: number }>;
  topTypes: Array<{ type: string; count: number }>;
  classCounts: Array<{ class: string; count: number }>;
  modePie: Array<{ name: string; value: number }>;
  strikeBuckets: Array<{ strikes: string; students: number }>;
};

const PIE_COLORS = ["#0f172a", "#f97316", "#22c55e"];

export default function ReportsPage() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    setData(null);
    api<Stats>(`/stats?months=${months}`).then(setData).catch((e) => setError(e.message));
  }, [months]);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/reports")}>sign in</Link>.</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/behavior" className="text-sm text-slate-500 underline">← dashboard</Link>
          <h1 className="mt-1 text-xl font-semibold">Reports</h1>
        </div>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
          <option value={24}>Last 24 months</option>
        </select>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Incidents" value={t.incidents} />
        <Stat label="Interactions (no note)" value={t.interactions} />
        <Stat label="Notices home" value={`${t.noticesSent}/${t.notices}`} />
        <Stat label="Active students" value={t.students} />
        <Stat label={`At / near ${data.triggerCount}-strike`} value={t.atOrNearThreshold} accent={t.atOrNearThreshold > 0} />
      </div>

      <ChartCard title="Incidents & notices over time">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.monthly} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="incidents" stroke="#0f172a" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="notices" stroke="#f97316" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Incidents by behaviour">
        <ResponsiveContainer width="100%" height={Math.max(160, data.topTypes.length * 30)}>
          <BarChart data={data.topTypes} layout="vertical" margin={{ left: 40, right: 16 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="type" tick={{ fontSize: 11 }} width={120} />
            <Tooltip />
            <Bar dataKey="count" fill="#0f172a" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <ChartCard title="By class">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.classCounts} margin={{ left: -20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="class" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0f172a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="By type of trigger">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data.modePie.filter((m) => m.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {data.modePie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title={`Current strike load (students within the ${data.triggerCount}-strike window)`}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.strikeBuckets} margin={{ left: -20, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="strikes" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="students" fill="#f97316" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-orange-600" : ""}`}>{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
