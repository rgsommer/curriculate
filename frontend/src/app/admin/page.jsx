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

  const FEEDBACK_PAGE_SIZE = 10;
  const [feedback, setFeedback] = useState([]);
  const [feedbackErr, setFeedbackErr] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackHasMore, setFeedbackHasMore] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState("all"); // "all" | "teacher" | "student" | "results"

  // Diagnostic logs state
  const [diagLogs, setDiagLogs] = useState([]);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagLoaded, setDiagLoaded] = useState(false);

  async function loadDiagLogs() {
    setDiagLoading(true);
    try {
      const res = await fetch("/api/admin/diagnostics?limit=50", {
        headers: { "x-admin-token": adminToken },
      });
      const j = await res.json().catch(() => ({}));
      setDiagLogs(j?.logs || []);
      setDiagLoaded(true);
    } catch (e) {
      console.error("Failed to load diagnostic logs:", e);
    } finally {
      setDiagLoading(false);
    }
  }

  function formatDiagForClipboard() {
    if (!diagLogs.length) return "No diagnostic logs.";
    return diagLogs.map((log) => {
      const lines = [
        `=== ${log.tasksetName || log.tasksetId} ===`,
        `Date: ${log.createdAt || log.ts}`,
        log.teacherNote ? `Teacher note: ${log.teacherNote}` : "",
        `Tasks: ${log.totalTasks}, Issues: ${log.issuesFound}, Auto-fixed: ${log.issuesFixed}`,
        "",
        ...(log.diagnostics || []).flatMap((d) => [
          `--- Task ${d.taskIndex} | ${d.taskType} | "${d.title}" | ${d.fixed ? "AUTO-FIXED" : "NEEDS MANUAL FIX"} ---`,
          `Errors: ${(d.errors || []).map((e) => `\n  - ${e}`).join("")}`,
          d.postFixErrors?.length ? `Still broken after fix: ${d.postFixErrors.map((e) => `\n  - ${e}`).join("")}` : "",
          d.rawTask ? `Raw task JSON:\n${JSON.stringify(d.rawTask, null, 2)}` : "",
          "",
        ]),
      ];
      return lines.filter(Boolean).join("\n");
    }).join("\n\n---\n\n");
  }

  async function copyDiagLogs() {
    const text = formatDiagForClipboard();
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard!");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Copied!");
    }
  }

  async function clearDiagLogs() {
    if (!confirm("Clear all diagnostic logs? This cannot be undone.")) return;
    try {
      await fetch("/api/admin/diagnostics", {
        method: "DELETE",
        headers: { "x-admin-token": adminToken },
      });
      setDiagLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
  }

  // Teacher outreach state
  const [outreachTeachers, setOutreachTeachers] = useState([]);
  const [outreachTemplates, setOutreachTemplates] = useState([]);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachSelected, setOutreachSelected] = useState(new Set());
  const [outreachTemplate, setOutreachTemplate] = useState("");
  const [outreachCustomSubject, setOutreachCustomSubject] = useState("");
  const [outreachCustomBody, setOutreachCustomBody] = useState("");
  const [outreachSending, setOutreachSending] = useState(false);
  const [outreachResult, setOutreachResult] = useState(null);
  const [outreachFilter, setOutreachFilter] = useState("all"); // "all" | "not-contacted" | "contacted"

  async function loadOutreach() {
    setOutreachLoading(true);
    try {
      const res = await fetch("/api/admin/teacher-outreach", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) {
        setOutreachTeachers(j.teachers || []);
        setOutreachTemplates(j.templates || []);
      }
    } catch (e) {
      console.error("Failed to load outreach:", e);
    } finally {
      setOutreachLoading(false);
    }
  }

  async function sendOutreach() {
    if (!outreachTemplate || outreachSelected.size === 0) return;
    setOutreachSending(true);
    setOutreachResult(null);
    try {
      const recipients = outreachTeachers
        .filter((t) => outreachSelected.has(t.email))
        .map((t) => ({ email: t.email, teacherName: t.teacherName }));
      const res = await fetch("/api/admin/teacher-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: recipients,
          template: outreachTemplate,
          customSubject: outreachCustomSubject || undefined,
          customBody: outreachCustomBody || undefined,
        }),
      });
      const j = await res.json();
      setOutreachResult(j);
      if (j.ok) {
        setOutreachSelected(new Set());
        loadOutreach(); // refresh contact dates
      }
    } catch (e) {
      setOutreachResult({ error: e.message });
    } finally {
      setOutreachSending(false);
    }
  }

  const [feedbackView, setFeedbackView] = useState("active"); // "active" | "archived"

  async function feedbackAction(id, action) {
    if (!id) return;
    try {
      if (action === "delete") {
        const res = await fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "x-admin-token": adminToken },
        });
        if (res.ok) setFeedback((prev) => prev.filter((f) => f.id !== id));
      } else {
        const res = await fetch("/api/admin/feedback", {
          method: "PATCH",
          headers: { "x-admin-token": adminToken, "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (res.ok) setFeedback((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (e) {
      console.error(`Failed to ${action} feedback:`, e);
    }
  }

  async function loadFeedback(archived = false, append = false) {
    setFeedbackLoading(true);
    setFeedbackErr("");
    try {
      const skip = append ? feedback.length : 0;
      const qs = `limit=${FEEDBACK_PAGE_SIZE}&skip=${skip}${archived ? "&archived=true" : ""}`;
      const res = await fetch(`/api/admin/feedback?${qs}`, {
        cache: "no-store",
        headers: { "x-admin-token": adminToken },
      });

      const raw = await res.text();
      let j = null;
      try { j = JSON.parse(raw); } catch {}

      if (!res.ok) {
        const msg = (j && (j.error || j.details)) || raw.slice(0, 160) || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const items = Array.isArray(j?.items) ? j.items : [];
      setFeedbackHasMore(items.length >= FEEDBACK_PAGE_SIZE);
      setFeedback(append ? (prev) => [...prev, ...items] : items);
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
    loadOutreach();
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

  const topAssessmentTypes = useMemo(() => {
    const arr = data?.breakdowns30d?.topAssessmentTypes || [];
    return arr.slice(0, 8).map((x) => ({ name: x.assessmentType || "Unknown", count: x.count || 0 }));
  }, [data]);

  const inputModes = useMemo(() => {
    const arr = data?.breakdowns30d?.inputModes || [];
    const labels = { photo: "Photo/Paste", batch: "Batch PDF", video: "Video" };
    return arr.map((x) => ({ name: labels[x.mode] || x.mode || "Unknown", count: x.count || 0 }));
  }, [data]);

  const topCountries = useMemo(() => {
    const arr = data?.breakdowns30d?.topCountries || [];
    return arr.slice(0, 10).map((x) => ({ name: x.country || "Unknown", count: x.count || 0 }));
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
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
                  <Line type="monotone" dataKey="repeatPct" stroke="#38bdf8" strokeWidth={2} dot={false} />
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
                  <Bar dataKey="activeUsers" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="repeatUsers" fill="#22c55e" radius={[4, 4, 0, 0]} />
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
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Assessment types (30d)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topAssessmentTypes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#38bdf8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Input mode (30d)">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inputModes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Countries (30d)">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCountries} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Teacher Outreach Panel */}
        {outreachTeachers.length > 0 && (
          <div className="mt-6">
            <Card title={`Teacher Outreach (${outreachTeachers.length} teachers)`}>
              {/* Filter tabs */}
              <div className="flex items-center gap-2 mb-3">
                {[
                  { key: "all", label: "All" },
                  { key: "not-contacted", label: "Not yet contacted" },
                  { key: "contacted", label: "Previously contacted" },
                ].map((tab) => {
                  const count = tab.key === "all"
                    ? outreachTeachers.length
                    : outreachTeachers.filter((t) =>
                        tab.key === "not-contacted" ? !t.lastContactedAt : !!t.lastContactedAt
                      ).length;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setOutreachFilter(tab.key)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${
                        outreachFilter === tab.key
                          ? "bg-blue-500/20 border border-blue-400/40 text-blue-200"
                          : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    const visible = outreachTeachers.filter((t) => {
                      if (outreachFilter === "not-contacted") return !t.lastContactedAt;
                      if (outreachFilter === "contacted") return !!t.lastContactedAt;
                      return true;
                    });
                    const allSelected = visible.every((t) => outreachSelected.has(t.email));
                    const next = new Set(outreachSelected);
                    visible.forEach((t) => allSelected ? next.delete(t.email) : next.add(t.email));
                    setOutreachSelected(next);
                  }}
                  className="ml-auto rounded-lg px-3 py-1 text-xs font-medium bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                >
                  {(() => {
                    const visible = outreachTeachers.filter((t) => {
                      if (outreachFilter === "not-contacted") return !t.lastContactedAt;
                      if (outreachFilter === "contacted") return !!t.lastContactedAt;
                      return true;
                    });
                    return visible.every((t) => outreachSelected.has(t.email)) ? "Deselect all" : "Select all";
                  })()}
                </button>
                {outreachSelected.size > 0 && (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete ${outreachSelected.size} selected teacher(s) from outreach list?`)) return;
                      try {
                        const res = await fetch("/api/admin/teacher-outreach", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ emails: [...outreachSelected] }),
                        });
                        const j = await res.json();
                        if (j.ok) {
                          setOutreachSelected(new Set());
                          loadOutreach();
                        } else {
                          alert(j.error || "Delete failed");
                        }
                      } catch (e) {
                        alert("Delete failed: " + e.message);
                      }
                    }}
                    className="rounded-lg px-3 py-1 text-xs font-medium bg-red-500/20 border border-red-400/40 text-red-300 hover:bg-red-500/30"
                  >
                    Delete ({outreachSelected.size})
                  </button>
                )}
              </div>

              {/* Teacher list */}
              <div className="max-h-[300px] overflow-auto rounded-xl border border-white/10 bg-black/20">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="p-2 text-left w-8"></th>
                      <th className="p-2 text-left">Teacher</th>
                      <th className="p-2 text-left">School</th>
                      <th className="p-2 text-left">Reviews</th>
                      <th className="p-2 text-left">Last contacted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outreachTeachers
                      .filter((t) => {
                        if (outreachFilter === "not-contacted") return !t.lastContactedAt;
                        if (outreachFilter === "contacted") return !!t.lastContactedAt;
                        return true;
                      })
                      .map((t) => (
                        <tr
                          key={t.email}
                          className={`border-b border-white/5 cursor-pointer hover:bg-white/5 ${outreachSelected.has(t.email) ? "bg-blue-500/10" : ""}`}
                          onClick={() => {
                            const next = new Set(outreachSelected);
                            next.has(t.email) ? next.delete(t.email) : next.add(t.email);
                            setOutreachSelected(next);
                          }}
                        >
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={outreachSelected.has(t.email)}
                              readOnly
                              className="accent-blue-500"
                            />
                          </td>
                          <td className="p-2">
                            <div className="text-white/90 font-medium">{t.teacherName || "—"}</div>
                            <div className="text-white/50">{t.email}</div>
                          </td>
                          <td className="p-2 text-white/70">{t.schools?.join(", ") || "—"}</td>
                          <td className="p-2 text-white/70">{t.reviewCount}</td>
                          <td className="p-2">
                            {t.lastContactedAt ? (
                              <span className="text-green-300">{new Date(t.lastContactedAt).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-amber-300">Never</span>
                            )}
                            {t.emailsSent > 0 && <span className="text-white/40 ml-1">({t.emailsSent} sent)</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Send controls */}
              {outreachSelected.size > 0 && (
                <div className="mt-3 rounded-xl border border-blue-400/20 bg-blue-500/5 p-3">
                  <div className="text-xs text-blue-200 font-medium mb-2">
                    Send to {outreachSelected.size} teacher{outreachSelected.size !== 1 ? "s" : ""}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {outreachTemplates.map((tmpl) => (
                      <button
                        key={tmpl.key}
                        onClick={() => setOutreachTemplate(tmpl.key)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          outreachTemplate === tmpl.key
                            ? "bg-blue-500/30 border border-blue-400/50 text-blue-100"
                            : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                        }`}
                      >
                        {tmpl.label}
                      </button>
                    ))}
                  </div>

                  {outreachTemplate === "custom" && (
                    <div className="space-y-2 mb-2">
                      <input
                        value={outreachCustomSubject}
                        onChange={(e) => setOutreachCustomSubject(e.target.value)}
                        placeholder="Custom subject line (optional)"
                        className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-1.5 text-xs text-white/90 placeholder:text-white/30"
                      />
                      <textarea
                        value={outreachCustomBody}
                        onChange={(e) => setOutreachCustomBody(e.target.value)}
                        placeholder="Write your message..."
                        rows={4}
                        className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs text-white/90 placeholder:text-white/30 resize-vertical"
                      />
                    </div>
                  )}

                  {outreachTemplate && outreachTemplate !== "custom" && (
                    <input
                      value={outreachCustomSubject}
                      onChange={(e) => setOutreachCustomSubject(e.target.value)}
                      placeholder="Override subject line (optional)"
                      className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-1.5 text-xs text-white/90 placeholder:text-white/30 mb-2"
                    />
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={sendOutreach}
                      disabled={!outreachTemplate || outreachSending}
                      className={`rounded-lg px-4 py-1.5 text-xs font-bold ${
                        !outreachTemplate || outreachSending
                          ? "bg-white/10 text-white/30 cursor-not-allowed"
                          : "bg-blue-600 text-white hover:bg-blue-500 cursor-pointer"
                      }`}
                    >
                      {outreachSending
                        ? "Sending..."
                        : `Send ${outreachTemplate ? `"${outreachTemplates.find((t) => t.key === outreachTemplate)?.label || outreachTemplate}"` : "..."} to ${outreachSelected.size}`}
                    </button>

                    {outreachResult && (
                      <span className={`text-xs ${outreachResult.error ? "text-red-300" : "text-green-300"}`}>
                        {outreachResult.error
                          ? outreachResult.error
                          : `Sent: ${outreachResult.sent}${outreachResult.failed ? `, failed: ${outreachResult.failed}` : ""}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="mt-6">
          <Card title="Feedback">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="text-xs text-white/60">
                  {feedbackLoading ? "Loading…" : `${feedback.length} message(s)`}
                </div>
                {/* Active / Archived toggle */}
                <div className="flex rounded-lg border border-white/10 overflow-hidden">
                  {[
                    { key: "active", label: "Active" },
                    { key: "archived", label: "Archived" },
                  ].map((v) => (
                    <button
                      key={v.key}
                      onClick={() => { setFeedbackView(v.key); loadFeedback(v.key === "archived"); }}
                      className={`px-3 py-1 text-xs font-medium ${
                        feedbackView === v.key
                          ? "bg-white/15 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => loadFeedback(feedbackView === "archived")}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                disabled={feedbackLoading}
              >
                Refresh
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

                      {/* Archive / Restore / Delete actions */}
                      <div className="mt-2 flex gap-2">
                        {feedbackView === "active" ? (
                          <button
                            onClick={() => feedbackAction(f.id, "archive")}
                            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10 hover:text-white/80"
                          >
                            Archive
                          </button>
                        ) : (
                          <button
                            onClick={() => feedbackAction(f.id, "restore")}
                            className="rounded-md border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-500/20"
                          >
                            Restore
                          </button>
                        )}
                        {feedbackView === "archived" && (
                          <button
                            onClick={() => { if (confirm("Permanently delete this entry?")) feedbackAction(f.id, "delete"); }}
                            className="rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  );})}
                </ul>
              ) : (
                <div className="p-3 text-sm text-white/60">
                  No feedback yet.
                </div>
              )}

              {/* Load more */}
              {feedbackHasMore && feedback.length > 0 && (
                <div className="border-t border-white/10 p-2 text-center">
                  <button
                    onClick={() => loadFeedback(feedbackView === "archived", true)}
                    disabled={feedbackLoading}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white/80"
                  >
                    {feedbackLoading ? "Loading…" : "More"}
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Diagnostic Logs */}
          <Card title="🔧 Task Diagnostic Logs">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={loadDiagLogs}
                disabled={diagLoading}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white/80"
              >
                {diagLoading ? "Loading…" : diagLoaded ? "Refresh" : "Load Logs"}
              </button>
              {diagLogs.length > 0 && (
                <>
                  <button
                    onClick={copyDiagLogs}
                    className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-bold text-blue-400 hover:bg-blue-500/20"
                  >
                    📋 Copy All
                  </button>
                  <button
                    onClick={clearDiagLogs}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/20"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
            {diagLoaded && diagLogs.length === 0 && (
              <div className="text-xs text-white/40 py-2">No diagnostic logs — all clear.</div>
            )}
            {diagLogs.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {diagLogs.map((log, i) => (
                  <div key={log._id || i} className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white/90">{log.tasksetName || "Unnamed"}</span>
                      <span className="text-white/40">{new Date(log.createdAt || log.ts).toLocaleDateString()}</span>
                    </div>
                    {log.teacherNote && (
                      <div className="text-yellow-400/80 mb-1">💬 {log.teacherNote}</div>
                    )}
                    <div className="text-white/50">
                      {log.totalTasks} tasks · {log.issuesFound} issues · {log.issuesFixed} auto-fixed
                    </div>
                    {(log.diagnostics || []).length > 0 && (
                      <div className="mt-1 space-y-1">
                        {log.diagnostics.map((d, j) => (
                          <div key={j} className="pl-2 border-l-2 border-white/10 text-white/50">
                            <span className={d.fixed ? "text-green-400" : "text-amber-400"}>
                              {d.fixed ? "✅" : "⚠️"}
                            </span>{" "}
                            Task {d.taskIndex + 1} ({d.taskType}): {(d.errors || []).join("; ")}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
