// student-app/src/pages/DemoPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.curriculate.net";

// Define which types are “physical” to skip AI scoring + review overlay in demo
const PHYSICAL_TYPES = new Set(
  [
    TASK_TYPES.BODY_BREAK,
    TASK_TYPES.MAD_DASH_SEQUENCE,
    TASK_TYPES.MAD_DASH,
    TASK_TYPES.MOTION_MISSION,
    // add any other movement/physical types here as you introduce them
  ].map((x) => String(x || "").toLowerCase())
);

function isPhysicalTask(task) {
  const t = String(task?.taskType || task?.type || "").toLowerCase();
  return (
    !!(
      task?.isPhysical ||
      task?.config?.isPhysical ||
      task?.movement ||
      task?.config?.movement
    ) || PHYSICAL_TYPES.has(t)
  );
}

export default function DemoPage() {
  // Phases: mood -> runner -> task
  const [phase, setPhase] = useState("mood");

  // Demo pool returned by backend (admin can regenerate)
  const [demoTaskset, setDemoTaskset] = useState(null);

  // Task picker UI
  const [selectedType, setSelectedType] = useState("");
  const [currentTask, setCurrentTask] = useState(null);

  // Demo scoring/feedback
  const [scoreTotal, setScoreTotal] = useState(0);
  const [scoreToast, setScoreToast] = useState(null);

  // Review lock like StudentApp (non-physical tasks only)
  const [taskLocked, setTaskLocked] = useState(false);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const postSubmitTimerRef = useRef(null);

  // Admin regen key input (no prompts)
  const [adminKey, setAdminKey] = useState("");

  // Socket stub so TaskRunner (and tasks) can safely call socket.on/off/emit
  const demoSocket = useMemo(
    () => ({
      on: () => {},
      off: () => {},
      emit: (_event, _payload, ack) => {
        // Some tasks emit with ACK callbacks; keep them from hanging.
        if (typeof ack === "function") ack({ ok: true, demo: true });
      },
    }),
    []
  );

  // “Team” context for TaskRunner props
  const demoTeam = useMemo(
    () => ({ id: "demo-team", teamName: "Demo Team", teamId: "demo-team" }),
    []
  );
  const memberNames = useMemo(() => ["Demo"], []);

  const allTaskTypes = useMemo(() => {
    return Object.values(TASK_TYPES)
      .filter((v) => typeof v === "string")
      .sort((a, b) => a.localeCompare(b));
  }, []);

  // --- backend demo pool ---
  async function loadDemoTaskset() {
    const res = await fetch(`${API_BASE}/api/demo/taskset`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to load demo taskset");
    setDemoTaskset(json.taskset);
  }

  async function regenerateDemoTaskset(key) {
    const res = await fetch(`${API_BASE}/api/demo/taskset/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-demo-admin-key": key } : {}),
      },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to regenerate demo taskset");
    setDemoTaskset(json.taskset);
  }

  useEffect(() => {
    // load pool once on entry
    loadDemoTaskset().catch((e) => {
      console.warn("[DemoPage] load demo taskset failed:", e);
    });

    return () => {
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Task objects for phases ---
  const moodTask = useMemo(
    () => ({
      taskType: TASK_TYPES.MOOD_CHECKIN,
      title: "Mood Check-in",
      prompt: "How are you doing today?",
      timeLimitSeconds: 45,
      points: 0,
    }),
    []
  );

  const runnerTask = useMemo(
    () => ({
      taskType: TASK_TYPES.TREASURE_RUNNER,
      title: "Treasure Runner",
      prompt: "Warm-up while waiting…",
      timeLimitSeconds: 0,
      points: 0,
    }),
    []
  );

  function pickDemoTask(type) {
    const tasks = demoTaskset?.tasks || demoTaskset?.items || [];
    const match = tasks.find((t) => (t.taskType || t.type) === type);
    if (match) return match;

    // Fallback: create minimal placeholder so TaskRunner can still render something.
    return {
      taskType: type,
      title: `Demo: ${type}`,
      prompt: "Demo task",
      timeLimitSeconds: 60,
      points: 10,
    };
  }

  function endReviewLockAndReturnToRunner() {
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

  function toast(msg, positive = true) {
    setScoreToast({ msg, positive });
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => setScoreToast(null), 2400);
  }

  // Demo submit handler (mirrors StudentApp intent):
  // - physical tasks: no review lock; bounce back to runner immediately
  // - non-physical: show review lock and call scoring endpoint
  async function handleSubmit(submissionPayload) {
    const task = currentTask;
    if (!task) return;

    const physical = isPhysicalTask(task);
    if (physical) {
      endReviewLockAndReturnToRunner();
      return;
    }

    // REVIEW LOCK (15s default like StudentApp)
    const lockSeconds = 15;
    setTaskLocked(true);
    setPostSubmitSecondsLeft(lockSeconds);

    if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);
    let t = lockSeconds;
    postSubmitTimerRef.current = setInterval(() => {
      t -= 1;
      setPostSubmitSecondsLeft(t);
      if (t <= 0) endReviewLockAndReturnToRunner();
    }, 1000);

    try {
      // Use your existing scoring endpoint.
      // IMPORTANT: keep this aligned with StudentApp’s scoring endpoint.
      const res = await fetch(`${API_BASE}/api/ai/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "demo",
          task,
          submission: submissionPayload,
        }),
      });

      const json = await res.json();

      if (!json?.ok) {
        console.warn("[DemoPage] scoring failed:", json?.error);
        toast("Scoring failed", false);
        return;
      }

      // Accept a few possible response shapes (future-proof)
      const delta =
        typeof json?.scoreDelta === "number"
          ? json.scoreDelta
          : typeof json?.points === "number"
          ? json.points
          : null;

      const total =
        typeof json?.totalScore === "number"
          ? json.totalScore
          : typeof json?.scoreTotal === "number"
          ? json.scoreTotal
          : null;

      if (typeof total === "number") {
        setScoreTotal(total);
      } else if (typeof delta === "number") {
        setScoreTotal((prev) => prev + delta);
      }

      if (typeof delta === "number") {
        toast(
          delta > 0 ? `+${delta} points` : delta < 0 ? `${delta} points` : "0 points",
          delta >= 0
        );
      } else {
        toast("Submitted", true);
      }
    } catch (e) {
      console.warn("[DemoPage] scoring error:", e);
      toast("Scoring error", false);
    }
  }

  async function onAdminRegenerate() {
    if (!adminKey?.trim()) {
      toast("Enter admin key first", false);
      return;
    }
    try {
      await regenerateDemoTaskset(adminKey.trim());
      toast("Demo pool regenerated", true);
    } catch (e) {
      toast(e?.message || "Failed to regenerate", false);
    }
  }

  function startSelectedTask() {
    if (!selectedType) return;
    const next = pickDemoTask(selectedType);
    setCurrentTask(next);
    setPhase("task");
  }

  function startAnotherOfSameType() {
    if (!selectedType) return;
    const next = pickDemoTask(selectedType);
    setCurrentTask({ ...next });
    setPhase("task");
  }

  // A tiny demo “leaderboard” bar (just the demo team for now)
  const leaderboard = useMemo(
    () => [
      {
        teamName: demoTeam.teamName,
        score: scoreTotal,
      },
    ],
    [demoTeam.teamName, scoreTotal]
  );

  return (
    <div style={{ minHeight: "100vh", padding: 18, background: "#0b1220", color: "#fff" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Curriculate Demo</h1>
          <div style={{ opacity: 0.8, marginTop: 4, fontSize: 13 }}>
            Mood → Treasure Runner → Pick any task type (rendered by TaskRunner)
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin key"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              width: 140,
            }}
          />
          <button
            onClick={onAdminRegenerate}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Regenerate Pool
          </button>
        </div>
      </div>

      {/* Score + tiny leaderboard */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Score</div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 18, fontWeight: 900 }}>
            {scoreTotal}
          </div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Phase: <strong style={{ opacity: 1 }}>{phase}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {leaderboard.map((e) => (
            <div
              key={e.teamName}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(0,0,0,0.18)",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {e.teamName}: {e.score}
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {scoreToast && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: scoreToast.positive ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            fontWeight: 900,
          }}
        >
          {scoreToast.msg}
        </div>
      )}

      {/* Phase: Mood */}
      {phase === "mood" && (
        <div style={{ marginTop: 16 }}>
          <TaskRunner
            task={moodTask}
            onSubmit={() => setPhase("runner")}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={demoTeam}
            memberNames={memberNames}
            socket={demoSocket}
          />
        </div>
      )}

      {/* Phase: Treasure Runner + picker */}
      {phase === "runner" && (
        <div style={{ marginTop: 16 }}>
          <TaskRunner
            task={runnerTask}
            onSubmit={() => {}}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={demoTeam}
            memberNames={memberNames}
            socket={demoSocket}
          />

          <div
            style={{
              marginTop: 16,
              borderRadius: 16,
              padding: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Choose a task to demo</div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                style={{
                  flex: "1 1 260px",
                  minWidth: 260,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#fff",
                }}
              >
                <option value="">— Select a task type —</option>
                {allTaskTypes.map((t) => (
                  <option key={t} value={t} style={{ color: "#000" }}>
                    {t}
                  </option>
                ))}
              </select>

              <button
                onClick={startSelectedTask}
                disabled={!selectedType}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: !selectedType ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: !selectedType ? "not-allowed" : "pointer",
                }}
              >
                Start Task
              </button>

              <button
                onClick={() => {
                  loadDemoTaskset()
                    .then(() => toast("Pool refreshed", true))
                    .catch(() => toast("Refresh failed", false));
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Refresh Pool
              </button>
            </div>

            <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
              Demo pool is generated by the backend. If a task type isn’t present, a minimal placeholder is used.
            </div>
          </div>
        </div>
      )}

      {/* Phase: Task */}
      {phase === "task" && currentTask && (
        <div style={{ marginTop: 16, position: "relative" }}>
          {/* Review overlay (non-physical only) */}
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
              {/* unshaded overlay; just a card with a top progress bar */}
              {postSubmitSecondsLeft != null && (() => {
                const lockTotal = 15;
                const percent = lockTotal > 0 ? Math.round((postSubmitSecondsLeft / lockTotal) * 100) : 0;

                return (
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
                      boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
                    }}
                  >
                    {/* bar at top */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.18)" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${percent}%`,
                            background: "rgba(255,255,255,0.9)",
                            transition: "width 200ms linear",
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ paddingTop: 10 }}>
                      <div style={{ fontWeight: 900, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                        Review your answer…
                      </div>
                      <div
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "1.1rem",
                          marginTop: 4,
                          fontWeight: 900,
                        }}
                      >
                        {postSubmitSecondsLeft}s
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ opacity: taskLocked ? 0.6 : 1 }}>
            <TaskRunner
              task={currentTask}
              onSubmit={handleSubmit}
              disabled={taskLocked}
              submitting={false}
              mode="play"
              roomCode={"DEMO"}
              playerTeam={demoTeam}
              memberNames={memberNames}
              socket={demoSocket}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={endReviewLockAndReturnToRunner}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              ← Back to Treasure Runner
            </button>

            <button
              onClick={startAnotherOfSameType}
              disabled={!selectedType}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: !selectedType ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
                color: "#fff",
                fontWeight: 900,
                cursor: !selectedType ? "not-allowed" : "pointer",
              }}
            >
              Try again (same type)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
