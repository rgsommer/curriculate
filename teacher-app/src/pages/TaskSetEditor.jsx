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
      return TASK_TYPES.SHORT_ANSWER;
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
    case "jeopardy":
      return TASK_TYPES.JEOPARDY;
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
        ignoreNoise: false,
        jeopardyConfig: {},
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
          ? (t.options || []).filter((opt) => !!opt && opt.trim() !== "")
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
      <div className="taskset-editor max-w-4xl mx-auto">
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
    <div className="taskset-editor max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
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
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Displays / stations</h2>
          <button
            onClick={addDisplay}
            className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
          >
            + Add display
          </button>
        </div>
        <p className="text-xs text-gray-600 mb-2">
          Displays are physical screens, boards, or table-top instructions that
          stay fixed while teams rotate. You can attach tasks to a specific
          display if needed.
        </p>

        {displays.length === 0 ? (
          <p className="text-sm text-gray-500">
            No displays yet. You can still run this set without them.
          </p>
        ) : (
          <div className="space-y-3">
            {displays.map((d, index) => (
              <div key={d.key || index} className="border rounded p-3 bg-gray-50">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-semibold text-sm">
                    Display {index + 1}
                  </div>
                  <button
                    onClick={() => removeDisplay(index)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Name / label
                    </label>
                    <input
                      type="text"
                      value={d.name || ""}
                      onChange={(e) =>
                        updateDisplay(index, "name", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="e.g. Red Station, Microscope table"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Station colour (optional)
                    </label>
                    <input
                      type="text"
                      value={d.stationColor || ""}
                      onChange={(e) =>
                        updateDisplay(index, "stationColor", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="e.g. Red, Blue, etc."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Description / what’s here
                    </label>
                    <textarea
                      value={d.description || ""}
                      onChange={(e) =>
                        updateDisplay(index, "description", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm h-16"
                      placeholder="e.g. microscope, set of primary documents, dice and cards"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Image URL (optional)
                    </label>
                    <input
                      type="text"
                      value={d.imageUrl || ""}
                      onChange={(e) =>
                        updateDisplay(index, "imageUrl", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="For projector or display-only resources"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Notes for the teacher
                    </label>
                    <textarea
                      value={d.notesForTeacher || ""}
                      onChange={(e) =>
                        updateDisplay(index, "notesForTeacher", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm h-16"
                      placeholder="Setup details, safety hints, or reminders for you."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TASKS PANEL */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Tasks</h2>
          <button
            onClick={addTask}
            className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
          >
            + Add task
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-500">
            No tasks yet. Add at least one to save this set.
          </p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, index) => (
              <div key={task._tempId} className="border rounded p-3 bg-gray-50">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-semibold text-sm">
                    Task {index + 1} –{" "}
                    <span className="text-xs text-gray-600">
                      {prettyCategory(task.taskType)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveTask(task._tempId, "up")}
                      className="px-2 py-1 text-xs border rounded"
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTask(task._tempId, "down")}
                      className="px-2 py-1 text-xs border rounded"
                      disabled={index === tasks.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(task._tempId)}
                      className="px-2 py-1 text-xs border rounded text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Title (optional)
                    </label>
                    <input
                      type="text"
                      value={task.title || ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "title", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="e.g. Understanding inertia"
                    />
                  </div>
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
                      {TASK_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    Prompt
                  </label>
                  <textarea
                    value={task.prompt || ""}
                    onChange={(e) =>
                      updateTask(task._tempId, "prompt", e.target.value)
                    }
                    className="w-full border rounded px-2 py-1 text-sm h-20"
                  />
                </div>

                {/* Options area for MC / sort / sequence */}
                {[
                  TASK_TYPES.MULTIPLE_CHOICE,
                  TASK_TYPES.SORT,
                  TASK_TYPES.SEQUENCE,
                ].includes(task.taskType) && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium mb-1">
                      Options
                    </label>
                    <div className="space-y-2">
                      {(task.options || []).map((opt, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) =>
                              updateOption(task._tempId, i, e.target.value)
                            }
                            className="flex-1 border rounded px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(task._tempId, i)}
                            className="px-2 py-1 text-xs border rounded text-red-600"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(task._tempId)}
                        className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                      >
                        + Add option
                      </button>
                    </div>
                  </div>
                )}

                {/* Correct answer */}
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    Correct answer (optional)
                  </label>
                  <input
                    type="text"
                    value={
                      task.taskType === TASK_TYPES.MULTIPLE_CHOICE &&
                      typeof task.correctAnswer === "number"
                        ? (task.options || [])[task.correctAnswer] || ""
                        : task.correctAnswer || ""
                    }
                    onChange={(e) =>
                      updateTask(task._tempId, "correctAnswer", e.target.value)
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                    placeholder="Leave blank for open / unscored tasks"
                  />
                </div>

                {/* Points, time, display mapping, noise control */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                          Number(e.target.value) || 0
                        )
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Time limit (seconds, optional)
                    </label>
                    <input
                      type="number"
                      value={task.timeLimitSeconds ?? ""}
                      onChange={(e) =>
                        updateTask(
                          task._tempId,
                          "timeLimitSeconds",
                          e.target.value === ""
                            ? ""
                            : Number(e.target.value) || 0
                        )
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Display (optional)
                    </label>
                    <select
                      value={task.displayKey || ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "displayKey", e.target.value)
                      }
                      className="w-full border rounded px-2 py-1 text-sm"
                    >
                      <option value="">(none)</option>
                      {displays.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name || d.key}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center md:items-start mt-2 md:mt-6">
                    <label className="inline-flex items-center text-xs text-gray-600">
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={!!task.ignoreNoise}
                        onChange={(e) =>
                          updateTask(
                            task._tempId,
                            "ignoreNoise",
                            e.target.checked
                          )
                        }
                      />
                      Ignore ambient-noise dimming
                    </label>
                  </div>
                </div>

                {/* Jeopardy configuration (only for Jeopardy tasks) */}
                {task.taskType === TASK_TYPES.JEOPARDY && (
                  <div className="mt-3 p-3 border rounded bg-indigo-50 text-xs text-gray-700">
                    <p className="mb-1 font-semibold">Jeopardy configuration</p>
                    <p className="mb-2">
                      This task will run as a Jeopardy-style game. Use these
                      fields to give the game a clear identity and to guide AI
                      when generating the board (categories &amp; clues).
                    </p>
                    <label className="block mb-2">
                      Board title (optional)
                      <input
                        type="text"
                        value={task.jeopardyConfig?.boardTitle || ""}
                        onChange={(e) =>
                          updateTask(task._tempId, "jeopardyConfig", {
                            ...(task.jeopardyConfig || {}),
                            boardTitle: e.target.value,
                          })
                        }
                        className="mt-1 w-full border rounded px-2 py-1 text-xs"
                        placeholder="e.g., Confederation Showdown"
                      />
                    </label>
                    <label className="block">
                      Notes to AI (optional)
                      <textarea
                        value={task.jeopardyConfig?.aiNotes || ""}
                        onChange={(e) =>
                          updateTask(task._tempId, "jeopardyConfig", {
                            ...(task.jeopardyConfig || {}),
                            aiNotes: e.target.value,
                          })
                        }
                        className="mt-1 w-full border rounded px-2 py-1 text-xs"
                        rows={3}
                        placeholder="Any extra instructions about difficulty, mix of categories, local examples, etc."
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
