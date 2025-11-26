// teacher-app/src/pages/AiTasksetGenerator.jsx

import { useEffect, useState } from "react";
import { fetchMyProfile } from "../api/profile";
import api from "../api/client";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

export default function AiTasksetGenerator() {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState({
    gradeLevel: "",
    subject: "",
    difficulty: "MEDIUM",
    learningGoal: "REVIEW",
    topicDescription: "",
    numberOfTasks: 8,
  });

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;
        setProfile(data || null);

        if (data?.defaultGradeLevel && !form.gradeLevel) {
          setForm((prev) => ({ ...prev, gradeLevel: data.defaultGradeLevel }));
        }
        if (data?.defaultSubject && !form.subject) {
          setForm((prev) => ({ ...prev, subject: data.defaultSubject }));
        }
      } catch (err) {
        console.error("Failed to load profile for AI generator:", err);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (generating) return;

    setError("");
    setResult(null);
    setGenerating(true);

    try {
      const payload = {
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,
        topicDescription: form.topicDescription,
        numberOfTasks: Number(form.numberOfTasks) || 8,
        presenterProfile: profile || undefined,
      };

      // Use shared axios client so Authorization header is included
      const response = await api.post("/api/ai/tasksets", payload);
      const data = response.data;
      const taskset = data?.taskset || data;

      if (!taskset) {
        throw new Error(
          "Server did not return a taskset. Check /api/ai/tasksets on the backend."
        );
      }

      setResult(taskset);
    } catch (err) {
      console.error("AI taskset generation failed:", err);

      let msg = "Failed to generate TaskSet";

      // Axios-style error handling
      if (err.response) {
        const status = err.response.status;
        const data = err.response.data;

        if (status === 401 || status === 403) {
          msg =
            data?.message ||
            data?.error ||
            "You may need to sign in or upgrade your subscription to use the AI generator.";
        } else {
          msg =
            data?.message ||
            data?.error ||
            `Server error (${status}) while generating TaskSet.`;
        }
      } else if (err.message) {
        msg = err.message;
      }

      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>AI TaskSet Generator</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        Describe what you want, and Curriculate will draft a TaskSet for you.
      </p>

      {loadingProfile && <p>Loading presenter profile…</p>}

      <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Grade level
            </label>
            <input
              type="text"
              value={form.gradeLevel}
              onChange={(e) => handleChange("gradeLevel", e.target.value)}
              placeholder="e.g., Grade 7"
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Subject
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => handleChange("subject", e.target.value)}
              placeholder="e.g., History – War of 1812"
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Difficulty
            </label>
            <select
              value={form.difficulty}
              onChange={(e) => handleChange("difficulty", e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Learning goal
            </label>
            <select
              value={form.learningGoal}
              onChange={(e) => handleChange("learningGoal", e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            >
              {LEARNING_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Number of tasks
            </label>
            <input
              type="number"
              min={4}
              max={20}
              value={form.numberOfTasks}
              onChange={(e) => handleChange("numberOfTasks", e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              marginBottom: 2,
              color: "#4b5563",
            }}
          >
            Topic / description for the AI
          </label>
          <textarea
            value={form.topicDescription}
            onChange={(e) => handleChange("topicDescription", e.target.value)}
            rows={4}
            placeholder="Explain what you want this TaskSet to cover, any key vocabulary, texts, or constraints…"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              resize: "vertical",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={generating}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            background: "#0ea5e9",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {generating ? "Generating…" : "Generate TaskSet"}
        </button>

        {error && (
          <p style={{ marginTop: 8, color: "#b91c1c", fontSize: "0.85rem" }}>
            {error}
          </p>
        )}
      </form>

      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>
            Draft TaskSet
          </h2>
          <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.9rem" }}>
            This is what the server returned. You can refine it on the TaskSets
            page.
          </p>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              borderRadius: 12,
              background: "#111827",
              color: "#e5e7eb",
              fontSize: "0.8rem",
              overflowX: "auto",
              maxHeight: 320,
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
