// student-app/src/pages/DemoPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { TASK_TYPES } from "../../../shared/taskTypes.js";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.curriculate.net";

// Define which types are “physical” to skip AI scoring + overlay
const PHYSICAL_TYPES = new Set([
  TASK_TYPES.BODY_BREAK,
  TASK_TYPES.MAD_DASH_SEQUENCE,
  TASK_TYPES.MAD_DASH,
  // add the rest of your movement/physical types here
].map((x) => String(x).toLowerCase()));

function isPhysicalTask(task) {
  const t = String(task?.taskType || task?.type || "").toLowerCase();
  return !!(task?.isPhysical || task?.config?.isPhysical || task?.movement || task?.config?.movement) || PHYSICAL_TYPES.has(t);
}

export default function DemoPage() {
  const [phase, setPhase] = useState("mood"); // mood | runner | task
  const [demoTaskset, setDemoTaskset] = useState(null);
  const [selectedType, setSelectedType] = useState("");
  const [currentTask, setCurrentTask] = useState(null);

  // Review lock like StudentApp
  const [taskLocked, setTaskLocked] = useState(false);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const postSubmitTimerRef = useRef(null);

  const allTaskTypes = useMemo(() => {
    // TaskTypes list from shared
    return Object.values(TASK_TYPES)
      .filter((v) => typeof v === "string")
      .sort((a, b) => a.localeCompare(b));
  }, []);

  async function loadDemoTaskset() {
    const res = await fetch(`${API_BASE}/api/demo/taskset`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to load demo taskset");
    setDemoTaskset(json.taskset);
  }

  async function regenerateDemoTaskset(adminKey) {
    const res = await fetch(`${API_BASE}/api/demo/taskset/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(adminKey ? { "x-demo-admin-key": adminKey } : {}),
      },
      body: JSON.stringify({}), // keep open for future config
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to regenerate demo taskset");
    setDemoTaskset(json.taskset);
  }

  useEffect(() => {
    loadDemoTaskset().catch((e) => {
      console.error(e);
      // remain usable even without demo pool
      setDemoTaskset({ tasks: [] });
    });
  }, []);

  // pick task from demo pool by taskType
  function pickDemoTask(type) {
    const tasks = demoTaskset?.tasks || demoTaskset?.items || [];
    const match = tasks.find((t) => (t.taskType || t.type) === type);
    if (match) return match;

    // fallback: create a minimal placeholder to at least load component
    return { taskType: type, title: `Demo: ${type}`, prompt: "Demo task", timeLimitSeconds: 60, points: 10 };
  }

  function endReviewLock() {
    if (postSubmitTimerRef.current) {
      clearInterval(postSubmitTimerRef.current);
      postSubmitTimerRef.current = null;
    }
    setTaskLocked(false);
    setPostSubmitSecondsLeft(null);
    setPhase("runner");
    setCurrentTask(null);
    setSelectedType("");
  }

  async function handleSubmit(payload) {
    const task = currentTask;
    if (!task) return;

    const physical = isPhysicalTask(task);

    // Demo scoring should mirror StudentApp:
    // - physical: no AI scoring, no overlay; just return to runner
    // - non-physical: call backend scoring (same endpoint your StudentApp uses)
    if (physical) {
      endReviewLock();
      return;
    }

    // REVIEW LOCK
    const lockSeconds = 15;
    setTaskLocked(true);
    setPostSubmitSecondsLeft(lockSeconds);

    if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);
    let t = lockSeconds;
    postSubmitTimerRef.current = setInterval(() => {
      t -= 1;
      setPostSubmitSecondsLeft(t);
      if (t <= 0) endReviewLock();
    }, 1000);

    try {
      // Use your existing scoring endpoint.
      // Replace this path with the same one StudentApp hits.
      const res = await fetch(`${API_BASE}/api/ai/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "demo",
          task,
          submission: payload,
        }),
      });

      const json = await res.json();
      if (!json.ok) {
        console.warn("Demo scoring failed:", json.error);
      }
      // You can show score feedback here if desired
    } catch (e) {
      console.warn("Demo scoring error:", e);
    }
  }

  // Admin: allow regen via query param + prompt key
  async function onAdminRegenerate() {
    const key = window.prompt("Enter demo admin key:");
    if (!key) return;
    try {
      await regenerateDemoTaskset(key);
      alert("Demo taskset regenerated.");
    } catch (e) {
      alert(e.message || "Failed to regenerate");
    }
  }

  // Mood task seed
  const moodTask = useMemo(() => ({
    taskType: TASK_TYPES.MOOD_CHECKIN,
    title: "Mood Check-in",
    prompt: "How are you doing today?",
    timeLimitSeconds: 45,
    points: 0,
  }), []);

  const runnerTask = useMemo(() => ({
    taskType: TASK_TYPES.TREASURE_RUNNER,
    title: "Treasure Runner",
    prompt: "Warm-up while waiting…",
    timeLimitSeconds: 0,
    points: 0,
  }), []);

  return (
    <div style={{ minHeight: "100vh", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Curriculate Demo</h1>
        <button onClick={onAdminRegenerate} style={{ padding: "8px 12px", borderRadius: 10 }}>
          Admin: Regenerate Demo Pool
        </button>
      </div>

      {phase === "mood" && (
        <div style={{ marginTop: 16 }}>
          <TaskRunner
            task={moodTask}
            onSubmit={() => setPhase("runner")}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={{ id: "demo-team", teamName: "Demo Team" }}
            memberNames={["Demo"]}
            socket={null}
          />
        </div>
      )}

      {phase === "runner" && (
        <div style={{ marginTop: 18 }}>
          <TaskRunner
            task={runnerTask}
            onSubmit={() => {}}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={{ id: "demo-team", teamName: "Demo Team" }}
            memberNames={["Demo"]}
            socket={null}
          />

          <div style={{ marginTop: 18, padding: 14, borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)" }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Choose a task to demo</div>

            <select
              value={selectedType}
              onChange={(e) => {
                const t = e.target.value;
                setSelectedType(t);
                if (!t) return;
                const next = pickDemoTask(t);
                setCurrentTask(next);
                setPhase("task");
              }}
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
            >
              <option value="">— Select a task type —</option>
              {allTaskTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
              Demo pool generated by backend. If a task type is missing from the pool, a minimal placeholder is used.
            </div>
          </div>
        </div>
      )}

      {phase === "task" && currentTask && (
        <div style={{ marginTop: 16, position: "relative" }}>
          {/* Review overlay */}
          {taskLocked && !isPhysicalTask(currentTask) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 420,
                  borderRadius: 14,
                  background: "#0b1220",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.15)",
                  padding: 14,
                  position: "relative",
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(0, Math.min(100, Math.round((postSubmitSecondsLeft / 15) * 100)))}%`,
                        background: "rgba(255,255,255,0.9)",
                        transition: "width 200ms linear",
                      }}
                    />
                  </div>
                </div>

                <div style={{ paddingTop: 12, fontWeight: 900 }}>
                  Review your answer… {postSubmitSecondsLeft}s
                </div>
              </div>
            </div>
          )}

          <div style={{ opacity: taskLocked ? 0.65 : 1 }}>
            <TaskRunner
              task={currentTask}
              onSubmit={handleSubmit}
              disabled={taskLocked}
              submitting={false}
              mode="play"
              roomCode={"DEMO"}
              playerTeam={{ id: "demo-team", teamName: "Demo Team" }}
              memberNames={["Demo"]}
              socket={null}
            />
          </div>

          <button
            onClick={() => {
              // exit task back to runner
              endReviewLock();
            }}
            style={{ marginTop: 14, padding: "10px 12px", borderRadius: 12 }}
          >
            ← Back to Treasure Runner
          </button>
        </div>
      )}
    </div>
  );
}

function TreasureRunner() {
  return (
    <div
      style={{
        borderRadius: 16,
        padding: 18,
        border: "1px solid rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Treasure Runner</div>
        <div style={{ opacity: 0.8 }}>Demo mode: waiting for a task selection…</div>
      </div>
      <div style={{ fontSize: 34 }}>🏃‍♂️💨💎</div>
    </div>
  );
}
