"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
  "https://api.curriculate.net";

export default function DemoTaskDescriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]); // task meta list
  const [q, setQ] = useState("");
  const [showOnlyDemoEligible, setShowOnlyDemoEligible] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API_BASE}/api/demo/task-types`, {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t?.slice(0, 200) || "Failed to load"}`);
        }

        const data = await res.json();
        if (cancelled) return;

        const list = Array.isArray(data?.taskTypes) ? data.taskTypes : [];
        setItems(list);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load task descriptions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items
      .filter((x) => (showOnlyDemoEligible ? x.demoEligible === true : true))
      .filter((x) => {
        if (!qq) return true;
        return (
          String(x.type || "").toLowerCase().includes(qq) ||
          String(x.label || "").toLowerCase().includes(qq) ||
          String(x.description || "").toLowerCase().includes(qq) ||
          String(x.category || "").toLowerCase().includes(qq)
        );
      })
      .sort((a, b) => String(a.label || a.type).localeCompare(String(b.label || b.type)));
  }, [items, q, showOnlyDemoEligible]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Curriculate Demo</h1>
        <p style={styles.sub}>
          Demo mode is currently in <b>Preview</b>. Instead of running interactive tasks, this page shows
          what each task is designed to do.
        </p>

        <div style={styles.actions}>
          <a href="https://www.curriculate.net/grading" style={styles.secondaryBtn}>
            Go to Grading Scanner
          </a>
          <a href="https://play.curriculate.net/demo" style={styles.primaryBtn}>
            Launch Interactive Demo
          </a>
        </div>

        <div style={styles.filters}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks (name, description, category)…"
            style={styles.input}
          />
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={showOnlyDemoEligible}
              onChange={(e) => setShowOnlyDemoEligible(e.target.checked)}
            />
            <span style={{ marginLeft: 8 }}>Show only demo-eligible tasks</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div style={styles.card}>Loading tasks…</div>
      ) : err ? (
        <div style={{ ...styles.card, borderColor: "rgba(255,80,80,0.5)" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Couldn’t load task list</div>
          <div style={{ opacity: 0.9 }}>{err}</div>
          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
            Expected endpoint: <code>{API_BASE}/api/demo/task-types</code>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={styles.card}>No tasks match your filters.</div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((t) => (
            <div key={t.type} style={styles.taskCard}>
              <div style={styles.taskTop}>
                <div style={{ fontWeight: 900 }}>
                  {t.label || t.type}
                  <div style={styles.typeLine}>{t.type}</div>
                </div>

                <div style={styles.badges}>
                  {t.category ? <span style={styles.badge}>{t.category}</span> : null}
                  {t.implemented ? (
                    <span style={{ ...styles.badge, ...styles.badgeGood }}>implemented</span>
                  ) : (
                    <span style={{ ...styles.badge, ...styles.badgeWarn }}>preview</span>
                  )}
                  {t.demoEligible ? (
                    <span style={{ ...styles.badge, ...styles.badgeBlue }}>demo eligible</span>
                  ) : (
                    <span style={{ ...styles.badge, opacity: 0.65 }}>not in demo</span>
                  )}
                </div>
              </div>

              <div style={styles.desc}>{t.description || "No description provided yet."}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: 18,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  },
  header: {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 16,
    background: "#fff",
    marginBottom: 14,
  },
  h1: { margin: "2px 0 8px", fontSize: 28, letterSpacing: -0.4 },
  sub: { margin: 0, opacity: 0.82, lineHeight: 1.5 },
  actions: { display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    background: "#111",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 850,
    border: "1px solid rgba(0,0,0,0.2)",
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    background: "#fff",
    color: "#111",
    textDecoration: "none",
    fontWeight: 850,
    border: "1px solid rgba(0,0,0,0.2)",
  },
  filters: { marginTop: 14, display: "grid", gap: 10 },
  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    outline: "none",
    fontSize: 14,
  },
  checkboxRow: { display: "flex", alignItems: "center", fontWeight: 700, opacity: 0.85 },
  card: {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 16,
    background: "#fff",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 12,
  },
  taskCard: {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 14,
    background: "#fff",
  },
  taskTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  typeLine: { marginTop: 4, fontSize: 12, opacity: 0.65, fontWeight: 700 },
  desc: { marginTop: 10, opacity: 0.88, lineHeight: 1.45 },
  badges: { display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
  badge: {
    fontSize: 12,
    fontWeight: 800,
    padding: "5px 9px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "rgba(0,0,0,0.03)",
  },
  badgeGood: { background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.35)" },
  badgeWarn: { background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.35)" },
  badgeBlue: { background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.35)" },
};
