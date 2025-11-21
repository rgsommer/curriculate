// teacher-app/src/pages/TaskSetEditor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  TASK_TYPES,
  TASK_TYPE_META,
  IMPLEMENTED_TASK_TYPES,
} from "../../../shared/taskTypes.js";

const API_BASE = "http://localhost:10000";

// Normalize any legacy values coming from older tasksets
function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;
  switch (raw) {
    case "mc":
    case "multiple-choice":
      return TASK_TYPES.MULTIPLE_CHOICE;
    case "tf":
    case "true_false":
    case "true-false":
      return TASK_TYPES.TRUE_FALSE;
    case "open":
    case "short":
    case "short-answer":
      return TASK_TYPES.SHORT_ANSWER;
    case "open-text":
    case "open_text":
      return TASK_TYPES.OPEN_TEXT;
    case "sort":
      return TASK_TYPES.SORT;
    case "seq":
    case "sequence":
      return TASK_TYPES.SEQUENCE;
    case "photo":
      return TASK_TYPES.PHOTO;
    case "make-and-snap":
    case "make_snap":
      return TASK_TYPES.MAKE_AND_SNAP;
    case "body-break":
    case "body_break":
      return TASK_TYPES.BODY_BREAK;
    case "record-audio":
    case "record_audio":
      return TASK_TYPES.RECORD_AUDIO;
    default:
      return raw;
  }
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

  const userId = localStorage.getItem("userId");
  const token = localStorage.getItem("token");

  // Load existing taskset (edit mode)
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/tasksets/${id}`, {
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
            timeLimitSeconds:
              t.timeLimitSeconds ?? t.time_limit ?? null,
            displayKey: t.displayKey || "",
            _tempId: Math.random().toString(36).slice(2),
            orderIndex: t.orderIndex ?? idx,
          }))
        );
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || "Failed to load task set");
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  // ---------- DISPLAY HELPERS ----------

  const addDisplay = () => {
    setDisplays((prev) => [
      ...prev,
      {
        key: `display-${Date.now()}`,
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

  // ---------- TASK HELPERS ----------

  const addTask = () => {
    setTasks((prev) => [
      ...prev,
      {
        _tempId: Math.random().toString(36).slice(2),
        title: "",
        prompt: "",
        taskType: TASK_TYPES.SHORT_ANSWER,
        options: [],
        correctAnswer: "",
        points: 10,
        timeLimitSeconds: null,
        linear: true,
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
    const idx = tasks.findIndex((t) => t._tempId === tempId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= tasks.length) return;
    const copy = [...tasks];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setTasks(copy);
  };

  const addOption = (tempId) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId
          ? { ...t, options: [...(t.options || []), ""] }
          : t
      )
    );
  };

  const updateOption = (tempId, index, value) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId
          ? {
              ...t,
              options: (t.options || []).map((o, i) =>
                i === index ? value : o
              ),
            }
          : t
      )
    );
  };

  const removeOption = (tempId, index) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId
          ? {
              ...t,
              options: (t.options || []).filter((_, i) => i !== index),
            }
          : t
      )
    );
  };

  // ---------- SAVE ----------

  const save = async () => {
    if (!name.trim()) {
      alert("Name is required.");
      return;
    }
    if (tasks.length === 0) {
      alert("Add at least one task.");
      return;
    }

    const cleanTasks = tasks.map(
      ({ _tempId, task_type, time_limit, ...t }, index) => {
        const canonicalType = normalizeTaskType(t.taskType);

        const needsOptions = [
          TASK_TYPES.MULTIPLE_CHOICE,
          TASK_TYPES.SORT,
          TASK_TYPES.SEQUENCE,
        ].includes(canonicalType);

        const options = needsOptions
          ? (t.options || []).filter(
              (opt) => !!opt && opt.trim() !== ""
            )
          : [];

        let correctAnswer = t.correctAnswer;
        if (canonicalType === TASK_TYPES.MULTIPLE_CHOICE) {
          if (typeof correctAnswer === "string") {
            const idx = options.findIndex(
              (o) =>
                o.trim().toLowerCase() ===
                correctAnswer.trim().toLowerCase()
            );
            if (idx >= 0) correctAnswer = idx;
          }
        }

        return {
          ...t,
          taskType: canonicalType,
          options,
          correctAnswer,
          timeLimitSeconds:
            t.timeLimitSeconds === "" ? null : t.timeLimitSeconds ?? null,
          orderIndex: t.orderIndex ?? index,
          displayKey: t.displayKey || "",
        };
      }
    );

    setSaving(true);
    try {
      const url = id ? `${API_BASE}/tasksets/${id}` : `${API_BASE}/tasksets`;
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
        throw new Error("Server returned invalid JSON when saving");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Save failed");
      }

      alert(id ? "Task set updated!" : "Task set created!");
      if (!id && data?._id) {
        navigate(`/tasksets/edit/${data._id}`);
      } else {
        navigate("/tasksets");
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ---------- RENDER ----------

  if (loading) {
    return <p>Loading task set…</p>;
  }

  if (error) {
    return (
      <div>
        <p className="text-red-600 mb-2">{error}</p>
        <button
          onClick={() => navigate("/tasksets")}
          className="px-3 py-1 rounded border"
        >
          Back to Task Sets
        </button>
      </div>
    );
  }

  // Build options with categories in the label
  const TASK_TYPE_OPTIONS = IMPLEMENTED_TASK_TYPES.map((value) => {
    const meta = TASK_TYPE_META[value];
    const label = meta?.label || value;
    const cat = prettyCategory(value);
    return { value, label: `${label} — ${cat}` };
  });

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          {id ? "Edit Task Set" : "Create Task Set"}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => navigate("/tasksets")}
            className="px-4 py-2 rounded border"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Basic info */}
      <div className="mb-4">
        <label className="block font-medium mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. Chapter 3 Review"
        />
      </div>

      <div className="mb-6">
        <label className="block font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded px-3 py-2 h-20"
          placeholder="Optional description..."
        />
      </div>

      {/* DISPLAYS PANEL */}
      <div className="mb-6 border rounded bg-white p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-lg">Physical Displays / Stations</h2>
          <button
            onClick={addDisplay}
            className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 text-sm"
          >
            + Add Display
          </button>
        </div>

        {displays.length === 0 ? (
          <p className="text-gray-600 text-sm">
            Add a display for each physical object/exhibit that will live at a
            specific station (e.g., “Red – Van Gogh print”, “Blue – Pendulum
            setup”). Tasks can then link directly to these.
          </p>
        ) : (
          <div className="space-y-3">
            {displays.map((display, index) => (
              <div
                key={display.key || index}
                className="border rounded p-3 bg-slate-50"
              >
                <div className="flex justify-between gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Display key (unique in this set)"
                    value={display.key || ""}
                    onChange={(e) =>
                      updateDisplay(index, "key", e.target.value)
                    }
                    className="flex-1 border rounded px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Station colour (e.g. red)"
                    value={display.stationColor || ""}
                    onChange={(e) =>
                      updateDisplay(index, "stationColor", e.target.value)
                    }
                    className="w-40 border rounded px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => removeDisplay(index)}
                    className="px-2 py-1 text-sm border rounded border-red-500 text-red-600"
                  >
                    Delete
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Display name (e.g. Van Gogh: Starry Night)"
                  value={display.name || ""}
                  onChange={(e) =>
                    updateDisplay(index, "name", e.target.value)
                  }
                  className="w-full border rounded px-2 py-1 text-sm mb-2"
                />
                <textarea
                  placeholder="Short description (seen by students)"
                  value={display.description || ""}
                  onChange={(e) =>
                    updateDisplay(index, "description", e.target.value)
                  }
                  className="w-full border rounded px-2 py-1 text-sm mb-2 h-16"
                />
                <textarea
                  placeholder="Notes for teacher (setup instructions, where to put it, etc.)"
                  value={display.notesForTeacher || ""}
                  onChange={(e) =>
                    updateDisplay(index, "notesForTeacher", e.target.value)
                  }
                  className="w-full border rounded px-2 py-1 text-sm mb-2 h-16"
                />
                <input
                  type="text"
                  placeholder="Image URL (optional)"
                  value={display.imageUrl || ""}
                  onChange={(e) =>
                    updateDisplay(index, "imageUrl", e.target.value)
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TASKS PANEL */}
      <div className="mb-4 flex justify-between items-center">
        <h2 className="font-semibold text-lg">Tasks</h2>
        <button
          onClick={addTask}
          className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
        >
          + Add Task
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-gray-600">No tasks yet. Add one to get started.</p>
      ) : (
        <div className="space-y-4">
          {tasks.map((task, index) => (
            <div key={task._tempId} className="border rounded bg-white p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="font-semibold">Task {index + 1}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => moveTask(task._tempId, "up")}
                    disabled={index === 0}
                    className="px-2 py-1 text-sm border rounded disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveTask(task._tempId, "down")}
                    disabled={index === tasks.length - 1}
                    className="px-2 py-1 text-sm border rounded disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeTask(task._tempId)}
                    className="px-2 py-1 text-sm border rounded border-red-500 text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={task.title || ""}
                onChange={(e) =>
                  updateTask(task._tempId, "title", e.target.value)
                }
                placeholder="Optional short title"
                className="w-full border rounded px-2 py-1 mb-2 text-sm"
              />

              <textarea
                value={task.prompt || ""}
                onChange={(e) =>
                  updateTask(task._tempId, "prompt", e.target.value)
                }
                placeholder="Prompt / question..."
                className="w-full border rounded px-2 py-1 mb-3 h-20 text-sm"
              />

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Task type
                  </label>
                  <select
                    value={task.taskType}
                    onChange={(e) =>
                      updateTask(
                        task._tempId,
                        "taskType",
                        normalizeTaskType(e.target.value)
                      )
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  >
                    {TASK_TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs text-gray-500">
                    Category:{" "}
                    <span className="font-medium">
                      {prettyCategory(task.taskType)}
                    </span>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm mt-5">
                  <input
                    type="checkbox"
                    checked={!!task.linear}
                    onChange={(e) =>
                      updateTask(task._tempId, "linear", e.target.checked)
                    }
                  />
                  Keep this task in fixed sequence (for future “mixed” mode)
                </label>
              </div>

              {/* Linked display */}
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  Linked display (optional)
                </label>
                <select
                  value={task.displayKey || ""}
                  onChange={(e) =>
                    updateTask(task._tempId, "displayKey", e.target.value)
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                >
                  <option value="">None</option>
                  {displays.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.stationColor
                        ? `${d.stationColor.toUpperCase()}: `
                        : ""}
                      {d.name || d.key}
                    </option>
                  ))}
                </select>
              </div>

              {/* Options for MC / sort / sequence */}
              {[TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SORT, TASK_TYPES.SEQUENCE].includes(
                task.taskType
              ) && (
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    Options
                  </label>
                  {(task.options || []).map((opt, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) =>
                          updateOption(task._tempId, i, e.target.value)
                        }
                        className="flex-1 border rounded px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => removeOption(task._tempId, i)}
                        className="px-2 py-1 text-sm border rounded border-red-500 text-red-600"
                      >
                        X
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addOption(task._tempId)}
                    className="mt-1 px-3 py-1 text-sm rounded border"
                  >
                    + Add option
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Correct answer
                  </label>
                  {task.taskType === TASK_TYPES.MULTIPLE_CHOICE ? (
                    <select
                      value={task.correctAnswer ?? ""}
                      onChange={(e) =>
                        updateTask(
                          task._tempId,
                          "correctAnswer",
                          e.target.value
                        )
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                    >
                      <option value="">-- none --</option>
                      {(task.options || []).map((opt, i) => (
                        <option key={i} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
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
                      className="w-full border rounded px-2 py-1 text-sm"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Points
                  </label>
                  <input
                    type="number"
                    value={task.points ?? 10}
                    onChange={(e) =>
                      updateTask(
                        task._tempId,
                        "points",
                        Number(e.target.value) || 10
                      )
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Time limit (sec)
                  </label>
                  <input
                    type="number"
                    value={task.timeLimitSeconds ?? ""}
                    onChange={(e) =>
                      updateTask(
                        task._tempId,
                        "timeLimitSeconds",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
