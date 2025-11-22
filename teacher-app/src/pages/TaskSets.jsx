// teacher-app/src/pages/TaskSets.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

export default function TaskSets() {
  const navigate = useNavigate();
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [csvFile, setCsvFile] = useState(null);
  const [csvName, setCsvName] = useState("");
  const [uploading, setUploading] = useState(false);

  const [activeTasksetId, setActiveTasksetId] = useState(() => {
    return localStorage.getItem("curriculateActiveTasksetId") || null;
  });

  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  // Load task sets
  useEffect(() => {
    async function loadSets() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/tasksets`);
        const text = await res.text();

        let data = [];
        try {
          data = text ? JSON.parse(text) : [];
        } catch {
          console.error("❌ JSON parse failed for /api/tasksets");
          console.error("Raw server response:", text.slice(0, 500));
          throw new Error("Server returned invalid JSON for task sets");
        }

        if (!res.ok) throw new Error(data?.error || "Failed to load task sets");

        setSets(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("TaskSets load error:", err);
        setError(err.message || "Failed to load task sets");
      } finally {
        setLoading(false);
      }
    }

    loadSets();
  }, []);

  const handleNew = () => navigate("/tasksets/create");
  const handleEdit = (id) => navigate(`/tasksets/${id}`);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this task set? This cannot be undone.")) return;

    try {
      const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
        method: "DELETE",
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }
      if (!res.ok) throw new Error(data?.error || "Failed to delete task set");
      setSets((prev) => prev.filter((s) => s._id !== id));
    } catch (err) {
      alert(err.message || "Delete failed");
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
    localStorage.setItem("curriculateActiveTasksetMeta", JSON.stringify(meta));
  };

  const handleLaunchNow = (taskset) => {
    handleSetActive(taskset);
    localStorage.setItem("curriculateLaunchImmediately", "true");
    navigate("/live");
  };

  // CSV upload
  const handleCsvFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setCsvFile(file);
    if (file && !csvName) {
      setCsvName(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleCsvUpload = () => {
    if (!csvFile) {
      alert("Choose a CSV file first.");
      return;
    }
    if (!csvName.trim()) {
      alert("Give this task set a name.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const csvText = reader.result;

      try {
        setUploading(true);
        const payload = {
          csvText,
          name: csvName.trim(),
        };

        const res = await fetch(`${API_BASE}/api/upload-csv/from-ccsv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          console.error(
            "Upload CSV returned non-JSON:",
            text.slice(0, 500)
          );
          throw new Error("Server returned invalid JSON");
        }

        if (!res.ok) throw new Error(data?.error || "Upload failed");

        alert(`"${data.name || csvName}" uploaded!`);
        setSets((prev) => [...prev, data]);
        setCsvFile(null);
        setCsvName("");
      } catch (err) {
        console.error(err);
        alert(err.message || "CSV upload failed");
      } finally {
        setUploading(false);
      }
    };

    reader.onerror = () => alert("Failed to read file");
    reader.readAsText(csvFile);
  };

  // Sorting
  const handleSort = (field) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  };

  const sortedSets = useMemo(() => {
    const arr = [...sets];
    const dir = sortDir === "desc" ? -1 : 1;

    arr.sort((a, b) => {
      const get = (obj) => {
        switch (sortBy) {
          case "subject":
            return obj.subject || "";
          case "gradeLevel:
            return obj.gradeLevel || obj.grade || "";
          case "roomLocation":
            return obj.roomLocation || "Classroom";
          case "createdAt":
            return obj.createdAt ? new Date(obj.createdAt).getTime() : 0;
          case "lastUsedAt":
            return obj.lastUsedAt ? new Date(obj.lastUsedAt).getTime() : 0;
          case "playsCount":
            return obj.playsCount ?? 0;
          case "avgEngagement":
            return obj.avgEngagementPercent ?? 0;
          case "avgPerformance":
            return obj.avgPerformancePercent ?? 0;
          case "numTasks":
            return obj.numTasks ?? obj.tasks?.length ?? 0;
          case "name":
          default:
            return obj.name || "";
        }
      };

      const av = get(a);
      const bv = get(b);

      if (typeof av === "number" && typeof bv === "number") {
        return av === bv ? 0 : av < bv ? -dir : dir;
      }

      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as === bs) return 0;
      return as < bs ? -dir : dir;
    });

    return arr;
  }, [sets, sortBy, sortDir]);

  const sortLabel = (field) => {
    if (sortBy !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Task sets</h1>
          <p className="text-sm text-gray-600">
            Browse, sort, and launch your saved task sets.
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          + New task set
        </button>
      </div>

      {/* CSV importer */}
      <div className="mb-8 p-4 rounded border bg-white">
        <h2 className="font-semibold mb-2">Import from CSV</h2>
        <p className="text-sm text-gray-600 mb-3">
          Choose a CSV file in your sample format and give the set a name.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            className="text-sm"
          />

          <input
            type="text"
            placeholder="Name for this imported set"
            value={csvName}
            onChange={(e) => setCsvName(e.target.value)}
            className="border rounded px-2 py-1 flex-1"
          />

          <button
            onClick={handleCsvUpload}
            disabled={uploading}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload CSV"}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p>Loading task sets…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : sortedSets.length === 0 ? (
        <p className="text-gray-600">No task sets yet. Create or import one.</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th onClick={() => handleSort("name")}>
                  Name{sortLabel("name")}
                </Th>
                <Th onClick={() => handleSort("subject")}>
                  Subject{sortLabel("subject")}
                </Th>
                <Th onClick={() => handleSort("gradeLevel")}>
                  Grade{sortLabel("gradeLevel")}
                </Th>
                <Th onClick={() => handleSort("roomLocation")}>
                  Room{sortLabel("roomLocation")}
                </Th>
                <Th onClick={() => handleSort("createdAt")}>
                  Created{sortLabel("createdAt")}
                </Th>
                <Th onClick={() => handleSort("lastUsedAt")}>
                  Last used{sortLabel("lastUsedAt")}
                </Th>
                <Th onClick={() => handleSort("playsCount")}>
                  Plays{sortLabel("playsCount")}
                </Th>
                <Th onClick={() => handleSort("avgEngagement")}>
                  Avg engage %{sortLabel("avgEngagement")}
                </Th>
                <Th onClick={() => handleSort("avgPerformance")}>
                  Avg perf %{sortLabel("avgPerformance")}
                </Th>
                <Th onClick={() => handleSort("numTasks")}>
                  Tasks{sortLabel("numTasks")}
                </Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sortedSets.map((s) => {
                const id = s._id || s.id;
                const isActive = activeTasksetId === id;

                const numTasks = s.numTasks ?? s.tasks?.length ?? 0;
                const createdAt = s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString()
                  : "—";
                const lastUsedAt = s.lastUsedAt
                  ? new Date(s.lastUsedAt).toLocaleDateString()
                  : "—";
                const roomLocation = s.roomLocation || "Classroom";

                const avgEng = s.avgEngagementPercent ?? null;
                const avgPerf = s.avgPerformancePercent ?? null;

                return (
                  <tr key={id} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-gray-900">
                        {s.name}
                      </div>
                      {s.description && (
                        <div className="text-xs text-gray-500">
                          {s.description}
                        </div>
                      )}
                      {isActive && (
                        <div className="text-[0.7rem] text-emerald-700 font-semibold mt-0.5">
                          Currently active in Room View
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {s.subject || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {s.gradeLevel || s.grade || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">{roomLocation}</td>
                    <td className="px-3 py-2 align-top">{createdAt}</td>
                    <td className="px-3 py-2 align-top">{lastUsedAt}</td>
                    <td className="px-3 py-2 align-top">
                      {s.playsCount ?? 0}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {avgEng == null ? "—" : `${avgEng.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {avgPerf == null ? "—" : `${avgPerf.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 align-top">{numTasks}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => handleSetActive(s)}
                          className={`px-2 py-1 text-xs rounded border transition ${
                            isActive
                              ? "bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
                              : "bg-white text-blue-700 border-blue-600 hover:bg-blue-50"
                          }`}
                        >
                          {isActive ? "Active" : "Use"}
                        </button>
                        <button
                          onClick={() => handleLaunchNow(s)}
                          className="px-2 py-1 text-xs rounded bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          Launch
                        </button>
                        <button
                          onClick={() => handleEdit(id)}
                          className="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(id)}
                          className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
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
      className="px-3 py-2 text-left text-xs font-semibold text-gray-700 cursor-pointer select-none"
      onClick={onClick}
    >
      {children}
    </th>
  );
}
