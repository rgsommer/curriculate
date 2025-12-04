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
          (data.tasks || []).map((t, idx) => ({
            ...t,
            taskType: normalizeTaskType(t.taskType || t.task_type),
            timeLimitSeconds: t.timeLimitSeconds ?? t.time_limit ?? null,
            displayKey: t.displayKey || "",
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">
          {id ? "Edit Task Set" : "New Task Set"}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/tasksets")}
            className="px-3 py-1.5 text-sm rounded-full border border-gray-300 bg-white hover:bg-gray-50"
          >
            Back to list
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            {saving ? "Saving…" : "Save task set"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500 text-sm">
          Loading task set…
        </div>
      ) : (
        <>
          {/* BASIC INFO PANEL */}
          <div className="mb-6 border rounded-lg p-4 bg-white shadow-sm">
            <h2 className="text-base font-semibold mb-3">Basic info</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="e.g. Confederation Stations – Brain Blitz & Review"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm h-20"
                  placeholder="Short note to your future self about how and when to use this set."
                />
              </div>
            </div>
          </div>

          {/* AI WORD USAGE PANEL */}
          {(aiWordBank.length > 0 ||
            aiWordsUsed.length > 0 ||
            aiWordsUnused.length > 0) && (
            <div className="mb-6 border rounded-lg p-4 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    AI word bank usage (from generator)
                  </h2>
                  <p className="text-xs text-gray-700">
                    These words came from your AI generator step. See which
                    ones were used in this task set and which are still
                    “unused” so you can quickly build a follow-up set.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateFromUnused}
                  disabled={!aiWordsUnused.length}
                  className="mt-2 sm:mt-0 px-3 py-1.5 text-xs rounded-full bg-emerald-600 text-white disabled:bg-gray-400 hover:bg-emerald-700"
                >
                  Create new task set with unused words
                </button>
              </div>

              {aiWordsUsed.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-green-800 mb-1">
                    ✅ Used in this task set
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {aiWordsUsed.map((w, i) => (
                      <span
                        key={`used-${i}-${w}`}
                        className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-green-100 text-green-800"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiWordsUnused.length > 0 && (
                <div className="mb-1">
                  <div className="text-xs font-semibold text-yellow-800 mb-1">
                    ❌ Not yet used — great for another set
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {aiWordsUnused.map((w, i) => (
                      <span
                        key={`unused-${i}-${w}`}
                        className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-yellow-100 text-yellow-800"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiWordBank.length > 0 && (
                <div className="mt-2 text-[11px] text-gray-600">
                  Total in original list: {aiWordBank.length}
                </div>
              )}
            </div>
          )}

          {/* DISPLAYS PANEL */}
          <div className="mb-8 border rounded-lg p-4 bg-white shadow-sm">
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
              Displays are physical screens, boards, or table-top instructions
              that stay fixed while teams rotate. You can attach tasks to a
              specific display if needed.
            </p>

            {displays.length === 0 ? (
              <p className="text-sm text-gray-500">
                No displays yet. You can still run this set without them.
              </p>
            ) : (
              <div className="space-y-3">
                {displays.map((d, index) => (
                  <div
                    key={d.key || index}
                    className="border rounded p-3 bg-gray-50"
                  >
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
                          placeholder="e.g. Confederation Station A"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Station color (optional)
                        </label>
                        <input
                          type="text"
                          value={d.stationColor || ""}
                          onChange={(e) =>
                            updateDisplay(index, "stationColor", e.target.value)
                          }
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="e.g. Red, Green, Blue…"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">
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
                          className="w-full border rounded px-2 py-1 text-sm h-16"
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
                  <div
                    key={task._tempId}
                    className="border rounded p-3 bg-gray-50"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="font-semibold text-sm">
                        Task {index + 1} –{" "}
                        <span className="text-xs text-gray-600">
                          {prettyCategory(task.taskType)} •{" "}
                          {TASK_TYPE_META[task.taskType]?.label ||
                            task.taskType}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => moveTask(task._tempId, "up")}
                          className="text-xs border rounded px-2 py-0.5 bg-white hover:bg-gray-100"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveTask(task._tempId, "down")}
                          className="text-xs border rounded px-2 py-0.5 bg-white hover:bg-gray-100"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => removeTask(task._tempId)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">
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
                          className="w-full border rounded px-2 py-1 text-sm"
                        >
                          {IMPLEMENTED_TASK_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {TASK_TYPE_META[type]?.label || type}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {TASK_TYPE_META[task.taskType]?.description}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
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
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
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
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-sm font-medium mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={task.title || ""}
                        onChange={(e) =>
                          updateTask(task._tempId, "title", e.target.value)
                        }
                        className="w-full border rounded px-2 py-1 text-sm"
                        placeholder="e.g. Name the First Four Provinces"
                      />
                    </div>

                    <div className="mb-3">
                      <label className="block text-sm font-medium mb-1">
                        Prompt / question
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
                              {task.taskType === TASK_TYPES.MULTIPLE_CHOICE && (
                                <label className="flex items-center gap-1 text-xs">
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
                                onClick={() =>
                                  removeOption(task._tempId, i)
                                }
                                className="text-xs text-red-600"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addOption(task._tempId)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            + Add option
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Display assignment */}
                    <div className="mb-2">
                      <label className="block text-sm font-medium mb-1">
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
                        className="w-full border rounded px-2 py-1 text-sm"
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
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
