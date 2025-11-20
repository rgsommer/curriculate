// src/pages/TasksetGeneratorPage.jsx
import React, { useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function TasksetGeneratorPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [wordList, setWordList] = useState("");
  const [includeTypes, setIncludeTypes] = useState({
    mc: true,
    tf: true,
    short: true,
    sort: true,
    sequence: true,
    photo: true,
    makeSnap: true,
    bodyBreak: true,
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const onToggleType = (key) => {
    setIncludeTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleGenerate = async () => {
    setError("");
    setGenerated(null);
    setSaveStatus("");

    const words = wordList
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter(Boolean);

    if (words.length === 0) {
      setError("Please enter at least one term.");
      return;
    }

    setGenerating(true);
    try {
      const res = await api.post("/tasksets/generate", {
        name: name || "Untitled Taskset",
        words,
        types: includeTypes,
      });
      setGenerated(res.data.taskset || res.data);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error ||
          "Unable to generate tasks. Please check your subscription limits."
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generated) return;
    setSaveStatus("");
    try {
      const res = await api.post("/tasksets/save", {
        name: generated.name,
        tasks: generated.tasks,
      });
      setSaveStatus("Saved successfully.");
    } catch (err) {
      console.error(err);
      setSaveStatus(
        err.response?.data?.error ||
          "Unable to save taskset. PLUS or PRO required."
      );
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Taskset Generator</h1>
          <p className="text-sm text-gray-600">
            Paste your word list and let Curriculate generate rich, multi-mode
            tasks.
          </p>
        </div>
        {user && (
          <div className="text-xs text-gray-600">
            Plan: <strong>{user.subscriptionTier}</strong>
          </div>
        )}
      </header>

      {/* Word list + options */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold mb-1">
            Taskset name
          </label>
          <input
            className="w-full border rounded px-3 py-1 mb-3 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., History 7 – New France Unit 1"
          />

          <label className="block text-xs font-semibold mb-1">
            Word list (one term per line)
          </label>
          <textarea
            className="w-full border rounded px-3 py-2 text-sm h-56"
            value={wordList}
            onChange={(e) => setWordList(e.target.value)}
            placeholder={"Champlain\nAcadian Expulsion\nMercantilism\n..."}
          />
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2">Task types to include</h2>
          <div className="space-y-1 text-sm">
            {[
              ["mc", "Multiple Choice"],
              ["tf", "True/False"],
              ["short", "Short Answer"],
              ["sort", "Sort / Classify"],
              ["sequence", "Sequence"],
              ["photo", "Photo"],
              ["makeSnap", "Make & Snap"],
              ["bodyBreak", "Body Break"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeTypes[key]}
                  onChange={() => onToggleType(key)}
                />
                {label}
              </label>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 w-full text-sm border rounded px-3 py-2 bg-gray-900 text-white hover:bg-black disabled:opacity-60"
          >
            {generating ? "Generating…" : "Generate Taskset"}
          </button>

          {generated && (
            <>
              <button
                onClick={handleSave}
                className="mt-2 w-full text-sm border rounded px-3 py-1 hover:bg-gray-100"
              >
                Save Taskset (PLUS/PRO)
              </button>
              {saveStatus && (
                <div className="mt-1 text-xs text-gray-700">{saveStatus}</div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Generated preview */}
      {generated && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            Generated tasks ({generated.tasks?.length || 0})
          </h2>
          <div className="border rounded bg-white max-h-[300px] overflow-auto text-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 text-xs">
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-left">Prompt</th>
                </tr>
              </thead>
              <tbody>
                {generated.tasks?.map((t, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2 align-top text-xs">{idx + 1}</td>
                    <td className="p-2 align-top text-xs">{t.type}</td>
                    <td className="p-2 align-top">
                      {t.prompt || JSON.stringify(t.config)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
