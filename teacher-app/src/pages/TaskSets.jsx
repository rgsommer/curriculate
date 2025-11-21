// teacher-app/src/pages/TaskSets.jsx
import React, { useEffect, useState } from "react";
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

  // -------------------------------------------------------------------
  // Load task sets — minimal, known-good URL, no tokens/extra params
  // -------------------------------------------------------------------
  useEffect(() => {
    async function loadSets() {
      setLoading(true);
      setError(null);

      try {
        const url = `${API_BASE}/api/tasksets`;

        const res = await fetch(url);
        const text = await res.text();

        let data = [];
        try {
          data = text ? JSON.parse(text) : [];
        } catch (parseErr) {
          console.error("❌ JSON parse failed for /api/tasksets");
          console.error(
            "Raw server response (first 500 chars):",
            text.slice(0, 500)
          );
          throw new Error("Server returned invalid JSON when loading task sets");
        }

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load task sets");
        }

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

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------
  const handleNew = () => {
    navigate("/tasksets/create");
  };

  const handleEdit = (id) => {
    navigate(`/tasksets/edit/${id}`);
  };

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
        // ignore parse errors for DELETE
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete task set");
      }

      setSets((prev) => prev.filter((s) => s._id !== id));
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  };

  const handleSetActive = (taskset) => {
    const id = taskset._id || taskset.id;
    setActiveTasksetId(id);

    const meta = {
      _id: taskset._id,
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

  // -------------------------------------------------------------------
  // CSV upload
  // -------------------------------------------------------------------
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
        } catch (err) {
          console.error("CSV upload returned non-JSON:", text.slice(0, 500));
          throw new Error("Server returned invalid JSON");
        }

        if (!res.ok) {
          throw new Error(data?.error || "Upload failed");
        }

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

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Task Sets</h1>
        <button
          onClick={handleNew}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          + New Task Set
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
      ) : sets.length === 0 ? (
        <p className="text-gray-600">No task sets yet. Create or import one.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sets.map((s) => {
            const id = s._id || s.id;
            const isActive = activeTasksetId === id;

            return (
              <div key={id} className="border rounded bg-white p-4">
                <h3 className="font-semibold text-lg mb-1">{s.name}</h3>

                {s.description && (
                  <p className="text-sm text-gray-600 mb-1">
                    {s.description}
                  </p>
                )}

                <p className="text-xs text-gray-500 mb-1">
                  {s.numTasks ?? s.tasks?.length ?? 0} tasks
                </p>

                {isActive && (
                  <p className="text-xs text-emerald-700 font-semibold mb-2">
                    Currently active in Live Session
                  </p>
                )}

                <div className="flex gap-2 mt-2 flex-wrap">
                  <button
                    onClick={() => handleSetActive(s)}
                    className={`px-3 py-1 text-sm rounded border transition ${
                      isActive
                        ? "bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
                        : "bg-white text-blue-700 border-blue-600 hover:bg-blue-50"
                    }`}
                  >
                    {isActive ? "Active in Live Session" : "Use in Live Session"}
                  </button>

                  <button
                    onClick={() => handleLaunchNow(s)}
                    className="px-3 py-1 text-sm rounded bg-emerald-500 text-white hover:bg-emerald-600"
                  >
                    Launch now
                  </button>

                  <button
                    onClick={() => handleEdit(id)}
                    className="px-3 py-1 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => handleDelete(id)}
                    className="px-3 py-1 text-sm rounded bg-red-500 text-white hover:bg-red-600"
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
