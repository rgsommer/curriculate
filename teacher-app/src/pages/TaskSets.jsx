// teacher-app/src/pages/TaskSets.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

export default function TaskSets() {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [csvFile, setCsvFile] = useState(null);
  const [csvName, setCsvName] = useState("");
  const [uploading, setUploading] = useState(false);

  const [activeTasksetId, setActiveTasksetId] = useState(() => {
    return localStorage.getItem("curriculateActiveTasksetId") || null;
  });

  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const navigate = useNavigate();

  // Load all task sets
  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/tasksets`);
      const text = await res.text();

      let data = [];
      try {
        data = text ? JSON.parse(text) : [];
      } catch (e) {
        console.error("Invalid JSON from /api/tasksets:", text.slice(0, 500));
        throw new Error("Server returned invalid data");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load task sets");
      }

      setSets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load task sets:", err);
      setError(err.message || "Could not load task sets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  // Sorting logic
  const sortedSets = useMemo(() => {
    return [...sets].sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      // Special handling for dates
      if (
        sortBy === "updatedAt" ||
        sortBy === "createdAt" ||
        sortBy === "lastPlayedAt"
      ) {
        aVal = aVal ? new Date(aVal) : 0;
        bVal = bVal ? new Date(bVal) : 0;
      }

      // Special handling for numbers
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      // String fallback
      if (aVal == null) aVal = "";
      if (bVal == null) bVal = "";
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [sets, sortBy, sortDir]);

  const handleSort = (field) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      } else {
        setSortDir("asc");
      }
      return field;
    });
  };

  const handleNew = () => navigate("/ai-generator");
  const handleEdit = (id) => navigate(`/tasksets/${id}`);

  const handleDelete = async (id) => {
    if (
      !window.confirm(
        "Delete this task set permanently? This cannot be undone."
      )
    )
      return;

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to delete");
      }

      await loadSets(); // Refresh list
    } catch (err) {
      setError(err.message || "Failed to delete task set");
    }
  };

  const handleSetActive = (taskset) => {
    const id = taskset._id || taskset.id;
    setActiveTasksetId(id);

    const meta = {
      _id: id,
      name: taskset.name,
      numTasks: taskset.numTasks ?? taskset.tasks?.length ?? 0,
    };

    localStorage.setItem("curriculateActiveTasksetId", id);
    localStorage.setItem(
      "curriculateActiveTasksetMeta",
      JSON.stringify(meta)
    );
  };

  const handleLaunchNow = (taskset) => {
    handleSetActive(taskset);
    localStorage.setItem("curriculateLaunchImmediately", "true");
    navigate("/live");
  };

  // CSV Upload
  const handleCsvFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setCsvFile(file);
    if (file && !csvName) {
      setCsvName(file.name.replace(/\.[^.]+$/, "").replace(/_/g, " "));
    }
  };

  const handleCsvUpload = async () => {
    if (!csvFile) return alert("Please select a CSV file");
    if (!csvName.trim()) return alert("Please enter a name for the task set");

    const reader = new FileReader();
    reader.onload = async () => {
      const csvText = reader.result;

      try {
        setUploading(true);
        const token = localStorage.getItem("token");

        const res = await fetch(`${API_BASE}/api/upload-csv/from-csv`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({
            csvText,
            name: csvName.trim(),
          }),
        });

        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error("Server returned invalid response");
        }

        if (!res.ok) throw new Error(data?.error || "Upload failed");

        alert(`"${data.name || csvName}" uploaded successfully!`);
        setCsvFile(null);
        setCsvName("");
        const input = document.getElementById("csv-input");
        if (input) input.value = "";
        await loadSets(); // Refresh full list
      } catch (err) {
        console.error("CSV upload error:", err);
        alert(err.message || "Failed to upload CSV");
      } finally {
        setUploading(false);
      }
    };

    reader.onerror = () => alert("Failed to read file");
    reader.readAsText(csvFile);
  };

  // Pretty-print a single task set in a new window
  const handlePrint = (taskset) => {
    const tasks = taskset.tasks || [];
    const numTasks = taskset.numTasks ?? tasks.length ?? 0;
    const updated = taskset.updatedAt
      ? new Date(taskset.updatedAt).toLocaleString()
      : "n/a";

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(
    taskset.name || "Task Set"
  )} – Curriculate</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      margin: 24px;
      color: #111827;
      background: #f9fafb;
    }
    h1 {
      margin: 0 0 4px 0;
      font-size: 1.6rem;
    }
    .meta {
      font-size: 0.85rem;
      color: #6b7280;
      margin-bottom: 16px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #e5f3ff;
      color: #1d4ed8;
      font-size: 0.7rem;
      margin-right: 4px;
    }
    .task {
      page-break-inside: avoid;
      background: #ffffff;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
      border: 1px solid #e5e7eb;
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    .task-title {
      font-size: 1rem;
      font-weight: 600;
    }
    .task-type {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
    }
    .prompt {
      margin-top: 4px;
      font-size: 0.9rem;
    }
    .options {
      margin-top: 6px;
      font-size: 0.85rem;
      padding-left: 18px;
    }
    footer {
      margin-top: 24px;
      font-size: 0.7rem;
      color: #9ca3af;
      text-align: right;
    }
    @page {
      margin: 16mm;
    }
  </style>
</head>
<body onload="window.print()">
  <h1>${escapeHtml(taskset.name || "Task Set")}</h1>
  <div class="meta">
    Subject: ${escapeHtml(taskset.subject || "n/a")} · Grade: ${escapeHtml(
      taskset.gradeLevel || "n/a"
    )}<br/>
    Tasks: ${numTasks} · Last updated: ${escapeHtml(updated)}
  </div>

  ${(tasks || [])
    .map((t, idx) => {
      const title = t.title || `Task ${idx + 1}`;
      const prompt =
        typeof t.prompt === "string" ? t.prompt : JSON.stringify(t.prompt || "");
      const type = t.taskType || "unknown";
      const points =
        typeof t.points === "number" ? `${t.points} pts` : null;
      const opts =
        Array.isArray(t.options) && t.options.length
          ? "<ol class='options'>" +
            t.options
              .map(
                (o, i) =>
                  `<li>${escapeHtml(typeof o === "string" ? o : String(o))}</li>`
              )
              .join("") +
            "</ol>"
          : "";

      return `
    <section class="task">
      <div class="task-header">
        <div class="task-title">${idx + 1}. ${escapeHtml(title)}</div>
        <div class="task-type">${escapeHtml(type)}${
        points ? ` · ${escapeHtml(points)}` : ""
      }</div>
      </div>
      <div class="prompt">${escapeHtml(prompt)}</div>
      ${opts}
    </section>
  `;
    })
    .join("")}

  <footer>Generated from Curriculate Task Set</footer>
</body>
</html>
    `;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      alert("Please allow pop-ups to print this task set.");
    }
  };

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 max-w-5xl mx-auto">
      {/* Accessible page title only (visible title lives in top bar) */}
      <h1 className="sr-only">My Task Sets</h1>

      {/* Intro bar – similar tone to TeacherProfile header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
            My Task Sets
          </h2>
          <p className="text-sm text-gray-600">
            AI-generated and CSV-imported sets ready to launch, edit, or print.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleNew}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition font-medium text-sm"
          >
            + New AI Task Set
          </button>
          <button
            onClick={loadSets}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-full hover:bg-gray-50 transition text-sm"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* CSV Upload Section */}
      <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-gray-50 border border-gray-200 rounded-2xl">
        <h2 className="text-base sm:text-lg font-semibold mb-1">
          Upload Task Set from CSV
        </h2>
        <p className="text-xs sm:text-sm text-gray-600 mb-3">
          Turn an existing quiz or word list into a playable Curriculate task
          set.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            className="flex-1 text-sm file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
          <input
            type="text"
            placeholder="Task set name"
            value={csvName}
            onChange={(e) => setCsvName(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={handleCsvUpload}
            disabled={uploading || !csvFile}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 transition font-medium text-sm"
          >
            {uploading ? "Uploading…" : "Upload CSV"}
          </button>
        </div>
      </div>

      {/* Task Sets – card layout */}
      {loading ? (
        <div className="text-center py-10 sm:py-12 text-gray-500 text-sm">
          Loading task sets…
        </div>
      ) : sets.length === 0 ? (
        <div className="text-center py-10 sm:py-12">
          <p className="text-gray-500 text-base sm:text-lg">
            No task sets yet.
          </p>
          <button
            onClick={handleNew}
            className="mt-3 text-sm sm:text-base text-blue-600 font-medium hover:underline"
          >
            Create your first AI task set →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Sort controls – small, pill-style */}
          <div className="flex flex-wrap gap-2 text-xs text-gray-600 mb-1">
            <span className="mr-1">Sort by:</span>
            <SortPill
              label="Name"
              active={sortBy === "name"}
              dir={sortDir}
              onClick={() => handleSort("name")}
            />
            <SortPill
              label="Tasks"
              active={sortBy === "numTasks"}
              dir={sortDir}
              onClick={() => handleSort("numTasks")}
            />
            <SortPill
              label="Updated"
              active={sortBy === "updatedAt"}
              dir={sortDir}
              onClick={() => handleSort("updatedAt")}
            />
            <SortPill
              label="Plays"
              active={sortBy === "timesPlayed"}
              dir={sortDir}
              onClick={() => handleSort("timesPlayed")}
            />
          </div>

          {sortedSets.map((s) => {
            const id = s._id || s.id;
            const isActive = activeTasksetId === id;
            const numTasks = s.numTasks ?? s.tasks?.length ?? 0;
            const updated = s.updatedAt
              ? new Date(s.updatedAt).toLocaleDateString()
              : "—";

            return (
              <div
                key={id}
                className="bg-white border border-gray-200 rounded-2xl shadow-sm px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                {/* Left: name + meta + tags */}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium text-gray-900 text-sm sm:text-base">
                      {s.name || s.title || "Untitled Task Set"}
                    </div>
                    {isActive && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">
                        Active in Room
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-2">
                    <span>
                      {numTasks} task{numTasks === 1 ? "" : "s"}
                    </span>
                    <span>· Updated {updated}</span>
                    <span>· Played {s.timesPlayed || 0}x</span>
                  </div>

                  {s.requiredTaskTypes && s.requiredTaskTypes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.requiredTaskTypes.map((type) => (
                        <span
                          key={type}
                          className="inline-block px-2 py-0.5 text-[11px] font-medium text-indigo-700 bg-indigo-100 rounded-full"
                        >
                          {type
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                      ))}
                    </div>
                  )}

                  {s.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {s.description}
                    </div>
                  )}
                </div>

                {/* Right: action buttons */}
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={() => handleSetActive(s)}
                    onDoubleClick={() => handleLaunchNow(s)}
                    className={`px-3 py-1.5 text-xs sm:text-sm rounded-full font-medium transition ${
                      isActive
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-white text-blue-700 border border-blue-600 hover:bg-blue-50"
                    }`}
                    title="Click to select • Double-click to launch"
                  >
                    {isActive ? "Active 🚀" : "Use in Session"}
                  </button>

                  <button
                    onClick={() => handleLaunchNow(s)}
                    className="px-3 py-1.5 text-xs sm:text-sm bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition font-medium"
                  >
                    Launch
                  </button>

                  <button
                    onClick={() => handleEdit(id)}
                    className="px-3 py-1.5 text-xs sm:text-sm bg-gray-600 text-white rounded-full hover:bg-gray-700 transition"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => handlePrint(s)}
                    className="px-3 py-1.5 text-xs sm:text-sm bg-white text-gray-800 border border-gray-300 rounded-full hover:bg-gray-50 transition"
                  >
                    Print
                  </button>

                  <button
                    onClick={() => handleDelete(id)}
                    className="px-3 py-1 text-xs sm:text-sm bg-red-600 text-white rounded-full hover:bg-red-700 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Small helper for sort pills
function SortPill({ label, active, dir, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-full border text-[11px] ${
        active
          ? "bg-blue-50 border-blue-400 text-blue-700"
          : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
      {active ? dir === "asc" ? " ↑" : " ↓" : ""}
    </button>
  );
}

// Very small HTML escaper for the print template
function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
