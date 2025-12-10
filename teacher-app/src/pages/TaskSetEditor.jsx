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
  if (
    v === "tf" ||
    v === "true-false" ||
    v === "true_false" ||
    v === TASK_TYPES.TRUE_FALSE
  ) {
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
          (data.tasks || []).map((t, idx) => ({
            ...t,
            taskType: normalizeTaskType(t.taskType || t.task_type),
            timeLimitSeconds: t.timeLimitSeconds ?? t.time_limit ?? null,
            displayKey: t.displayKey || "",
            correctAnswer: t.correctAnswer ?? null,
            aiScoringRequired:
              typeof t.aiScoringRequired === "boolean"
                ? t.aiScoringRequired
                : !(
                    t.correctAnswer !== undefined && t.correctAnswer !== null
                  ),
            // ✅ make sure config exists
            config:
              t.config && typeof t.config === "object" ? t.config : {},
            _tempId: Math.random().toString(36).slice(2),
            orderIndex: t.orderIndex ?? idx,
          }))
          
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
    setTasks((prev) => [
      ...prev,
      {
        _tempId: Math.random().toString(36).slice(2),
        title: "",
        prompt: "",
        taskType: TASK_TYPES.MULTIPLE_CHOICE,
        options: [],
        correctAnswer: null,
        aiScoringRequired: true, // until there's a correctAnswer, assume AI or manual scoring
        timeLimitSeconds: 60,
        points: 10,
        displayKey: "",
      },
    ]);
  };

  const updateTask = (tempId, field, value) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId ? { ...t, [field]: value } : t
      )
    );
  };

  const moveTask = (tempId, direction) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t._tempId === tempId);
      if (idx === -1) return prev;

      const newIndex = direction === "up" ? idx - 1 : idx + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      copy.splice(newIndex, 0, removed);
      return copy;
    });
  };

  const removeTask = (tempId) => {
    setTasks((prev) => prev.filter((t) => t._tempId !== tempId));
  };

  const updateOption = (tempId, index, value) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options[index] = value;
        return { ...t, options };
      })
    );
  };

  const updateSortConfig = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevConfig =
          t.config && typeof t.config === "object" ? t.config : {};
        const nextConfig = updater(prevConfig);
        return { ...t, config: nextConfig };
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

  const removeOption = (tempId, index) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options.splice(index, 1);

        let nextCorrect = t.correctAnswer;
        if (typeof nextCorrect === "number") {
          if (nextCorrect === index) {
            nextCorrect = null;
          } else if (nextCorrect > index) {
            nextCorrect = nextCorrect - 1;
          }
        }

        return { ...t, options, correctAnswer: nextCorrect };
      })
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Task set name is required.");
      return;
    }

    if (!tasks.length) {
      alert("Add at least one task before saving.");
      return;
    }

    const cleanTasks = tasks.map((t, index) => {
      const normalizedType = normalizeTaskType(t.taskType);

      // Preserve any extra fields on the task, but strip editor-only keys
      const base = { ...t };
      delete base._tempId;
      delete base.orderIndex;

      // Normalize correctAnswer
      let correctAnswer = base.correctAnswer ?? null;
      if (normalizedType === TASK_TYPES.MULTIPLE_CHOICE || normalizedType === TASK_TYPES.TRUE_FALSE) {
        // For MC/TF, correctAnswer should be a valid index into options
        if (!Array.isArray(base.options) || base.options.length === 0) {
          correctAnswer = null;
        } else if (
          typeof correctAnswer !== "number" ||
          correctAnswer < 0 ||
          correctAnswer >= base.options.length
        ) {
          // If the index is out of range, drop it
          correctAnswer = null;
        }
      } else if (normalizedType === TASK_TYPES.SHORT_ANSWER) {
        if (
          typeof correctAnswer === "string" &&
          correctAnswer.trim().length === 0
        ) {
          correctAnswer = null;
        }
      } else {
        // Non-objective types shouldn't carry a correctAnswer
        correctAnswer = null;
      }

      // Infer aiScoringRequired if not explicitly set
      let aiScoringRequired = base.aiScoringRequired;
      if (typeof aiScoringRequired !== "boolean") {
        aiScoringRequired = !(
          correctAnswer !== null && correctAnswer !== undefined
        );
      }

      return {
        ...base,
        title: (t.title || "").trim() || `Task ${index + 1}`,
        prompt: (t.prompt || "").trim(),
        taskType: normalizedType,
        options: Array.isArray(t.options)
          ? t.options.filter((o) => String(o).trim().length > 0)
          : [],
        correctAnswer,
        aiScoringRequired,
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
          meta: {
            sourceConfig: {
              aiWordBank,
              aiWordsUsed,
              aiWordsUnused,
            },
          },
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

  if (loading) {
    return (
      <div style={wrapperStyle}>
        <p>Loading task set…</p>
      </div>
    );
  }

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

      {/* Name & description */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
            Task set name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: 8,
              fontSize: "0.9rem",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
            Description (for you)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: 8,
              fontSize: "0.85rem",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      {/* Displays panel ... (unchanged) */}
      {/* ... you already had this section; keeping as-is for brevity */}

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
            {tasks.map((task, index) => (
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
                      {TASK_TYPE_META[task.taskType]?.label ||
                        task.taskType}
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
                  {/* Title */}
                  <div>
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
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>

                  {/* Task type */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Task type
                    </label>
                    <select
                      value={task.taskType}
                      onChange={(e) =>
                        updateTask(task._tempId, "taskType", e.target.value)
                      }
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    >
                      {IMPLEMENTED_TASK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TASK_TYPE_META[type]?.label || type}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Points & time */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                      gap: 6,
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
                        Points
                      </label>
                      <input
                        type="number"
                        value={task.points ?? 10}
                        onChange={(e) =>
                          updateTask(
                            task._tempId,
                            "points",
                            Number(e.target.value)
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
                        Time (sec)
                      </label>
                      <input
                        type="number"
                        value={task.timeLimitSeconds ?? 60}
                        onChange={(e) =>
                          updateTask(
                            task._tempId,
                            "timeLimitSeconds",
                            Number(e.target.value)
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
                </div>

                {/* Prompt */}
                <div style={{ marginBottom: 6 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.8rem",
                      marginBottom: 2,
                    }}
                  >
                    Prompt (student instructions)
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

                {/* SORT: Categories / buckets */}
                {task.taskType === TASK_TYPES.SORT && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Categories / buckets
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {(Array.isArray(task.config?.buckets)
                        ? task.config.buckets
                        : []
                      ).map((bucketLabel, i) => (
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
                            value={bucketLabel || ""}
                            onChange={(e) =>
                              updateSortConfig(task._tempId, (cfg) => {
                                const buckets = Array.isArray(cfg.buckets)
                                  ? [...cfg.buckets]
                                  : [];
                                buckets[i] = e.target.value;
                                return { ...cfg, buckets };
                              })
                            }
                            placeholder={`Category ${i + 1}`}
                            style={{
                              flex: 1,
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateSortConfig(task._tempId, (cfg) => {
                                const buckets = Array.isArray(cfg.buckets)
                                  ? [...cfg.buckets]
                                  : [];
                                const items = Array.isArray(cfg.items)
                                  ? [...cfg.items]
                                  : [];
                                if (i < buckets.length) {
                                  buckets.splice(i, 1);
                                  // Fix any items pointing at this bucket
                                  const nextItems = items.map((it) => {
                                    if (it.bucketIndex === i) {
                                      return { ...it, bucketIndex: null };
                                    }
                                    if (
                                      typeof it.bucketIndex === "number" &&
                                      it.bucketIndex > i
                                    ) {
                                      return {
                                        ...it,
                                        bucketIndex: it.bucketIndex - 1,
                                      };
                                    }
                                    return it;
                                  });
                                  return { ...cfg, buckets, items: nextItems };
                                }
                                return cfg;
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          updateSortConfig(task._tempId, (cfg) => {
                            const buckets = Array.isArray(cfg.buckets)
                              ? [...cfg.buckets]
                              : [];
                            buckets.push(`Category ${buckets.length + 1}`);
                            return { ...cfg, buckets };
                          })
                        }
                        style={grayButton}
                      >
                        + Add category
                      </button>
                    </div>
                  </div>
                )}

                {/* SORT: Items to sort */}
                {false && task.taskType === TASK_TYPES.SORT && (
                  <pre style={{ fontSize: "0.7rem", background: "#eef2ff", padding: 4 }}>
                    {JSON.stringify(task.config, null, 2)}
                  </pre>
                )}
                {task.taskType === TASK_TYPES.SORT && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Items to sort
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {(Array.isArray(task.config?.items)
                        ? task.config.items
                        : []
                      ).map((item, idx) => {
                        const buckets = Array.isArray(task.config?.buckets)
                          ? task.config.buckets
                          : [];
                        const currentIndex =
                          typeof item.bucketIndex === "number"
                            ? item.bucketIndex
                            : "";
                        return (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <input
                              type="text"
                              value={item.text || ""}
                              onChange={(e) =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  items[idx] = {
                                    ...(items[idx] || {}),
                                    text: e.target.value,
                                  };
                                  return { ...cfg, items };
                                })
                              }
                              placeholder={`Item ${idx + 1}`}
                              style={{
                                flex: 2,
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: 6,
                                fontSize: "0.8rem",
                              }}
                            />
                            <select
                              value={currentIndex}
                              onChange={(e) =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  const nextIndex =
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value);
                                  items[idx] = {
                                    ...(items[idx] || {}),
                                    bucketIndex: nextIndex,
                                  };
                                  return { ...cfg, items };
                                })
                              }
                              style={{
                                flex: 1,
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: 6,
                                fontSize: "0.8rem",
                              }}
                            >
                              <option value="">
                                — Select category —
                              </option>
                              {buckets.map((bLabel, bIdx) => (
                                <option key={bIdx} value={bIdx}>
                                  {bLabel || `Category ${bIdx + 1}`}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  if (idx < items.length) {
                                    items.splice(idx, 1);
                                  }
                                  return { ...cfg, items };
                                })
                              }
                              style={redTextButton}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          updateSortConfig(task._tempId, (cfg) => {
                            const items = Array.isArray(cfg.items)
                              ? [...cfg.items]
                              : [];
                            const buckets = Array.isArray(cfg.buckets)
                              ? cfg.buckets
                              : [];
                            items.push({
                              text: "",
                              bucketIndex: buckets.length > 0 ? 0 : null,
                            });
                            return { ...cfg, items };
                          })
                        }
                        style={grayButton}
                      >
                        + Add item
                      </button>
                    </div>
                  </div>
                )}

                {/* Options area for MC / sort / sequence */}
                {[
                  TASK_TYPES.MULTIPLE_CHOICE,
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
                              updateOption(task._tempId, i, e.target.value)
                            }
                            style={{
                              flex: 1,
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                          {task.taskType === TASK_TYPES.MULTIPLE_CHOICE && (
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
                            onClick={() => removeOption(task._tempId, i)}
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(task._tempId)}
                        style={grayButton}
                      >
                        + Add option
                      </button>
                    </div>
                  </div>
                )}

                {/* For short-answer, allow reference answer text */}
                {task.taskType === TASK_TYPES.SHORT_ANSWER && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Reference answer (for auto-scoring)
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
                      placeholder="e.g., 'Photosynthesis', 'Abraham Lincoln'"
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                )}

                {/* Simple readout of scoring mode */}
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "0.75rem",
                    color: "#6b7280",
                  }}
                >
                  Scoring mode:{" "}
                  {task.correctAnswer !== null &&
                  task.correctAnswer !== undefined &&
                  task.aiScoringRequired === false
                    ? "Automatic (based on correct answer – no AI needed)"
                    : "AI / manual scoring (no correct answer configured)"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Word-bank / AI metadata card, etc. – unchanged from your existing version */}
      {/* Optional button to create from unused words */}
      {aiWordsUnused.length > 0 && (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.95rem",
                  fontWeight: 600,
                }}
              >
                AI word bank
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                You still have unused words from the original AI generation.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateFromUnused}
              style={greenButton}
            >
              New AI set from unused words
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
