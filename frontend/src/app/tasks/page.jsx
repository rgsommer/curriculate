"use client";

// frontend/src/app/tasks/page.jsx
//
// Personal "/tasks" app at www.curriculate.net/tasks.
// Self-contained: passwordless email+PIN auth via /api/tasks-app/* on the
// backend. Stores its own JWT in localStorage so it doesn't collide with
// any other auth on the public site.
//
// Requires:
//   NEXT_PUBLIC_BACKEND_URL=https://api.curriculate.net

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";

// ── Config ───────────────────────────────────────────────────────────

function stripTrailingSlash(s) {
  return String(s || "").replace(/\/+$/, "");
}

const BACKEND_URL =
  stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

const TOKEN_KEY = "lifeTasks.token";
const ME_KEY = "lifeTasks.me";

const CATEGORIES = [
  { id: "work", label: "Work", color: "#2563eb" },
  { id: "family", label: "Family", color: "#16a34a" },
  { id: "church", label: "Church", color: "#9333ea" },
];

// Due-date urgency tiers — derived each render so colors update with time.
function urgencyFor(task) {
  if (task.completedAt) return "done";
  if (!task.dueAt) return "none";
  const due = new Date(task.dueAt);
  const now = new Date();
  const ms = due.getTime() - now.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (ms < 0) return "overdue";
  const isSameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  if (isSameDay || ms <= oneDay) return "today";
  if (ms <= 3 * oneDay) return "soon";
  return "later";
}

const URGENCY_STYLES = {
  overdue: { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", label: "Overdue" },
  today:   { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c", label: "Today" },
  soon:    { bg: "#fefce8", border: "#fde68a", text: "#a16207", label: "This week" },
  later:   { bg: "#f8fafc", border: "#e2e8f0", text: "#475569", label: "Later" },
  none:    { bg: "#ffffff", border: "#e5e7eb", text: "#64748b", label: "No date" },
  done:    { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", label: "Done" },
};

// ── Storage + API helpers ────────────────────────────────────────────

function getToken() {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t) {
  if (typeof window === "undefined") return;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
function getStoredMe() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setStoredMe(me) {
  if (typeof window === "undefined") return;
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {}
}

async function apiCall(path, { method = "GET", body, token } = {}) {
  const url = `${BACKEND_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Date helpers ─────────────────────────────────────────────────────

function fmtDue(task) {
  if (!task.dueAt) return "No due date";
  const d = new Date(task.dueAt);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  if (isTomorrow) return `Tomorrow, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Returns "2026-05-15T17:30" — suitable for <input type="datetime-local">.
function toLocalInputValue(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sortActive(a, b) {
  const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

// ── Login screen ─────────────────────────────────────────────────────

function LoginScreen({ onAuthed }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const pinInputRef = useRef(null);

  async function handleRequestPin(e) {
    e?.preventDefault?.();
    setError(""); setHint("");
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiCall("/api/tasks-app/auth/request-pin", {
        method: "POST", body: { email: trimmed },
      });
      setStep("pin");
      setHint("We just emailed you a 6-digit code. It expires in 10 minutes.");
      if (res?.devPin) {
        setHint(`Dev mode — your PIN is ${res.devPin}`);
        setPin(res.devPin);
      }
      setTimeout(() => pinInputRef.current?.focus(), 50);
    } catch (err) {
      setError(err?.message || "Could not send PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyPin(e) {
    e?.preventDefault?.();
    setError("");
    const cleanPin = pin.replace(/\s/g, "");
    if (!/^\d{6}$/.test(cleanPin)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiCall("/api/tasks-app/auth/verify-pin", {
        method: "POST", body: { email: email.trim().toLowerCase(), pin: cleanPin },
      });
      if (!res?.token) throw new Error("Sign-in failed.");
      setToken(res.token);
      setStoredMe(res.user);
      onAuthed(res.token, res.user);
    } catch (err) {
      setError(err?.message || "Could not verify code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.authWrap}>
      <div style={styles.authCard}>
        <div style={styles.brandTitle}>Tasks</div>
        <div style={styles.brandSubtitle}>
          A simple list of what's next. Sign in with your email — we'll send a code.
        </div>

        {step === "email" && (
          <form onSubmit={handleRequestPin} style={{ marginTop: 24 }}>
            <label style={styles.label}>Email</label>
            <input
              type="email" autoFocus autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={styles.input} disabled={busy}
            />
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" style={styles.primaryBtn} disabled={busy}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
          </form>
        )}

        {step === "pin" && (
          <form onSubmit={handleVerifyPin} style={{ marginTop: 24 }}>
            <label style={styles.label}>6-digit code</label>
            <input
              ref={pinInputRef} type="text" inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="123456"
              style={{ ...styles.input, fontSize: 24, letterSpacing: 8, textAlign: "center" }}
              disabled={busy}
            />
            {hint && <div style={styles.hint}>{hint}</div>}
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" style={styles.primaryBtn} disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("email"); setPin(""); setError(""); setHint(""); }}
              style={styles.linkBtn} disabled={busy}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Add-task form ────────────────────────────────────────────────────

function AddTaskForm({ onAdd }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("family");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setErr(""); setBusy(true);
    try {
      await onAdd({
        title: title.trim(),
        category,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setTitle(""); setDueAt("");
    } catch (e) {
      setErr(e?.message || "Couldn't add task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.addForm}>
      <input
        type="text"
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ ...styles.input, marginBottom: 0 }}
        disabled={busy}
        maxLength={500}
      />
      <div style={styles.addRow}>
        <div style={styles.catPicker} role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button
              type="button" key={c.id}
              onClick={() => setCategory(c.id)}
              style={{
                ...styles.catPill,
                ...(category === c.id
                  ? { background: c.color, color: "#fff", borderColor: c.color }
                  : { color: c.color, borderColor: "#e5e7eb" }),
              }}
              aria-pressed={category === c.id}
              disabled={busy}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local" value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          style={styles.dueInput} disabled={busy}
        />
        <button type="submit" style={styles.addBtn} disabled={busy || !title.trim()}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {err && <div style={styles.error}>{err}</div>}
    </form>
  );
}

// ── Task row ─────────────────────────────────────────────────────────

function TaskRow({ task, onEdit, onComplete, onUncomplete }) {
  const cat = CATEGORIES.find((c) => c.id === task.category) || CATEGORIES[1];
  const u = urgencyFor(task);
  const palette = URGENCY_STYLES[u] || URGENCY_STYLES.none;
  const completed = !!task.completedAt;

  // Disambiguate single-tap (edit) from double-tap (complete) by deferring
  // the single-tap action ~260ms. If a second tap arrives, we cancel the
  // pending edit and fire complete instead. This works for both mouse and
  // touch since onClick handles both cleanly on modern devices.
  const tapTimer = useRef(null);
  const isUnmounted = useRef(false);
  useEffect(() => () => {
    isUnmounted.current = true;
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  function clearPending() {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  }

  function handleClick() {
    clearPending();
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (!isUnmounted.current) onEdit(task);
    }, 260);
  }

  function handleDoubleClick() {
    clearPending();
    if (completed) onUncomplete(task);
    else onComplete(task);
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        ...styles.taskRow,
        background: palette.bg,
        borderColor: palette.border,
        opacity: completed ? 0.7 : 1,
      }}
      title={completed
        ? "Tap to edit · double-tap to bring back"
        : "Tap to edit · double-tap to complete"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: cat.color, flex: "0 0 auto" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 16, fontWeight: 500, color: "#0f172a",
            textDecoration: completed ? "line-through" : "none",
            wordBreak: "break-word",
          }}>
            {task.title}
          </div>
          <div style={{ fontSize: 12, color: palette.text, marginTop: 2 }}>
            {cat.label} · {fmtDue(task)}
            {!completed && task.dueAt && u !== "later" && u !== "none" ? (
              <span style={{ marginLeft: 8, fontWeight: 600 }}>· {palette.label}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit modal ───────────────────────────────────────────────────────

function EditTaskModal({ task, onClose, onSave, onDelete, onComplete, onUncomplete }) {
  const [title, setTitle] = useState(task.title);
  const [category, setCategory] = useState(task.category);
  const [dueAt, setDueAt] = useState(toLocalInputValue(task.dueAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const completed = !!task.completedAt;

  // Close on ESC
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave(e) {
    e?.preventDefault?.();
    const trimmed = title.trim();
    if (!trimmed) { setErr("Title is required."); return; }
    setBusy(true); setErr("");
    try {
      await onSave(task, {
        title: trimmed,
        category,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onClose();
    } catch (e) {
      setErr(e?.message || "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setBusy(true);
    try {
      await onDelete(task);
      onClose();
    } catch (e) {
      setErr(e?.message || "Couldn't delete.");
      setBusy(false);
    }
  }

  function handleToggleComplete() {
    if (completed) onUncomplete(task);
    else onComplete(task);
    onClose();
  }

  return (
    <div
      style={styles.modalBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-task-title"
    >
      <form onSubmit={handleSave} style={styles.modalCard}>
        <div id="edit-task-title" style={styles.modalHeader}>
          Edit task
          {completed && <span style={styles.completedPill}>Completed</span>}
        </div>

        {completed && (
          <button
            type="button"
            onClick={handleToggleComplete}
            style={styles.reactivateBtn}
            disabled={busy}
          >
            ↻ Re-activate this task
          </button>
        )}

        <label style={styles.label}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={500}
          style={styles.input}
          disabled={busy}
        />

        <label style={styles.label}>Category</label>
        <div style={{ ...styles.catPicker, marginBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <button
              type="button" key={c.id}
              onClick={() => setCategory(c.id)}
              style={{
                ...styles.catPill,
                ...(category === c.id
                  ? { background: c.color, color: "#fff", borderColor: c.color }
                  : { color: c.color, borderColor: "#e5e7eb" }),
              }}
              aria-pressed={category === c.id}
              disabled={busy}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label style={styles.label}>Due</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <input
            type="datetime-local" value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            style={{ ...styles.dueInput, flex: 1 }}
            disabled={busy}
          />
          {dueAt && (
            <button
              type="button" onClick={() => setDueAt("")}
              style={styles.subtleBtn} disabled={busy}
              title="Clear due date"
            >
              Clear
            </button>
          )}
        </div>

        {err && <div style={styles.error}>{err}</div>}

        <div style={styles.modalActions}>
          <button type="button" onClick={handleDelete} style={styles.dangerBtn} disabled={busy}>
            Delete
          </button>
          <div style={{ flex: 1 }} />
          {!completed && (
            <button type="button" onClick={handleToggleComplete} style={styles.subtleBtn} disabled={busy}>
              Mark complete
            </button>
          )}
          <button type="button" onClick={onClose} style={styles.subtleBtn} disabled={busy}>
            Cancel
          </button>
          <button type="submit" style={styles.primaryBtnSm} disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main app (after auth) ────────────────────────────────────────────

function TasksApp({ token, me, onSignOut }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("active");
  const [filterCat, setFilterCat] = useState("all");
  const [editing, setEditing] = useState(null); // task being edited
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await apiCall("/api/tasks-app/tasks", { token });
      setTasks(res.tasks || []);
      setError("");
    } catch (err) {
      if (err.status === 401) { onSignOut(); return; }
      setError(err?.message || "Couldn't load tasks.");
    } finally {
      setLoading(false);
    }
  }, [token, onSignOut]);

  useEffect(() => { refresh(); }, [refresh]);

  async function addTask(payload) {
    const res = await apiCall("/api/tasks-app/tasks", { method: "POST", body: payload, token });
    setTasks((prev) => [...prev, res.task]);
  }

  async function patchTask(task, patch) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    try {
      const res = await apiCall(`/api/tasks-app/tasks/${task.id}`, { method: "PATCH", body: patch, token });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.task : t)));
    } catch (e) {
      refresh();
    }
  }

  function complete(task) { patchTask(task, { completed: true }); }
  function uncomplete(task) { patchTask(task, { completed: false }); }

  // Save from edit modal — returns a promise so the modal can show its own busy state.
  async function saveEdit(task, patch) {
    const res = await apiCall(`/api/tasks-app/tasks/${task.id}`, {
      method: "PATCH", body: patch, token,
    });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? res.task : t)));
  }

  async function removeFromModal(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await apiCall(`/api/tasks-app/tasks/${task.id}`, { method: "DELETE", token });
  }

  const { active, completed, nextUp } = useMemo(() => {
    const a = tasks.filter((t) => !t.completedAt);
    const c = tasks.filter((t) => t.completedAt)
      .sort((x, y) => new Date(y.completedAt) - new Date(x.completedAt));
    a.sort(sortActive);
    const filteredA = filterCat === "all" ? a : a.filter((t) => t.category === filterCat);
    return { active: filteredA, completed: c, nextUp: a[0] || null };
  }, [tasks, filterCat]);

  return (
    <div style={styles.appWrap}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={styles.h1}>Tasks</h1>
          <span style={styles.headerSubtle}>{me?.email}</span>
        </div>
        <button onClick={onSignOut} style={styles.signOutBtn}>Sign out</button>
      </header>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading…</div>
      ) : (
        <>
          {nextUp && tab === "active" && (
            <div
              onClick={() => setEditing(nextUp)}
              onDoubleClick={(e) => { e.stopPropagation(); complete(nextUp); }}
              style={{
                ...styles.hero,
                ...(URGENCY_STYLES[urgencyFor(nextUp)] && {
                  borderColor: URGENCY_STYLES[urgencyFor(nextUp)].border,
                  background: URGENCY_STYLES[urgencyFor(nextUp)].bg,
                }),
              }}
              title="Tap to edit · double-tap to complete"
            >
              <div style={styles.heroLabel}>Next up</div>
              <div style={styles.heroTitle}>{nextUp.title}</div>
              <div style={{ ...styles.heroMeta, color: URGENCY_STYLES[urgencyFor(nextUp)].text }}>
                {(CATEGORIES.find((c) => c.id === nextUp.category) || {}).label || "Family"} · {fmtDue(nextUp)} · {URGENCY_STYLES[urgencyFor(nextUp)].label}
              </div>
            </div>
          )}

          <AddTaskForm onAdd={addTask} />

          <div style={styles.tabs}>
            <button type="button" onClick={() => setTab("active")}
              style={{ ...styles.tab, ...(tab === "active" ? styles.tabActive : {}) }}>
              Active <span style={styles.tabCount}>{tasks.filter((t) => !t.completedAt).length}</span>
            </button>
            <button type="button" onClick={() => setTab("completed")}
              style={{ ...styles.tab, ...(tab === "completed" ? styles.tabActive : {}) }}>
              Completed <span style={styles.tabCount}>{completed.length}</span>
            </button>
          </div>

          {tab === "active" && (
            <div style={styles.catFilterRow}>
              <button type="button" onClick={() => setFilterCat("all")}
                style={{ ...styles.catFilterPill, ...(filterCat === "all" ? styles.catFilterActive : {}) }}>
                All
              </button>
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button" onClick={() => setFilterCat(c.id)}
                  style={{
                    ...styles.catFilterPill,
                    ...(filterCat === c.id
                      ? { ...styles.catFilterActive, background: c.color, borderColor: c.color, color: "#fff" }
                      : { color: c.color }),
                  }}>
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {tab === "active" && active.length === 0 && (
              <div style={styles.empty}>Nothing here. Add a task above to get started.</div>
            )}
            {tab === "completed" && completed.length === 0 && (
              <div style={styles.empty}>Completed tasks will appear here.</div>
            )}

            {(tab === "active" ? active : completed).map((task) => (
              <TaskRow
                key={task.id} task={task}
                onEdit={setEditing}
                onComplete={complete}
                onUncomplete={uncomplete}
              />
            ))}
          </div>

          <div style={styles.footHint}>Tip: tap to edit · double-tap to complete.</div>
        </>
      )}

      {editing && (
        <EditTaskModal
          task={editing}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onDelete={removeFromModal}
          onComplete={complete}
          onUncomplete={uncomplete}
        />
      )}
    </div>
  );
}

// ── Top-level page component ─────────────────────────────────────────

export default function TasksPage() {
  // Defer reads of localStorage to after mount so SSR + hydration agree.
  const [hydrated, setHydrated] = useState(false);
  const [token, setTok] = useState(null);
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    setMe(getStoredMe());
    setChecking(!!t);
    setHydrated(true);
  }, []);

  // Validate stored token against /me on mount.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    if (!token) { setChecking(false); return; }

    (async () => {
      try {
        const res = await apiCall("/api/tasks-app/me", { token });
        if (!cancelled && res?.user) {
          setMe(res.user);
          setStoredMe(res.user);
        }
      } catch (err) {
        if (!cancelled) {
          setToken(null); setStoredMe(null); setTok(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, token]);

  function handleSignOut() {
    setToken(null); setStoredMe(null);
    setTok(null); setMe(null);
  }

  function handleAuthed(t, u) {
    setTok(t); setMe(u);
  }

  // Pre-hydration: render an empty shell to keep SSR markup stable.
  if (!hydrated) {
    return <div style={styles.page} />;
  }

  return (
    <div style={styles.page}>
      {checking ? (
        <div style={{ padding: 60, textAlign: "center", color: "#64748b" }}>Loading…</div>
      ) : !token ? (
        <LoginScreen onAuthed={handleAuthed} />
      ) : (
        <TasksApp token={token} me={me} onSignOut={handleSignOut} />
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#0f172a",
    WebkitFontSmoothing: "antialiased",
  },
  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px", minHeight: "100vh" },
  authCard: {
    width: "100%", maxWidth: 400,
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 32,
    boxShadow: "0 4px 24px rgba(15,23,42,0.04)",
  },
  brandTitle: { fontSize: 28, fontWeight: 700, letterSpacing: -0.5 },
  brandSubtitle: { marginTop: 8, fontSize: 14, color: "#64748b", lineHeight: 1.5 },
  label: { display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 6 },
  input: {
    width: "100%", boxSizing: "border-box",
    padding: "12px 14px", fontSize: 15,
    borderRadius: 10, border: "1px solid #e2e8f0",
    background: "#fff", color: "#0f172a", marginBottom: 12, outline: "none",
  },
  primaryBtn: {
    width: "100%", marginTop: 8,
    padding: "12px 16px", fontSize: 15, fontWeight: 600,
    borderRadius: 10, border: "none",
    background: "#0f172a", color: "#fff", cursor: "pointer",
  },
  linkBtn: {
    display: "block", margin: "12px auto 0", padding: 4,
    background: "transparent", border: "none",
    color: "#64748b", fontSize: 13, cursor: "pointer", textDecoration: "underline",
  },
  error: {
    marginTop: 8, padding: "8px 12px",
    background: "#fef2f2", color: "#b91c1c",
    border: "1px solid #fecaca", borderRadius: 8, fontSize: 13,
  },
  hint: { marginTop: 4, marginBottom: 8, fontSize: 13, color: "#475569" },
  appWrap: { maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },
  h1: { margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 },
  headerSubtle: { fontSize: 13, color: "#94a3b8" },
  signOutBtn: {
    background: "transparent", border: "1px solid #e2e8f0",
    color: "#64748b", padding: "6px 12px",
    fontSize: 13, borderRadius: 8, cursor: "pointer",
  },
  hero: {
    border: "1px solid #e2e8f0", background: "#fff",
    borderRadius: 16, padding: 20, marginBottom: 20,
    cursor: "pointer", userSelect: "none",
  },
  heroLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#94a3b8" },
  heroTitle: { marginTop: 6, fontSize: 22, fontWeight: 600, lineHeight: 1.3, color: "#0f172a", wordBreak: "break-word" },
  heroMeta: { marginTop: 8, fontSize: 13, fontWeight: 500 },
  addForm: {
    background: "#fff", border: "1px solid #e5e7eb",
    borderRadius: 14, padding: 14,
    display: "flex", flexDirection: "column", gap: 10,
  },
  addRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  catPicker: { display: "flex", gap: 6, flexWrap: "wrap" },
  catPill: {
    padding: "6px 12px", fontSize: 13, fontWeight: 600,
    borderRadius: 999, border: "1px solid #e5e7eb",
    background: "#fff", cursor: "pointer",
  },
  dueInput: {
    flex: "1 1 180px", minWidth: 160,
    padding: "8px 10px", fontSize: 13,
    borderRadius: 10, border: "1px solid #e2e8f0",
    background: "#fff", color: "#0f172a", outline: "none",
  },
  addBtn: {
    padding: "8px 16px", fontSize: 14, fontWeight: 600,
    borderRadius: 10, border: "none",
    background: "#0f172a", color: "#fff", cursor: "pointer",
  },
  tabs: { marginTop: 24, display: "flex", gap: 6, borderBottom: "1px solid #e5e7eb" },
  tab: {
    padding: "10px 14px", background: "transparent", border: "none",
    fontSize: 14, fontWeight: 500, color: "#64748b",
    cursor: "pointer", borderBottom: "2px solid transparent", marginBottom: -1,
  },
  tabActive: { color: "#0f172a", fontWeight: 600, borderBottomColor: "#0f172a" },
  tabCount: { marginLeft: 4, fontSize: 12, color: "#94a3b8" },
  catFilterRow: { marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" },
  catFilterPill: {
    padding: "5px 12px", fontSize: 12, fontWeight: 600,
    borderRadius: 999, border: "1px solid #e5e7eb",
    background: "#fff", color: "#475569", cursor: "pointer",
  },
  catFilterActive: { background: "#0f172a", color: "#fff", borderColor: "#0f172a" },
  taskRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px", border: "1px solid #e5e7eb",
    borderRadius: 12, cursor: "pointer", userSelect: "none",
    transition: "background-color 120ms ease, opacity 120ms ease",
  },
  iconBtn: {
    flex: "0 0 auto", width: 28, height: 28,
    borderRadius: 14, border: "1px solid #e5e7eb",
    background: "#fff", color: "#94a3b8",
    fontSize: 18, lineHeight: 1, cursor: "pointer",
  },
  empty: {
    padding: "32px 16px", textAlign: "center",
    color: "#94a3b8", fontSize: 14,
    background: "#fff", border: "1px dashed #e5e7eb", borderRadius: 12,
  },
  footHint: { marginTop: 24, textAlign: "center", fontSize: 12, color: "#94a3b8" },
  // Modal
  modalBackdrop: {
    position: "fixed", inset: 0,
    background: "rgba(15,23,42,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16, zIndex: 50,
  },
  modalCard: {
    width: "100%", maxWidth: 460,
    background: "#fff", borderRadius: 16,
    border: "1px solid #e5e7eb",
    padding: 20,
    boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
    maxHeight: "calc(100vh - 32px)",
    overflowY: "auto",
  },
  modalHeader: {
    fontSize: 16, fontWeight: 700, color: "#0f172a",
    marginBottom: 16,
    display: "flex", alignItems: "center", gap: 10,
  },
  completedPill: {
    fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    textTransform: "uppercase",
    background: "#dcfce7", color: "#166534",
    padding: "3px 8px", borderRadius: 999,
    border: "1px solid #bbf7d0",
  },
  reactivateBtn: {
    width: "100%",
    marginBottom: 16,
    padding: "12px 16px",
    fontSize: 15, fontWeight: 600,
    borderRadius: 10,
    border: "1px solid #16a34a",
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  },
  modalActions: {
    marginTop: 18,
    display: "flex", flexWrap: "wrap", gap: 8,
    alignItems: "center",
  },
  dangerBtn: {
    padding: "8px 12px", fontSize: 13, fontWeight: 600,
    borderRadius: 8, border: "1px solid #fecaca",
    background: "#fff", color: "#b91c1c",
    cursor: "pointer",
  },
  subtleBtn: {
    padding: "8px 12px", fontSize: 13, fontWeight: 500,
    borderRadius: 8, border: "1px solid #e2e8f0",
    background: "#fff", color: "#475569",
    cursor: "pointer",
  },
  primaryBtnSm: {
    padding: "8px 16px", fontSize: 14, fontWeight: 600,
    borderRadius: 8, border: "none",
    background: "#0f172a", color: "#fff",
    cursor: "pointer",
  },
};
