// teacher-app/src/pages/TaskSetEditor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = "http://localhost:10000";

const TASK_TYPES = [
  { value: "open", label: "Open Answer" },
  { value: "mc", label: "Multiple Choice" },
  { value: "sequence", label: "Sequence" },
];

export default function TaskSetEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const userId = localStorage.getItem("userId");
  const token = localStorage.getItem("token");

  // Load existing set if editing
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
        setTasks(
          (data.tasks || []).map((t) => ({
            ...t,
            _tempId: Math.random().toString(36).slice(2),
          }))
        );
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || "Failed to load task set");
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  const addTask = () => {
    setTasks((prev) => [
      ...prev,
      {
        _tempId: Math.random().toString(36).slice(2),
        title: "",
        prompt: "",
        task_type: "open",
        options: [],
        correctAnswer: "",
        points: 10,
        time_limit: null,
        linear: true,
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
              options: t.options.map((o, i) => (i === index ? value : o)),
            }
          : t
      )
    );
  };

  const removeOption = (tempId, index) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId
          ? { ...t, options: t.options.filter((_, i) => i !== index) }
          : t
      )
    );
  };

  const save = async () => {
    if (!name.trim()) {
      alert("Name is required.");
      return;
    }
    if (tasks.length === 0) {
      alert("Add at least one task.");
      return;
    }

    const cleanTasks = tasks.map(({ _tempId, ...t }, index) => {
      const options =
        t.task_type === "mc" || t.task_type === "sequence"
          ? (t.options || []).filter(Boolean)
          : [];

      let correctAnswer = t.correctAnswer;
      if (t.task_type === "mc" && typeof correctAnswer === "string") {
        // store index of correct option if we have one
        const idx = options.findIndex(
          (o) =>
            o.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
        );
        if (idx >= 0) correctAnswer = idx;
      }

      return {
        ...t,
        options,
        correctAnswer,
        orderIndex: t.orderIndex ?? index,
      };
    });

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

  return (
    <div className="max-w-4xl mx-auto">
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
                    value={task.task_type}
                    onChange={(e) =>
                      updateTask(task._tempId, "task_type", e.target.value)
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  >
                    {TASK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
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

              {task.task_type === "mc" && (
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
                  {task.task_type === "mc" ? (
                    <select
                      value={task.correctAnswer ?? ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "correctAnswer", e.target.value)
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
                        updateTask(task._tempId, "correctAnswer", e.target.value)
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
                    value={task.time_limit ?? ""}
                    onChange={(e) =>
                      updateTask(
                        task._tempId,
                        "time_limit",
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
