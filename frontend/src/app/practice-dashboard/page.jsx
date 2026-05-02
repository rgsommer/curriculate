"use client";
import React, { useState, useEffect, useMemo } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.curriculate.net";

/* ------------------------------------------------------------------ */
/*  Practice Dashboard — Teacher view of student activity              */
/*  Shows who played, how many tasks they completed, points earned     */
/* ------------------------------------------------------------------ */

export default function PracticeDashboard() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [classroomFilter, setClassroomFilter] = useState("all");
  const [sortBy, setSortBy] = useState("points"); // points | name | tasks | date
  const [expandedRow, setExpandedRow] = useState(null);
  const [tab, setTab] = useState("students"); // students | feedback
  const [feedbackData, setFeedbackData] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Load key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("curriculate_admin_key");
    if (saved) {
      setKey(saved);
      fetchData(saved);
    }
  }, []);

  async function fetchData(apiKey) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ key: apiKey });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (classroomFilter !== "all") params.set("classroom", classroomFilter);

      const resp = await fetch(`${API}/api/conference/activity?${params}`);
      if (!resp.ok) {
        if (resp.status === 401) throw new Error("Invalid admin key");
        throw new Error("Failed to fetch");
      }
      const json = await resp.json();
      setData(json);
      setAuthed(true);
      localStorage.setItem("curriculate_admin_key", apiKey);
    } catch (err) {
      setError(err.message);
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(e) {
    e.preventDefault();
    fetchData(key);
  }

  // Re-fetch when filters change
  useEffect(() => {
    if (authed && key) fetchData(key);
  }, [sourceFilter, classroomFilter]);

  // Fetch feedback summary when switching to feedback tab
  async function fetchFeedback(apiKey) {
    setFeedbackLoading(true);
    try {
      const resp = await fetch(`${API}/api/conference/feedback-summary?key=${apiKey}`);
      if (resp.ok) {
        setFeedbackData(await resp.json());
      }
    } catch (err) {
      console.warn("Failed to fetch feedback:", err);
    } finally {
      setFeedbackLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "feedback" && authed && key && !feedbackData) {
      fetchFeedback(key);
    }
  }, [tab, authed]);

  // Sort leads
  const sortedLeads = useMemo(() => {
    if (!data?.leads) return [];
    const leads = [...data.leads];
    switch (sortBy) {
      case "points":
        return leads.sort((a, b) => b.totalPoints - a.totalPoints);
      case "name":
        return leads.sort((a, b) => a.name.localeCompare(b.name));
      case "tasks":
        return leads.sort((a, b) => b.tasksCompleted - a.tasksCompleted);
      case "date":
        return leads.sort(
          (a, b) => new Date(b.registeredAt) - new Date(a.registeredAt)
        );
      default:
        return leads;
    }
  }, [data?.leads, sortBy]);

  // Auth screen
  if (!authed) {
    return (
      <div style={styles.authOuter}>
        <div style={styles.authCard}>
          <h1 style={styles.authTitle}>Practice Dashboard</h1>
          <p style={styles.authSubtitle}>
            View student activity from conference demos and classroom practice
            sessions.
          </p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Admin API Key"
              style={styles.authInput}
              autoFocus
            />
            {error && <div style={styles.authError}>{error}</div>}
            <button type="submit" disabled={loading} style={styles.authBtn}>
              {loading ? "Checking…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageOuter}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>Practice Dashboard</h1>
          <p style={styles.headerSub}>Student activity across demos & practice</p>
        </div>
        <button
          onClick={() => fetchData(key)}
          disabled={loading}
          style={styles.refreshBtn}
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* Stats */}
      {data && (
        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{data.count}</div>
            <div style={styles.statLabel}>Students</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{data.totalCompleted}</div>
            <div style={styles.statLabel}>Tasks Completed</div>
          </div>
          <div style={styles.statCard}>
            <div style={{ ...styles.statValue, color: "#f59e0b" }}>
              {data.avgPoints}
            </div>
            <div style={styles.statLabel}>Avg Points</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{data.classrooms?.length || 0}</div>
            <div style={styles.statLabel}>Classrooms</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabRow}>
        {["students", "feedback"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...styles.tabBtn,
              borderBottom: tab === t ? "3px solid #3b82f6" : "3px solid transparent",
              color: tab === t ? "#1e293b" : "#94a3b8",
              fontWeight: tab === t ? 800 : 600,
            }}
          >
            {t === "students" ? "Students" : "Task Feedback"}
          </button>
        ))}
      </div>

      {/* --- STUDENTS TAB --- */}
      {tab !== "students" ? null : (
        <>
      {/* Filters */}
      <div style={styles.filtersRow}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Source</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All</option>
            <option value="conference">Conference</option>
            <option value="classroom">Classroom</option>
          </select>
        </div>

        {data?.classrooms?.length > 0 && (
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Classroom</label>
            <select
              value={classroomFilter}
              onChange={(e) => setClassroomFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All</option>
              {data.classrooms.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Sort by</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="points">Points (high → low)</option>
            <option value="tasks">Tasks completed</option>
            <option value="name">Name (A → Z)</option>
            <option value="date">Most recent</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Source</th>
              <th style={{ ...styles.th, textAlign: "center" }}>Completed</th>
              <th style={{ ...styles.th, textAlign: "center" }}>Skipped</th>
              <th style={{ ...styles.th, textAlign: "center" }}>Points</th>
              <th style={styles.th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {sortedLeads.map((lead, i) => (
              <React.Fragment key={lead.email + i}>
                <tr
                  onClick={() =>
                    setExpandedRow(expandedRow === i ? null : i)
                  }
                  style={{
                    ...styles.tr,
                    cursor: "pointer",
                    background: expandedRow === i ? "#f0f9ff" : i % 2 === 0 ? "#fff" : "#fafafa",
                  }}
                >
                  <td style={styles.td}>{i + 1}</td>
                  <td style={{ ...styles.td, fontWeight: 700 }}>{lead.name}</td>
                  <td style={{ ...styles.td, color: "#64748b", fontSize: 13 }}>
                    {lead.email}
                  </td>
                  <td style={styles.td}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        background:
                          lead.source === "classroom" ? "#dbeafe" : "#fef3c7",
                        color:
                          lead.source === "classroom" ? "#1d4ed8" : "#92400e",
                      }}
                    >
                      {lead.source || "conference"}
                    </span>
                  </td>
                  <td style={{ ...styles.td, textAlign: "center", fontWeight: 700, color: "#16a34a" }}>
                    {lead.tasksCompleted}
                  </td>
                  <td style={{ ...styles.td, textAlign: "center", color: "#94a3b8" }}>
                    {lead.tasksSkipped}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "center",
                      fontWeight: 900,
                      fontSize: 16,
                      color: "#f59e0b",
                    }}
                  >
                    {lead.totalPoints}
                  </td>
                  <td style={{ ...styles.td, color: "#64748b", fontSize: 13 }}>
                    {lead.registeredAt
                      ? new Date(lead.registeredAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>

                {/* Expanded row: task details */}
                {expandedRow === i && lead.results?.length > 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div style={styles.expandedPanel}>
                        <div style={styles.expandedTitle}>
                          Task details for {lead.name}
                        </div>
                        <div style={styles.taskBadges}>
                          {lead.results.map((r, j) => (
                            <span
                              key={j}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "4px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                background: r.skipped ? "#f1f5f9" : "#dcfce7",
                                color: r.skipped ? "#94a3b8" : "#15803d",
                                border: r.skipped
                                  ? "1px solid #e2e8f0"
                                  : "1px solid #bbf7d0",
                              }}
                            >
                              {r.skipped ? "⏭" : "✅"} {r.title || r.taskType}
                              {!r.skipped && (
                                <span
                                  style={{
                                    fontWeight: 800,
                                    color: "#f59e0b",
                                    marginLeft: 2,
                                  }}
                                >
                                  +{r.points || 0}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {sortedLeads.length === 0 && (
          <div style={styles.empty}>
            No student activity yet. Share <strong>play.curriculate.net/practice</strong> with
            your students to get started.
          </div>
        )}
      </div>

      {/* Share links */}
      <div style={styles.shareSection}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>
          Share these links with students
        </h3>
        <div style={styles.shareLinks}>
          <div style={styles.shareLink}>
            <span style={styles.shareLinkLabel}>Practice (classroom):</span>
            <code style={styles.shareCode}>play.curriculate.net/practice</code>
          </div>
          <div style={styles.shareLink}>
            <span style={styles.shareLinkLabel}>Conference demo:</span>
            <code style={styles.shareCode}>play.curriculate.net/conference</code>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>
          Tip: Add <code>?classroom=Period3Science</code> to group students by class.
        </p>
      </div>
        </>
      )}

      {/* --- FEEDBACK TAB --- */}
      {tab !== "feedback" ? null : (
        <div style={{ marginTop: 16 }}>
          {feedbackLoading ? (
            <div style={styles.empty}>Loading feedback data…</div>
          ) : !feedbackData ? (
            <div style={styles.empty}>No feedback data available yet.</div>
          ) : (
            <>
              {/* Summary table */}
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Task Type</th>
                      <th style={styles.th}>Title</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Avg Fun</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Avg Clarity</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Responses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackData.summary.map((row, i) => (
                      <tr key={row.taskType} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={{ ...styles.td, fontWeight: 700 }}>{row.taskType}</td>
                        <td style={styles.td}>{row.title}</td>
                        <td style={{ ...styles.td, textAlign: "center" }}>
                          <span style={{
                            fontWeight: 800,
                            color: row.avgFun >= 4 ? "#16a34a" : row.avgFun >= 3 ? "#f59e0b" : "#ef4444",
                          }}>
                            {"★".repeat(Math.round(row.avgFun))}{"☆".repeat(5 - Math.round(row.avgFun))}
                          </span>
                          <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>
                            ({row.avgFun})
                          </span>
                        </td>
                        <td style={{ ...styles.td, textAlign: "center" }}>
                          <span style={{
                            fontWeight: 800,
                            color: row.avgClarity >= 4 ? "#16a34a" : row.avgClarity >= 3 ? "#f59e0b" : "#ef4444",
                          }}>
                            {"★".repeat(Math.round(row.avgClarity))}{"☆".repeat(5 - Math.round(row.avgClarity))}
                          </span>
                          <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>
                            ({row.avgClarity})
                          </span>
                        </td>
                        <td style={{ ...styles.td, textAlign: "center", fontWeight: 600, color: "#64748b" }}>
                          {row.responseCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {feedbackData.summary.length === 0 && (
                  <div style={styles.empty}>
                    No feedback submitted yet. Students will see a quick survey after each task.
                  </div>
                )}
              </div>

              {/* Comments section */}
              {feedbackData.comments.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 12 }}>
                    Student Comments ({feedbackData.comments.length})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {feedbackData.comments.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "12px 16px",
                          borderRadius: 12,
                          background: c.type === "confusing" ? "#fef2f2" : "#f0fdf4",
                          border: c.type === "confusing" ? "1px solid #fecaca" : "1px solid #bbf7d0",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: c.type === "confusing" ? "#dc2626" : "#16a34a",
                            textTransform: "uppercase",
                          }}>
                            {c.type === "confusing" ? "⚠️ Confusing" : "💡 Suggestion"}
                          </span>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>
                            {c.title} · by {c.from}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, color: "#1e293b" }}>
                          "{c.text}"
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = {
  // Auth
  authOuter: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  authCard: {
    width: "100%",
    maxWidth: 400,
    padding: 32,
    borderRadius: 20,
    background: "#fff",
    boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
    textAlign: "center",
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 24,
    lineHeight: 1.5,
  },
  authInput: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
  },
  authError: {
    fontSize: 13,
    color: "#ef4444",
    fontWeight: 600,
    marginBottom: 8,
  },
  authBtn: {
    width: "100%",
    padding: "12px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "#fff",
    fontWeight: 800,
    fontSize: 15,
    cursor: "pointer",
    marginTop: 8,
  },

  // Page
  pageOuter: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 20px 60px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#0f172a",
    margin: 0,
  },
  headerSub: {
    fontSize: 14,
    color: "#64748b",
    margin: "4px 0 0",
  },
  refreshBtn: {
    padding: "8px 18px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    color: "#475569",
  },

  // Stats
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    padding: 20,
    borderRadius: 16,
    background: "#fff",
    border: "1px solid #e2e8f0",
    textAlign: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  statValue: {
    fontSize: 32,
    fontWeight: 900,
    color: "#0f172a",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#94a3b8",
    marginTop: 4,
    textTransform: "uppercase",
  },

  // Tabs
  tabRow: {
    display: "flex",
    gap: 0,
    marginBottom: 20,
    borderBottom: "1px solid #e2e8f0",
  },
  tabBtn: {
    padding: "10px 20px",
    fontSize: 14,
    cursor: "pointer",
    background: "none",
    border: "none",
    transition: "all 0.15s",
  },

  // Filters
  filtersRow: {
    display: "flex",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  filterSelect: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 13,
    background: "#fff",
    color: "#334155",
    cursor: "pointer",
  },

  // Table
  tableWrapper: {
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    background: "#fff",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    marginBottom: 32,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  },
  th: {
    padding: "12px 14px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    borderBottom: "2px solid #e2e8f0",
    background: "#f8fafc",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
    transition: "background 0.15s",
  },
  td: {
    padding: "10px 14px",
    fontSize: 14,
    color: "#1e293b",
    whiteSpace: "nowrap",
  },
  expandedPanel: {
    padding: "12px 20px 16px",
    background: "#f0f9ff",
    borderTop: "1px solid #bfdbfe",
    borderBottom: "1px solid #bfdbfe",
  },
  expandedTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1e40af",
    marginBottom: 8,
  },
  taskBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  empty: {
    padding: 40,
    textAlign: "center",
    fontSize: 15,
    color: "#94a3b8",
  },

  // Share
  shareSection: {
    padding: 24,
    borderRadius: 16,
    background: "#fff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  shareLinks: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  shareLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  shareLinkLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    minWidth: 160,
  },
  shareCode: {
    padding: "6px 12px",
    borderRadius: 8,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    fontSize: 13,
    fontWeight: 600,
    color: "#3b82f6",
    fontFamily: "monospace",
  },
};
