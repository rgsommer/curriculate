// teacher-app/src/pages/TaskSets.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "";

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

      // Numbers
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Strings
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

      await loadSets();
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
        await loadSets();
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

  // Simple “button” style helpers
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

  const redButton = {
    ...btnBase,
    background: "#dc2626",
    color: "#ffffff",
    borderColor: "#b91c1c",
  };

  const greenButton = {
    ...btnBase,
    background: "#059669",
    color: "#ffffff",
    borderColor: "#047857",
  };

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 960,
        margin: "0 auto",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 600,
            }}
          >
            My Task Sets
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "0.9rem",
              color: "#4b5563",
            }}
          >
            AI-generated and CSV-imported sets ready to launch, edit, or print.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <button style={blueButton} onClick={handleNew}>
            + New AI Task Set
          </button>
          <button
            style={grayButton}
            disabled={loading}
            onClick={loadSets}
          >
            {loading ? "Loading…" : "Refresh"}
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

      {/* CSV Upload Section */}
      <div
        style={{
          marginBottom: 20,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1rem",
            fontWeight: 600,
          }}
        >
          Upload Task Set from CSV
        </h2>
        <p
          style={{
            margin: "4px 0 10px",
            fontSize: "0.85rem",
            color: "#4b5563",
          }}
        >
          Turn an existing quiz or word list into a playable Curriculate task
          set.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            id="csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            style={{ fontSize: "0.8rem" }}
          />
          <input
            type="text"
            placeholder="Task set name"
            value={csvName}
            onChange={(e) => setCsvName(e.target.value)}
            style={{
              flex: 1,
              minWidth: 160,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              padding: 6,
              fontSize: "0.8rem",
            }}
          />
          <button
            style={greenButton}
            disabled={uploading || !csvFile}
            onClick={handleCsvUpload}
          >
            {uploading ? "Uploading…" : "Upload CSV"}
          </button>
        </div>
      </div>

      {/* Task Sets list */}
      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            fontSize: "0.9rem",
            color: "#6b7280",
          }}
        >
          Loading task sets…
        </div>
      ) : sets.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.95rem",
              color: "#6b7280",
            }}
          >
            No task sets yet.
          </p>
          <button
            style={{
              marginTop: 8,
              ...blueButton,
            }}
            onClick={handleNew}
          >
            Create your first AI task set →
          </button>
        </div>
      ) : (
        <>
          {/* Sort controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              fontSize: "0.8rem",
              color: "#4b5563",
              marginBottom: 4,
              alignItems: "center",
            }}
          >
            <span>Sort by:</span>
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

          {/* Cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
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
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    padding: 10,
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                  }}
                >
                  {/* Left: info */}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.95rem",
                          fontWeight: 600,
                          color: "#111827",
                        }}
                      >
                        {s.name || s.title || "Untitled Task Set"}
                      </div>
                      {isActive && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#d1fae5",
                            color: "#065f46",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                          }}
                        >
                          Active in Room
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: "0.8rem",
                        color: "#4b5563",
                      }}
                    >
                      {numTasks} task{numTasks === 1 ? "" : "s"} · Updated{" "}
                      {updated} · Played {s.timesPlayed || 0}x
                    </div>

                    {Array.isArray(s.requiredTaskTypes) &&
                      s.requiredTaskTypes.length > 0 && (
                        <div
                          style={{
                            marginTop: 4,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                          }}
                        >
                          {s.requiredTaskTypes.map((type) => (
                            <span
                              key={type}
                              style={{
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: "#e0e7ff",
                                color: "#3730a3",
                                fontSize: "0.7rem",
                                fontWeight: 500,
                              }}
                            >
                              {type
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                          ))}
                        </div>
                      )}

                    {s.description && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: "0.8rem",
                          color: "#6b7280",
                          maxWidth: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={s.description}
                      >
                        {s.description}
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      style={
                        isActive
                          ? blueButton
                          : { ...grayButton, borderColor: "#2563eb", color: "#1d4ed8" }
                      }
                      onClick={() => handleSetActive(s)}
                      onDoubleClick={() => handleLaunchNow(s)}
                      title="Click to select • Double-click to launch"
                    >
                      {isActive ? "Active 🚀" : "Use in Session"}
                    </button>
                    <button
                      style={greenButton}
                      onClick={() => handleLaunchNow(s)}
                    >
                      Launch
                    </button>
                    <button
                      style={grayButton}
                      onClick={() => handleEdit(id)}
                    >
                      Edit
                    </button>
                    <button
                      style={grayButton}
                      onClick={() => handlePrint(s)}
                    >
                      Print
                    </button>
                    <button
                      style={redButton}
                      onClick={() => handleDelete(id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SortPill({ label, active, dir, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${active ? "#60a5fa" : "#d1d5db"}`,
        background: active ? "#eff6ff" : "#ffffff",
        fontSize: "0.75rem",
        cursor: "pointer",
      }}
    >
      {label}
      {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
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
