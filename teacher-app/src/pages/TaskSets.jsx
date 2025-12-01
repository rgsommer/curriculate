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

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 max-w-7xl mx-auto">
      {/* Accessible page title only (visible title lives in top bar) */}
      <h1 className="sr-only">My Task Sets</h1>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="sm:flex-1">
          <p className="text-sm text-gray-600">
            Manage, launch, and upload task sets for your live sessions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleNew}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm"
          >
            + New AI Task Set
          </button>
          <button
            onClick={loadSets}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
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
      <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-gray-50 border border-gray-200 rounded-xl">
        <h2 className="text-base sm:text-lg font-semibold mb-2">
          Upload Task Set from CSV
        </h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            className="flex-1 text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
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

      {/* Task Sets Table */}
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
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <Th onClick={() => handleSort("name")}>
                  Name{" "}
                  {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                </Th>
                <Th onClick={() => handleSort("numTasks")}>Tasks</Th>
                <Th onClick={() => handleSort("updatedAt")}>
                  Updated{" "}
                  {sortBy === "updatedAt" &&
                    (sortDir === "asc" ? "↑" : "↓")}
                </Th>
                <Th onClick={() => handleSort("timesPlayed")}>Plays</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sortedSets.map((s) => {
                const id = s._id || s.id;
                const isActive = activeTasksetId === id;
                const numTasks = s.numTasks ?? s.tasks?.length ?? 0;
                const updated = s.updatedAt
                  ? new Date(s.updatedAt).toLocaleDateString()
                  : "—";

                return (
                  <tr
                    key={id}
                    className="border-t hover:bg-gray-50 transition"
                  >
                    <td className="px-3 sm:px-4 py-3 align-top">
                      <div>
                        <div className="font-medium text-gray-900 text-sm">
                          {s.name || s.title || "Untitled Task Set"}
                        </div>
                        {s.requiredTaskTypes &&
                          s.requiredTaskTypes.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {s.requiredTaskTypes.map((type) => (
                                <span
                                  key={type}
                                  className="inline-block px-2 py-0.5 text-[11px] font-medium text-indigo-700 bg-indigo-100 rounded-full"
                                >
                                  {type
                                    .replace(/_/g, " ")
                                    .replace(/\b\w/g, (c) =>
                                      c.toUpperCase()
                                    )}
                                </span>
                              ))}
                            </div>
                          )}
                      </div>
                      {s.description && (
                        <div className="text-xs text-gray-500 mt-1">
                          {s.description}
                        </div>
                      )}
                      {isActive && (
                        <span className="inline-block mt-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">
                          Active in Room
                        </span>
                      )}
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-center text-sm">
                      {numTasks}
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-xs text-gray-600">
                      {updated}
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-center text-sm">
                      {s.timesPlayed || 0}
                    </td>
                    <td className="px-3 sm:px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleSetActive(s)}
                          onDoubleClick={() => handleLaunchNow(s)}
                          className={`px-3 py-1.5 text-xs sm:text-sm rounded font-medium transition ${
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
                          className="px-3 py-1.5 text-xs sm:text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 transition font-medium"
                        >
                          Launch Now
                        </button>

                        <button
                          onClick={() => handleEdit(id)}
                          className="px-3 py-1.5 text-xs sm:text-sm bg-gray-600 text-white rounded hover:bg-gray-700 transition"
                        >
                          Edit
                        </button>

                        <button
                          onClick={() => handleDelete(id)}
                          className="px-3 py-1 text-xs sm:text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, onClick }) {
  return (
    <th
      onClick={onClick}
      className="px-3 sm:px-4 py-2 sm:py-3 text-left text-[11px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition select-none"
    >
      {children}
    </th>
  );
}
