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
  const [adminToken, setAdminToken] = useState("");

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [force, setForce] = useState(false);

  const [feedback, setFeedback] = useState([]);
  const [feedbackErr, setFeedbackErr] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState("all"); // "all" | "teacher" | "student" | "results"

  async function loadFeedback() {
    setFeedbackLoading(true);
    setFeedbackErr("");
    try {
      const res = await fetch("/api/admin/feedback?limit=80", {
        cache: "no-store",
        headers: {
          "x-admin-token": adminToken,
        },
      });

      const raw = await res.text();
      let j = null;
      try { j = JSON.parse(raw); } catch {}

      if (!res.ok) {
        const msg = (j && (j.error || j.details)) || raw.slice(0, 160) || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setFeedback(Array.isArray(j?.items) ? j.items : []);
    } catch (e) {
      setFeedbackErr(e?.message || String(e) || "Failed to load feedback");
    } finally {
      setFeedbackLoading(false);
    }
  }

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

  useEffect(() => {
    try {
      const t = localStorage.getItem("ADMIN_API_TOKEN") || "";
      setAdminToken(t);
    } catch {}
  }, []);

  useEffect(() => {
    load(force);
    loadFeedback();
    // eslint-disable-next-line
  }, [force]);

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

  const rpv = data?.resultsPageViews || {};

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
              onClick={() => { load(force); loadFeedback(); }}
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={adminToken}
            onChange={(e) => {
              const v = e.target.value;
              setAdminToken(v);
              try { localStorage.setItem("ADMIN_API_TOKEN", v); } catch {}
            }}
            placeholder="Admin API token"
            className="w-[320px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          />
          <div className="text-xs text-white/50">
            Stored locally in this browser
          </div>
        </div>

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

        {/* Results Page Views */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Results published">
            <BigNumber value={rpv.published} sub="Active result pages" />
          </Card>
          <Card title="Total page views">
            <BigNumber value={rpv.totalViews} sub={`${rpv.resultsViewed || 0} results viewed at least once`} />
          </Card>
          <Card title="Avg views per result">
            <BigNumber value={rpv.avgViewsPerResult} sub={`Max: ${rpv.maxViews || 0}`} />
          </Card>
          <Card title="Results viewed (30d)">
            <BigNumber value={rpv.viewedLast30d} sub="Unique results viewed" />
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

        {/* Schools & Teachers collected from grade review requests */}
        {(() => {
          const reviews = feedback.filter((f) => f.meta?.type === "grade-review");
          const schools = [...new Set(reviews.map((f) => f.meta?.school).filter(Boolean))].sort();
          const teachers = [...new Set(reviews.map((f) => {
            const name = f.meta?.teacherName || "";
            const email = f.meta?.teacherEmail || "";
            return name && email ? `${name} (${email})` : name || email || "";
          }).filter(Boolean))].sort();
          if (!schools.length && !teachers.length) return null;
          return (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {schools.length > 0 && (
                <Card title={`Schools (${schools.length})`}>
                  <div className="max-h-[200px] overflow-auto">
                    <ul className="space-y-1">
                      {schools.map((s) => (
                        <li key={s} className="text-sm text-white/90">{s}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}
              {teachers.length > 0 && (
                <Card title={`Teachers (${teachers.length})`}>
                  <div className="max-h-[200px] overflow-auto">
                    <ul className="space-y-1">
                      {teachers.map((t) => (
                        <li key={t} className="text-sm text-white/90">{t}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}
            </div>
          );
        })()}

        <div className="mt-6">
          <Card title="Feedback">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-white/60">
                {feedbackLoading ? "Loading…" : `${feedback.length} message(s)`}
              </div>
              <button
                onClick={loadFeedback}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                disabled={feedbackLoading}
              >
                Refresh feedback
              </button>
            </div>

            {/* Filter tabs */}
            <div className="mt-3 flex gap-2">
              {[
                { key: "all", label: "All" },
                { key: "teacher", label: "Teacher" },
                { key: "student", label: "Student" },
                { key: "results", label: "Results page" },
                { key: "grade-review", label: "Grade reviews" },
              ].map((tab) => {
                const count = tab.key === "all"
                  ? feedback.length
                  : feedback.filter((f) => {
                      const src = f.meta?.source || "";
                      const tp = f.meta?.type || "";
                      if (tab.key === "grade-review") return tp === "grade-review";
                      if (tab.key === "teacher") return src === "grading-feedback-prompt";
                      if (tab.key === "student") return src === "student-app";
                      if (tab.key === "results") return src === "results-page" && tp !== "grade-review";
                      return false;
                    }).length;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setFeedbackFilter(tab.key)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      feedbackFilter === tab.key
                        ? "bg-blue-500/20 border border-blue-400/40 text-blue-200"
                        : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {tab.label} ({count})
                  </button>
                );
              })}
            </div>

            {feedbackErr ? (
              <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                {feedbackErr}
              </div>
            ) : null}

            <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-white/10 bg-black/20">
              {feedback.length ? (
                <ul className="divide-y divide-white/10">
                  {feedback
                    .filter((f) => {
                      if (feedbackFilter === "all") return true;
                      const src = f.meta?.source || "";
                      const tp = f.meta?.type || "";
                      if (feedbackFilter === "grade-review") return tp === "grade-review";
                      if (feedbackFilter === "teacher") return src === "grading-feedback-prompt";
                      if (feedbackFilter === "student") return src === "student-app";
                      if (feedbackFilter === "results") return src === "results-page" && tp !== "grade-review";
                      return true;
                    })
                    .map((f) => {
                    const src = f.meta?.source || "";
                    const tp = f.meta?.type || "";
                    const isGradeReview = tp === "grade-review";
                    const badge = isGradeReview
                      ? { label: "Grade review", color: "bg-amber-500/20 text-amber-200 border-amber-400/30" }
                      : src === "results-page"
                      ? { label: f.meta?.role === "parent" ? "Parent" : f.meta?.role === "student" ? "Student" : "Results", color: "bg-purple-500/20 text-purple-200 border-purple-400/30" }
                      : src === "student-app"
                      ? { label: "Student app", color: "bg-green-500/20 text-green-200 border-green-400/30" }
                      : src === "grading-feedback-prompt"
                      ? { label: "Teacher", color: "bg-blue-500/20 text-blue-200 border-blue-400/30" }
                      : { label: "Other", color: "bg-white/10 text-white/60 border-white/10" };

                    return (
                    <li key={f.id} className={`p-3${isGradeReview ? " border-l-2 border-l-amber-400/60" : ""}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-white/60">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${badge.color}`}>
                            {badge.label}
                          </span>
                          {f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}
                          {typeof f.uses === "number" ? ` · uses: ${f.uses}` : ""}
                          {f.meta?.gradeBand ? ` · band: ${f.meta.gradeBand}` : ""}
                          {f.meta?.inputMode ? ` · mode: ${f.meta.inputMode}` : ""}
                          {f.meta?.voice ? ` · voice: ${f.meta.voice}` : ""}
                          {f.meta?.refCode ? (
                            <> · ref: <a href={`/results/${f.meta.refCode}`} target="_blank" rel="noreferrer" className="text-blue-300 underline hover:text-blue-200">{f.meta.refCode}</a></>
                          ) : ""}
                        </div>
                        <div className="text-[11px] text-white/50">
                          {f.anonId ? `anon: ${String(f.anonId).slice(0, 10)}…` : ""}
                        </div>
                      </div>

                      {/* Student app feedback context */}
                      {src === "student-app" && (f.meta?.teamName || f.meta?.memberNames?.length || f.meta?.taskTitle) && (
                        <div className="mt-2 rounded-lg border border-green-400/20 bg-green-500/5 p-2.5 text-xs">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {f.meta?.teamName && (
                              <div><span className="text-white/50">Team:</span> <span className="text-white/90 font-medium">{f.meta.teamName}</span></div>
                            )}
                            {f.meta?.memberNames?.length > 0 && (
                              <div><span className="text-white/50">Members:</span> <span className="text-white/90">{f.meta.memberNames.join(", ")}</span></div>
                            )}
                            {f.meta?.taskTitle && (
                              <div><span className="text-white/50">Task:</span> <span className="text-white/90">{f.meta.taskTitle}{f.meta?.taskType ? ` (${f.meta.taskType})` : ""}{f.meta?.taskIndex != null ? ` #${f.meta.taskIndex}/${f.meta?.totalTasks || "?"}` : ""}</span></div>
                            )}
                            {f.meta?.roomCode && (
                              <div><span className="text-white/50">Room:</span> <span className="text-white/90">{f.meta.roomCode}</span></div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Grade review detail card */}
                      {isGradeReview && (
                        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/5 p-2.5 text-xs">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {f.meta?.studentName && (
                              <div><span className="text-white/50">Student:</span> <span className="text-white/90 font-medium">{f.meta.studentName}</span></div>
                            )}
                            {f.meta?.teacherName && (
                              <div><span className="text-white/50">Teacher:</span> <span className="text-white/90 font-medium">{f.meta.teacherName}</span></div>
                            )}
                            {f.meta?.school && (
                              <div><span className="text-white/50">School:</span> <span className="text-white/90">{f.meta.school}</span></div>
                            )}
                            {f.meta?.className && (
                              <div><span className="text-white/50">Class:</span> <span className="text-white/90">{f.meta.className}</span></div>
                            )}
                            {f.meta?.teacherEmail && (
                              <div className="col-span-2"><span className="text-white/50">Teacher email:</span> <span className="text-blue-300">{f.meta.teacherEmail}</span></div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-2 whitespace-pre-wrap text-sm text-white/90">
                        {f.message}
                      </div>
                    </li>
                  );})}
                </ul>
              ) : (
                <div className="p-3 text-sm text-white/60">
                  No feedback yet.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
