// student-app/src/pages/PreviewPage.jsx
//
// Teacher "Test run" preview. Opened from the teacher app as
//   /preview?id=<tasksetId>
// Loads a taskset (read-only, public preview endpoint) and lets the teacher
// step through every task EXACTLY as a student would see it — rendered through
// the real TaskRunner, with a stub socket and practiceMode so there are no QR
// scans, no live session, and image/paper tasks use bundled fallbacks.
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { getTaskTypeMeta, normalizeTaskType } from "../../../shared/taskTypes.js";
import { API_BASE_URL } from "../config.js";

// Stub socket so TaskRunner + team task types don't crash without a live room.
function makeStubSocket() {
  return {
    connected: true,
    on: () => {},
    off: () => {},
    emit: (_event, _payload, ack) => {
      if (typeof ack === "function") ack({ ok: true, preview: true });
    },
  };
}

export default function PreviewPage() {
  const [taskset, setTaskset] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [runKey, setRunKey] = useState(0); // bump to remount TaskRunner (replay a task)
  const socket = useMemo(() => makeStubSocket(), []);

  const tasksetId = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("id") || p.get("taskset") || "";
    } catch {
      return "";
    }
  }, []);

  // Give bot rosters a friendly name in practice rendering.
  useEffect(() => {
    try {
      window.__CURRICULATE_PRACTICE__ = { name: "Teacher", source: "preview", conference: "preview" };
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!tasksetId) {
      setError("No taskset id provided.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/tasksets/${encodeURIComponent(tasksetId)}/preview`);
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !j?.ok || !j.taskset) {
          setError(j?.error || "Could not load this taskset.");
        } else if (!Array.isArray(j.taskset.tasks) || j.taskset.tasks.length === 0) {
          setTaskset(j.taskset);
          setError("This taskset has no tasks to preview.");
        } else {
          setTaskset(j.taskset);
        }
      } catch {
        if (!cancelled) setError("Network error loading the taskset.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tasksetId]);

  const tasks = Array.isArray(taskset?.tasks) ? taskset.tasks : [];
  const total = tasks.length;
  const currentTask = tasks[index] || null;

  const goTo = (i) => {
    const next = Math.max(0, Math.min(total - 1, i));
    setIndex(next);
    setRunKey((k) => k + 1);
  };
  const handleSubmit = () => {
    // Advance to the next task on submit (last task just stays, showing its result).
    if (index < total - 1) goTo(index + 1);
  };

  const typeLabel = (t) => {
    const ty = normalizeTaskType(t?.taskType || t?.type);
    return getTaskTypeMeta(ty)?.label || ty || "Task";
  };

  // Inject roomCode/teamId so scan-gated/team tasks have something to read.
  const previewTask = useMemo(() => {
    if (!currentTask) return null;
    const t = { ...currentTask, roomCode: "PREVIEW", teamId: "preview-team", _previewMode: true };
    // current-events resolves over a live socket in real sessions; in preview
    // there's no socket, so let it fetch a real story over HTTP (same as the
    // practice demo) instead of spinning on "Loading…".
    const ty = normalizeTaskType(t.taskType || t.type);
    if (ty === "current-events" && !t?.config?.resolved) {
      t.config = { ...(t.config || {}), liveResolveInPractice: true };
    }
    return t;
  }, [currentTask]);

  const shell = {
    minHeight: "100vh",
    background: "radial-gradient(circle at top, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
    color: "#e2e8f0",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  };

  if (loading) {
    return (
      <div style={{ ...shell, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 44, height: 44, border: "4px solid rgba(255,255,255,0.2)", borderTopColor: "#a78bfa", borderRadius: "50%", margin: "0 auto 12px", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          Loading taskset…
        </div>
      </div>
    );
  }

  if (error && !currentTask) {
    return (
      <div style={{ ...shell, display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🧪</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Test run unavailable</div>
          <div style={{ opacity: 0.85 }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...shell, padding: 14 }}>
      {/* Header / controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: "#a78bfa", background: "rgba(124,58,237,0.18)", padding: "4px 10px", borderRadius: 999 }}>
          🧪 Test run
        </span>
        <span style={{ fontWeight: 800 }}>{taskset?.name || "Taskset"}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.85 }}>
          Task {index + 1} of {total} · {typeLabel(currentTask)}
        </span>
      </div>

      {/* Task jump bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tasks.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            title={typeLabel(t)}
            style={{
              width: 30, height: 30, borderRadius: 8, cursor: "pointer",
              border: i === index ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.15)",
              background: i === index ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.06)",
              color: "#e2e8f0", fontWeight: 800, fontSize: 12,
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Prev / Next */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}
          style={navBtn(index === 0)}>← Prev</button>
        <button type="button" onClick={() => { setRunKey((k) => k + 1); }}
          style={navBtn(false)}>↻ Replay</button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index >= total - 1}
          style={navBtn(index >= total - 1)}>Next →</button>
      </div>

      {/* The real student renderer */}
      {previewTask && (
        <div style={{ background: "rgba(255,255,255,0.96)", borderRadius: 16, overflow: "hidden", color: "#0f172a" }}>
          <TaskRunner
            key={runKey}
            task={previewTask}
            socket={socket}
            roomCode="PREVIEW"
            teamId="preview-team"
            demoMode={true}
            practiceMode={true}
            memberNames={["Teacher", "Ada", "Newton"]}
            onSubmit={handleSubmit}
            onComplete={handleSubmit}
            onDone={handleSubmit}
            setShowInstructions={() => {}}
          />
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
        Teacher preview — no QR scans, no live session. Bots/teammates are simulated.
      </div>
    </div>
  );
}

function navBtn(disabled) {
  return {
    padding: "8px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)",
    color: "#e2e8f0",
    fontWeight: 800,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
