// teacher-app/src/pages/TaskSetEditor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  TASK_TYPES,
  TASK_TYPE_META,
  IMPLEMENTED_TASK_TYPES,
} from "../../../shared/taskTypes.js";

import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "http://localhost:10000";

// Normalize any legacy values coming from older tasksets
function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;
  const v = String(raw).toLowerCase().replace(/_/g, "-").trim();

  if (v === "mc" || v === "multiple-choice" || v === TASK_TYPES.MULTIPLE_CHOICE) {
    return TASK_TYPES.MULTIPLE_CHOICE;
  }
  if (v === "tf" || v === "true-false" || v === "true_false" || v === TASK_TYPES.TRUE_FALSE) {
    return TASK_TYPES.TRUE_FALSE;
  }
  if (v === "short-answer" || v === "short_answer" || v === "sa") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "sort") {
    return TASK_TYPES.SORT;
  }
  if (v === "sequence" || v === "seq" || v === "timeline") {
    return TASK_TYPES.SEQUENCE;
  }
  if (v === "photo" || v === "photo-evidence") {
    return TASK_TYPES.PHOTO;
  }
  if (v === "make-and-snap" || v === "make_snap") {
    return TASK_TYPES.MAKE_AND_SNAP;
  }
  if (v === "body-break" || v === "body_break") {
    return TASK_TYPES.BODY_BREAK;
  }
  if (v === TASK_TYPES.JEOPARDY || v === "jeopardy" || v === "brain-blitz") {
    return TASK_TYPES.JEOPARDY;
  }

  // Fallback: if we know this type, keep it, otherwise default to short answer
  if (Object.values(TASK_TYPES).includes(v)) return v;
  return TASK_TYPES.SHORT_ANSWER;
}

function categoryLabelFor(typeValue) {
  const meta = TASK_TYPE_META[typeValue];
  if (!meta?.category) return "other";
  return meta.category;
}

function prettyCategory(typeValue) {
  const cat = categoryLabelFor(typeValue);
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export default function TaskSetEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState([]);
  const [displays, setDisplays] = useState([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // AI word-bank metadata (used vs unused terms)
  const [aiWordBank, setAiWordBank] = useState([]);
  const [aiWordsUsed, setAiWordsUsed] = useState([]);
  const [aiWordsUnused, setAiWordsUnused] = useState([]);

  const userId = localStorage.getItem("userId");
  const token = localStorage.getItem("token");

  // Load existing taskset (edit mode)
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/tasksets/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error("Server returned invalid JSON while loading set");
        }
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load task set");
        }
        return data;
      })
      .then((data) => {
        setName(data.name || "");
        setDescription(data.description || "");
        setDisplays(data.displays || []);
        setTasks(
          (data.tasks || []).map((t, idx) => {
            const normalizedType = normalizeTaskType(t.taskType || t.task_type);
            const meta = TASK_TYPE_META[normalizedType] || {};
            const aiScoringRequired =
              typeof t.aiScoringRequired === "boolean"
                ? t.aiScoringRequired
                : typeof meta.defaultAiScoringRequired === "boolean"
                ? meta.defaultAiScoringRequired
                : false;

            return {
              ...t,
              taskType: normalizedType,
              timeLimitSeconds: t.timeLimitSeconds ?? t.time_limit ?? null,
              correctAnswer: t.correctAnswer ?? null,
              aiScoringRequired,
              displayKey: t.displayKey || "",
              _tempId: Math.random().toString(36).slice(2),
              orderIndex: t.orderIndex ?? idx,
            };
          })
        );

        const meta = data.meta || {};
        const sourceConfig = meta.sourceConfig || {};
        setAiWordBank(sourceConfig.aiWordBank || []);
        setAiWordsUsed(sourceConfig.aiWordsUsed || []);
        setAiWordsUnused(sourceConfig.aiWordsUnused || []);
      })
      .catch((err) => {
        console.error("TaskSetEditor load error:", err);
        setError(err.message || "Failed to load task set");
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  const addDisplay = () => {
    setDisplays((prev) => [
      ...prev,
      {
        key: `display-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "",
        description: "",
        stationColor: "",
        notesForTeacher: "",
        imageUrl: "",
      },
    ]);
  };

  const updateDisplay = (index, field, value) => {
    setDisplays((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeDisplay = (index) => {
    setDisplays((prevDisplays) => {
      const displayToRemove = prevDisplays[index];
      const keyToRemove = displayToRemove?.key;
      if (keyToRemove) {
        setTasks((prevTasks) =>
          prevTasks.map((t) =>
            t.displayKey === keyToRemove ? { ...t, displayKey: "" } : t
          )
        );
      }
      return prevDisplays.filter((_, i) => i !== index);
    });
  };

  const addTask = () => {
    const defaultType = TASK_TYPES.MULTIPLE_CHOICE;
    const meta = TASK_TYPE_META[defaultType] || {};
    const aiScoringRequired =
      typeof meta.defaultAiScoringRequired === "boolean"
        ? meta.defaultAiScoringRequired
        : false;

    setTasks((prev) => [
      ...prev,
      {
        _tempId: Math.random().toString(36).slice(2),
        title: "",
        prompt: "",
        taskType: defaultType,
        options: [],
        correctAnswer: null,
        aiScoringRequired,
        timeLimitSeconds: 60,
        points: 10,
        displayKey: "",
      },
    ]);
  };

  const updateTask = (tempId, field, value) => {
    setTasks((prev) =>
      prev.map((t) => (t._tempId === tempId ? { ...t, [field]: value } : t))
    );
  };

  const removeTask = (tempId) => {
    setTasks((prev) => prev.filter((t) => t._tempId !== tempId));
  };

  const moveTask = (tempId, direction) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t._tempId === tempId);
      if (idx === -1) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return copy;
    });
  };

  const updateOption = (tempId, optionIndex, value) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options[optionIndex] = value;
        return { ...t, options };
      })
    );
  };

  const addOption = (tempId) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options.push("");
        return { ...t, options };
      })
    );
  };

  const removeOption = (tempId, optionIndex) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options.splice(optionIndex, 1);
        return { ...t, options };
      })
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Please give this task set a name.");
      return;
    }
    if (tasks.length === 0) {
      alert("Please add at least one task.");
      return;
    }

    const cleanTasks = tasks.map((t, index) => {
      const normalizedType = normalizeTaskType(t.taskType);

      // Preserve any extra fields on the task, but strip editor-only keys
      const base = { ...t };
      delete base._tempId;
      delete base.orderIndex;

      return {
        ...base,
        title: (t.title || "").trim() || `Task ${index + 1}`,
        prompt: (t.prompt || "").trim(),
        taskType: normalizedType,
        options: Array.isArray(t.options)
          ? t.options.filter((o) => String(o).trim().length > 0)
          : [],
        timeLimitSeconds:
          typeof t.timeLimitSeconds === "number" && t.timeLimitSeconds > 0
            ? t.timeLimitSeconds
            : 60,
        points:
          typeof t.points === "number" && t.points > 0 ? t.points : 10,
        order: index,
      };
    });

    setSaving(true);
    setError(null);

    try {
      const url = id
        ? `${API_BASE}/api/tasksets/${id}`
        : `${API_BASE}/api/tasksets`;
      const method = id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          tasks: cleanTasks,
          displays,
          ownerId: userId || null,
        }),
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Server returned invalid JSON while saving set");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save task set");
      }

      const newId = data._id || data.id || id;
      alert("Task set saved.");
      navigate(`/tasksets/${newId}`);
    } catch (err) {
      console.error("TaskSetEditor save error:", err);
      setError(err.message || "Failed to save task set");
    } finally {
      setSaving(false);
    }
  };

  // Navigate back to AI generator with unused words prefilled
  const handleCreateFromUnused = () => {
    if (!aiWordsUnused.length) return;
    navigate("/ai-generator", {
      state: {
        prefillWordList: aiWordsUnused,
        fromTasksetId: id || null,
      },
    });
  };

  // ---------- Shared styles ----------
  const wrapperStyle = {
    padding: 24,
    maxWidth: 960,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const cardStyle = {
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: 12,
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  };

  const btnBase = {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid transparent",
  };

  const blueButton = {
    ...btnBase,
    background: "#2563eb",
    color: "#ffffff",
    borderColor: "#2563eb",
  };

  const grayButton = {
    ...btnBase,
    background: "#ffffff",
    color: "#111827",
    borderColor: "#d1d5db",
  };

  const greenButton = {
    ...btnBase,
    background: "#059669",
    color: "#ffffff",
    borderColor: "#047857",
  };

  const redTextButton = {
    border: "none",
    background: "transparent",
    color: "#b91c1c",
    fontSize: "0.75rem",
    cursor: "pointer",
  };

  return (
    <div style={wrapperStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "1.3rem",
            fontWeight: 600,
          }}
        >
          {id ? "Edit Task Set" : "New Task Set"}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate("/tasksets")}
            style={grayButton}
          >
            Back to list
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              ...blueButton,
              opacity: saving ? 0.7 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save task set"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            fontSize: "0.9rem",
            color: "#6b7280",
          }}
        >
          Loading task set…
        </div>
      ) : (
        <>
          {/* BASIC INFO */}
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                marginBottom: 8,
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              Basic info
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    marginBottom: 4,
                  }}
                >
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Confederation Stations – Brain Blitz & Review"
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    padding: 8,
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    marginBottom: 4,
                  }}
                >
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short note to your future self about how and when to use this set."
                  rows={3}
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    padding: 8,
                    fontSize: "0.9rem",
                    resize: "vertical",
                  }}
                />
              </div>
            </div>
          </div>

          {/* AI WORD USAGE PANEL */}
          {(aiWordBank.length > 0 ||
            aiWordsUsed.length > 0 ||
            aiWordsUnused.length > 0) && (
            <div
              style={{
                ...cardStyle,
                marginBottom: 16,
                background: "#eff6ff",
                borderColor: "#bfdbfe",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "0.9rem",
                      fontWeight: 600,
                    }}
                  >
                    AI word bank usage (from generator)
                  </h2>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "0.8rem",
                      color: "#374151",
                    }}
                  >
                    These words came from your AI generator step. See which
                    ones were used in this task set and which are still
                    “unused” so you can quickly build a follow-up set.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateFromUnused}
                  disabled={!aiWordsUnused.length}
                  style={{
                    ...greenButton,
                    opacity: aiWordsUnused.length ? 1 : 0.5,
                    cursor: aiWordsUnused.length ? "pointer" : "not-allowed",
                    fontSize: "0.75rem",
                  }}
                >
                  Create new task set with unused words
                </button>
              </div>

              {aiWordsUsed.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#166534",
                      marginBottom: 2,
                    }}
                  >
                    ✅ Used in this task set
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {aiWordsUsed.map((w, i) => (
                      <span
                        key={`used-${i}-${w}`}
                        style={{
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "#bbf7d0",
                          color: "#14532d",
                          fontSize: "0.7rem",
                        }}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiWordsUnused.length > 0 && (
                <div style={{ marginBottom: 2 }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#92400e",
                      marginBottom: 2,
                    }}
                  >
                    ❌ Not yet used — great for another set
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {aiWordsUnused.map((w, i) => (
                      <span
                        key={`unused-${i}-${w}`}
                        style={{
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "#fed7aa",
                          color: "#7c2d12",
                          fontSize: "0.7rem",
                        }}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiWordBank.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "0.7rem",
                    color: "#4b5563",
                  }}
                >
                  Total in original list: {aiWordBank.length}
                </div>
              )}
            </div>
          )}

          {/* DISPLAYS PANEL */}
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                }}
              >
                Displays / stations
              </h2>
              <button type="button" onClick={addDisplay} style={grayButton}>
                + Add display
              </button>
            </div>
            <p
              style={{
                margin: "2px 0 8px",
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              Displays are physical screens, boards, or table-top instructions
              that stay fixed while teams rotate. You can attach tasks to a
              specific display if needed.
            </p>

            {displays.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "#6b7280",
                }}
              >
                No displays yet. You can still run this set without them.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {displays.map((d, index) => (
                  <div
                    key={d.key || index}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      padding: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                      >
                        Display {index + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDisplay(index)}
                        style={redTextButton}
                      >
                        Remove
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                        gap: 8,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Name / label
                        </label>
                        <input
                          type="text"
                          value={d.name || ""}
                          onChange={(e) =>
                            updateDisplay(index, "name", e.target.value)
                          }
                          placeholder="e.g. Confederation Station A"
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.8rem",
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Station color (optional)
                        </label>
                        <input
                          type="text"
                          value={d.stationColor || ""}
                          onChange={(e) =>
                            updateDisplay(
                              index,
                              "stationColor",
                              e.target.value
                            )
                          }
                          placeholder="e.g. Red, Green, Blue…"
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.8rem",
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.8rem",
                          marginBottom: 2,
                        }}
                      >
                        Teacher notes (optional)
                      </label>
                      <textarea
                        value={d.notesForTeacher || ""}
                        onChange={(e) =>
                          updateDisplay(
                            index,
                            "notesForTeacher",
                            e.target.value
                          )
                        }
                        rows={2}
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                          resize: "vertical",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* TASKS PANEL */}
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                }}
              >
                Tasks
              </h2>
              <button type="button" onClick={addTask} style={grayButton}>
                + Add task
              </button>
            </div>
            {tasks.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "#6b7280",
                }}
              >
                No tasks yet. Add at least one to save this set.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {tasks.map((task, index) => {
                  const meta = TASK_TYPE_META[task.taskType] || {};
                  const objective = !!meta.objectiveScoring;

                  return (
                    <div
                      key={task._tempId}
                      style={{
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        background: "#f9fafb",
                        padding: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.9rem",
                            fontWeight: 600,
                          }}
                        >
                          Task {index + 1}{" "}
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "#6b7280",
                            }}
                          >
                            {prettyCategory(task.taskType)} •{" "}
                            {meta.label || task.taskType}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 4,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => moveTask(task._tempId, "up")}
                            style={{
                              ...grayButton,
                              padding: "2px 8px",
                              fontSize: "0.7rem",
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTask(task._tempId, "down")}
                            style={{
                              ...grayButton,
                              padding: "2px 8px",
                              fontSize: "0.7rem",
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTask(task._tempId)}
                            style={redTextButton}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Type
                          </label>
                          <select
                            value={task.taskType}
                            onChange={(e) =>
                              updateTask(
                                task._tempId,
                                "taskType",
                                e.target.value
                              )
                            }
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                              background: "#ffffff",
                            }}
                          >
                            {IMPLEMENTED_TASK_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {TASK_TYPE_META[type]?.label || type}
                              </option>
                            ))}
                          </select>
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontSize: "0.7rem",
                              color: "#6b7280",
                            }}
                          >
                            {meta.description}
                          </p>
                        </div>

                        <div>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Time limit (seconds)
                          </label>
                          <input
                            type="number"
                            min={10}
                            max={900}
                            value={task.timeLimitSeconds ?? ""}
                            onChange={(e) =>
                              updateTask(
                                task._tempId,
                                "timeLimitSeconds",
                                Number(e.target.value) || 60
                              )
                            }
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                        </div>

                        <div>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Points
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={task.points ?? ""}
                            onChange={(e) =>
                              updateTask(
                                task._tempId,
                                "points",
                                Number(e.target.value) || 10
                              )
                            }
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ marginBottom: 6 }}>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Title
                        </label>
                        <input
                          type="text"
                          value={task.title || ""}
                          onChange={(e) =>
                            updateTask(task._tempId, "title", e.target.value)
                          }
                          placeholder="e.g. Name the First Four Provinces"
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.8rem",
                          }}
                        />
                      </div>

                      <div style={{ marginBottom: 6 }}>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Prompt / question
                        </label>
                        <textarea
                          value={task.prompt || ""}
                          onChange={(e) =>
                            updateTask(task._tempId, "prompt", e.target.value)
                          }
                          rows={3}
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.8rem",
                            resize: "vertical",
                          }}
                        />
                      </div>

                      {/* Options area for MC / sort / sequence */}
                      {[
                        TASK_TYPES.MULTIPLE_CHOICE,
                        TASK_TYPES.SORT,
                        TASK_TYPES.SEQUENCE,
                      ].includes(task.taskType) && (
                        <div style={{ marginBottom: 6 }}>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Options
                          </label>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            {(task.options || []).map((opt, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) =>
                                    updateOption(
                                      task._tempId,
                                      i,
                                      e.target.value
                                    )
                                  }
                                  style={{
                                    flex: 1,
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    padding: 6,
                                    fontSize: "0.8rem",
                                  }}
                                />
                                {task.taskType ===
                                  TASK_TYPES.MULTIPLE_CHOICE && (
                                  <label
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 4,
                                      fontSize: "0.7rem",
                                    }}
                                  >
                                    <input
                                      type="radio"
                                      name={`correct-${task._tempId}`}
                                      checked={task.correctAnswer === i}
                                      onChange={() =>
                                        updateTask(
                                          task._tempId,
                                          "correctAnswer",
                                          i
                                        )
                                      }
                                    />
                                    Correct
                                  </label>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeOption(task._tempId, i)
                                  }
                                  style={redTextButton}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addOption(task._tempId)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "#2563eb",
                                fontSize: "0.75rem",
                                cursor: "pointer",
                                alignSelf: "flex-start",
                              }}
                            >
                              + Add option
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Correct answer for True/False */}
                      {task.taskType === TASK_TYPES.TRUE_FALSE && (
                        <div style={{ marginBottom: 6 }}>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Correct answer
                          </label>
                          <div
                            style={{
                              display: "flex",
                              gap: 12,
                              fontSize: "0.8rem",
                            }}
                          >
                            {[0, 1].map((idx) => (
                              <label
                                key={idx}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`tf-correct-${task._tempId}`}
                                  checked={task.correctAnswer === idx}
                                  onChange={() =>
                                    updateTask(
                                      task._tempId,
                                      "correctAnswer",
                                      idx
                                    )
                                  }
                                />
                                {idx === 0 ? "True" : "False"}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Correct answer for Short Answer */}
                      {task.taskType === TASK_TYPES.SHORT_ANSWER && (
                        <div style={{ marginBottom: 6 }}>
                          <label
                            style={{
                              display: "block",
                              fontSize: "0.8rem",
                              marginBottom: 2,
                            }}
                          >
                            Correct answer (for auto-scoring)
                          </label>
                          <input
                            type="text"
                            value={task.correctAnswer || ""}
                            onChange={(e) =>
                              updateTask(
                                task._tempId,
                                "correctAnswer",
                                e.target.value
                              )
                            }
                            placeholder="Reference answer (case-insensitive match)"
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontSize: "0.7rem",
                              color: "#6b7280",
                            }}
                          >
                            For more nuanced marking (e.g., long explanations),
                            leave this blank and enable AI scoring below.
                          </p>
                        </div>
                      )}

                      {/* Scoring toggle */}
                      <div style={{ marginBottom: 6 }}>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Scoring
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: "0.8rem",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!task.aiScoringRequired}
                            onChange={(e) =>
                              updateTask(
                                task._tempId,
                                "aiScoringRequired",
                                e.target.checked
                              )
                            }
                          />
                          Use AI scoring for this task
                        </label>
                        <p
                          style={{
                            margin: "2px 0 0",
                            fontSize: "0.7rem",
                            color: "#6b7280",
                          }}
                        >
                          {objective
                            ? "If AI scoring is off and a correct answer is set, the system can score this task instantly without an AI call."
                            : "For open or creative tasks, AI scoring can provide feedback and partial credit when a rubric is available."}
                        </p>
                      </div>

                      {/* Display assignment */}
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            marginBottom: 2,
                          }}
                        >
                          Attach to display (optional)
                        </label>
                        <select
                          value={task.displayKey || ""}
                          onChange={(e) =>
                            updateTask(
                              task._tempId,
                              "displayKey",
                              e.target.value
                            )
                          }
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.8rem",
                            background: "#ffffff",
                          }}
                        >
                          <option value="">(none)</option>
                          {displays.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.name || d.stationColor || d.key}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
