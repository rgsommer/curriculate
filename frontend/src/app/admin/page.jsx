// frontend/app/admin/page.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="text-sm text-white/70">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function BigNumber({ value, sub }) {
  return (
    <div>
      <div className="text-3xl font-semibold">{value ?? "—"}</div>
      {sub ? <div className="mt-1 text-xs text-white/60">{sub}</div> : null}
    </div>
  );
}

function pctFmt(v) {
  if (v === null) return "∞ / new";
  if (v === undefined) return "—";
  return `${v}%`;
}

export default function AdminUsageDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [force, setForce] = useState(false);

  async function load(force = false) {
    setLoading(true);
    setErr("");
    try {
      const url = `/api/admin/usage-summary${force ? "?force=true" : ""}`;
      const res = await fetch(url, { cache: "no-store" });

      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      let j = null;
      if (ct.includes("application/json")) {
        try { j = JSON.parse(raw); } catch {}
      }

      if (!res.ok) {
        const msg =
          (j && (j.error || j.details)) ||
          `HTTP ${res.status} from ${url}: ${raw.slice(0, 160)}`;
        throw new Error(msg);
      }

      if (!j) {
        throw new Error(`Expected JSON but got ${ct || "unknown content-type"}: ${raw.slice(0, 160)}`);
      }

      setData(j);
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [force]);

  const totals = data?.totals || {};
  const activity = data?.activity || {};

  const daily = useMemo(() => data?.charts?.dailySubmissions30d || [], [data]);
  const monthlyLast12 = useMemo(() => (data?.charts?.monthlySubmissionsLast12 || []).map(x => ({ ...x, label: x.month })), [data]);

  const repeatMonthly = useMemo(() => (data?.charts?.repeatUsersMonthlyLast12 || []).map(x => ({ ...x, label: x.month })), [data]);

  const topSubjects = useMemo(() => {
    const arr = data?.breakdowns30d?.topSubjects || [];
    return arr.slice(0, 8).map((x) => ({ name: x.subject || "Unknown", count: x.count || 0 }));
  }, [data]);

  const momGrowth = data?.derived?.monthOverMonth?.growthPercent;
  const momMethod = data?.derived?.monthOverMonth?.method;

  const repeatPct = data?.derived?.repeatUserPercentage30d;
  const repeatUsers = data?.derived?.repeatUsers30d;
  const activeUsers = data?.derived?.activeUsers30d;

  const powerPct = data?.derived?.powerUserPercentage30d;
  const powerUsers = data?.derived?.powerUsers30d;
  const powerThreshold = data?.derived?.powerUserThreshold ?? 5;

  return (
    <div className="min-h-screen bg-[#0b1220] text-white">
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Grading Usage</h1>
            <div className="mt-1 text-sm text-white/60">
              {data?.generatedAt ? `Generated: ${new Date(data.generatedAt).toLocaleString()}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              disabled={loading}
            >
              Refresh
            </button>

            <button
              onClick={() => setForce((v) => !v)}
              className={`rounded-xl border px-3 py-2 text-sm ${
                force ? "border-blue-400/40 bg-blue-500/15 hover:bg-blue-500/20"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              title="Force recompute (bypass backend cache)"
            >
              Force recompute
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Total submissions">
            <BigNumber value={totals.submissions} />
          </Card>
          <Card title="Unique users (all time)">
            <BigNumber value={totals.uniqueUsers} />
          </Card>
          <Card title="Submissions (today)">
            <BigNumber value={activity.submissionsToday} sub="Since midnight" />
          </Card>
          <Card title="Submissions (30d)">
            <BigNumber value={activity.submissions30d} sub={`Unique users (30d): ${activity.uniqueUsers30d ?? "—"}`} />
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Month-over-month growth">
            <BigNumber value={pctFmt(momGrowth)} sub={momMethod || ""} />
          </Card>

          <Card title="Repeat-user percentage (30d)">
            <BigNumber
              value={repeatPct !== undefined ? `${repeatPct}%` : "—"}
              sub={activeUsers !== undefined ? `${repeatUsers ?? 0} repeat users out of ${activeUsers} active users` : ""}
            />
          </Card>

          <Card title={`Power users (30d) — ${powerThreshold}+ submissions`}>
            <BigNumber
              value={powerPct !== undefined ? `${powerPct}%` : "—"}
              sub={activeUsers !== undefined ? `${powerUsers ?? 0} power users out of ${activeUsers} active users` : ""}
            />
          </Card>

          <Card title="Submissions (7d)">
            <BigNumber value={activity.submissions7d} />
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Daily submissions (last 30 days)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Monthly submissions (last 12 months)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyLast12}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Repeat users (monthly %, last 12 months)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={repeatMonthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} allowDecimals={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(value, name, props) => {
                      if (name === "repeatPct") {
                        const p = props?.payload;
                        return [`${value}% (repeat ${p?.repeatUsers ?? 0} / active ${p?.activeUsers ?? 0})`, "Repeat %"];
                      }
                      return [value, name];
                    }}
                  />
                  <Line type="monotone" dataKey="repeatPct" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Active vs repeat users (last 12 months)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={repeatMonthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="activeUsers" />
                  <Bar dataKey="repeatUsers" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Top subjects (30d)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSubjects} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/*<Card title="Raw JSON (sanity checks)">
            <div className="max-h-64 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-white/80">
              <pre>{loading ? "Loading..." : JSON.stringify(data, null, 2)}</pre>
            </div>
          </Card>*/}
        </div>
      </div>
    </div>
  );
}
