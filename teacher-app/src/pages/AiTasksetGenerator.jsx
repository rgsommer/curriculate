// teacher-app/src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchMyProfile } from "../api/profile";
import {
  AI_ELIGIBLE_TASK_TYPES,
  TASK_TYPE_META,
} from "../../../shared/taskTypes.js";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

// Task types the teacher can force-include (AI-eligible only, canonical ids)
const LIMITABLE_TASK_TYPES = AI_ELIGIBLE_TASK_TYPES || [];

export default function AiTasksetGenerator() {
  const navigate = useNavigate();
  const location = useLocation();

  // If we arrived here from "Create new task set with unused words"
  const prefillWordList = location.state?.prefillWordList || [];
  const prefillWordText = prefillWordList.length
    ? prefillWordList.join("\n")
    : "";

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState({
    name: "",
    roomLocation: "Classroom",
    gradeLevel: "",
    subject: "",
    difficulty: "MEDIUM",
    learningGoal: "REVIEW",
    topicDescription: "",
    durationMinutes: 45,
    isFixedStation: false,
  });

  const [displays, setDisplays] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // Limit to specific task types
  const [limitTasks, setLimitTasks] = useState(false);
  const [selectedTaskTypes, setSelectedTaskTypes] = useState([]);

  // Vocabulary / key terms
  const [wordListText, setWordListText] = useState(prefillWordText);

  // Load presenter profile to prefill defaults
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;

        setProfile(data || null);

        setForm((prev) => {
          const next = { ...prev };

          if (
            (data?.defaultGradeLevel || data?.defaultGrade) &&
            !next.gradeLevel
          ) {
            next.gradeLevel = data.defaultGradeLevel || data.defaultGrade;
          }
          if (data?.defaultSubject && !next.subject) {
            next.subject = data.defaultSubject;
          } else if (
            Array.isArray(data?.subjectsTaught) &&
            data.subjectsTaught.length &&
            !next.subject
          ) {
            next.subject = data.subjectsTaught[0];
          }

          if (
            typeof data?.defaultDurationMinutes === "number" &&
            !prev.durationMinutes
          ) {
            next.durationMinutes = data.defaultDurationMinutes;
          }

          if (data?.defaultRoomLabel && !prev.roomLocation) {
            next.roomLocation = data.defaultRoomLabel;
          }

          return next;
        });
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
  }, []);

  const handleChange = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addDisplay = () => {
    setDisplays((prev) => [
      ...prev,
      { name: "", stationColor: "", description: "" },
    ]);
  };

  const updateDisplay = (index, field, value) => {
    setDisplays((prev) => {
      const copy = [...prev];
      copy[index] = { ...(copy[index] || {}), [field]: value };
      return copy;
    });
  };

  const removeDisplay = (index) => {
    setDisplays((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleTaskType = (type) => {
    setSelectedTaskTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (generating) return;

    setError("");
    setResult(null);
    setGenerating(true);

    if (!form.name.trim()) {
      setError("Task set name is required.");
      setGenerating(false);
      return;
    }

    try {
      // Clean up displays if fixed-station
      const cleanedDisplays =
        form.isFixedStation || displays.length
          ? displays
              .map((d) => ({
                name: (d.name || "").trim(),
                stationColor: (d.stationColor || "").trim(),
                description: (d.description || "").trim(),
              }))
              .filter((d) => d.name || d.stationColor || d.description)
          : [];

      const duration = Number(form.durationMinutes);
      const totalDurationMinutes =
        Number.isFinite(duration) && duration > 0 ? duration : 45;

      // Base task count estimate
      let estimatedTaskCount = Math.max(
        4,
        Math.min(20, Math.round(totalDurationMinutes / 5))
      );

      let requiredTaskTypes = [];
      let topicDescriptionForAi = (form.topicDescription || "").trim();

      // Limit to specific task types
      if (limitTasks) {
        if (selectedTaskTypes.length === 0) {
          setError(
            "Please select at least one task type when limiting task types."
          );
          setGenerating(false);
          return;
        }

        estimatedTaskCount = Math.max(
          selectedTaskTypes.length,
          Math.min(20, Math.round(totalDurationMinutes / 5))
        );
        requiredTaskTypes = selectedTaskTypes;

        topicDescriptionForAi = `${topicDescriptionForAi}\n\nIMPORTANT: Use ONLY these task types: ${selectedTaskTypes.join(
          ", "
        )}. Repeat types if needed to fill the duration. Do not use any other types.`;
      }

      // Presenter profile lenses
      const curriculumLenses =
        (profile &&
          (profile.curriculumLenses || profile.perspectives)) ||
        [];

      // Turn the text area into an array of words/terms
      const aiWordBank = wordListText
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);

      const payload = {
        // Core planning context
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,
        topicDescription: topicDescriptionForAi,
        presenterProfile: { curriculumLenses },

        // Word bank for “used vs not used” tracking
        aiWordBank,

        // Time-based control
        totalDurationMinutes,
        numberOfTasks: estimatedTaskCount,
        requiredTaskTypes: limitTasks ? requiredTaskTypes : undefined,

        // Session / Room context
        tasksetName: form.name || undefined,
        roomLocation: form.roomLocation || "Classroom",
        locationCode: form.roomLocation || "Classroom",

        // Station context
        isFixedStationTaskset:
          form.isFixedStation || cleanedDisplays.length > 0,
        displays: cleanedDisplays.length ? cleanedDisplays : undefined,
      };

      // -----------------------------
      // Direct API call with auth
      // -----------------------------
      const apiBase =
        import.meta.env.VITE_API_BASE_URL ||
        import.meta.env.VITE_API_URL ||
        "";

      const url = apiBase
        ? `${apiBase.replace(/\/$/, "")}/api/ai/tasksets`
        : "/api/ai/tasksets";

      const token =
        localStorage.getItem("authToken") ||
        localStorage.getItem("token") ||
        "";

      const headers = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let msg = `Request failed (${resp.status})`;
        try {
          const body = await resp.json();
          if (body?.message) msg = body.message;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(msg);
      }

      const data = await resp.json();
      setError("");
      setResult(data);
    } catch (err) {
      console.error("AI Taskset generation error:", err);
      setError(
        err?.message ||
          "Something went wrong while generating the task set."
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>AI Task Set Generator</h1>
      <p style={{ marginTop: 0, color: "#4b5563", fontSize: "0.95rem" }}>
        Describe your class and topic, and let the AI build a station-based
        task set for you. You can optionally constrain which task types it
        uses.
      </p>

      {loadingProfile && (
        <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
          Loading your presenter profile…
        </p>
      )}

      {error && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 10px",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 24 }}>
        {/* Left column: core details */}
        <div style={{ flex: 2, minWidth: 0 }}>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}
            >
              Task set name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Grade level
              </label>
              <input
                type="text"
                value={form.gradeLevel}
                onChange={(e) => handleChange("gradeLevel", e.target.value)}
                placeholder="e.g., 7, 8, 7/8"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Subject
              </label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => handleChange("subject", e.target.value)}
                placeholder="e.g., Geography, Bible, Math"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Difficulty
              </label>
              <select
                value={form.difficulty}
                onChange={(e) => handleChange("difficulty", e.target.value)}
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                  background: "#ffffff",
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
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Learning goal
              </label>
              <select
                value={form.learningGoal}
                onChange={(e) =>
                  handleChange("learningGoal", e.target.value)
                }
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                  background: "#ffffff",
                }}
              >
                {LEARNING_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label
              style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}
            >
              Topic / unit description
            </label>
            <textarea
              value={form.topicDescription}
              onChange={(e) =>
                handleChange("topicDescription", e.target.value)
              }
              rows={5}
              placeholder="Summarize what your students are learning and any important constraints (e.g., 'Stations must be mostly quiet', 'We have limited space', 'They just did a test and need lighter tasks')."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
                resize: "vertical",
              }}
            />
          </div>

          {/* Vocabulary / key terms */}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}
            >
              Vocabulary / key terms (optional)
            </label>
            <textarea
              value={wordListText}
              onChange={(e) => setWordListText(e.target.value)}
              rows={4}
              placeholder={
                "One term per line or separated by commas, e.g.\nConfederation\nProvince\nTreaty of Paris"
              }
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
                resize: "vertical",
              }}
            />
            <p
              style={{
                marginTop: 4,
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              These words will be tracked as “used” vs “not yet used” when the
              AI builds your task set, so you can quickly make a second set
              with the leftovers.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Total duration (minutes)
              </label>
              <input
                type="number"
                min={10}
                max={180}
                value={form.durationMinutes}
                onChange={(e) =>
                  handleChange("durationMinutes", Number(e.target.value))
                }
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Room / location label
              </label>
              <input
                type="text"
                value={form.roomLocation}
                onChange={(e) =>
                  handleChange("roomLocation", e.target.value)
                }
                placeholder="e.g., Classroom, Library, Gym"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.85rem",
              }}
            >
              <input
                type="checkbox"
                checked={form.isFixedStation}
                onChange={(e) =>
                  handleChange("isFixedStation", e.target.checked)
                }
              />
              Fixed station layout (each station has a dedicated display /
              equipment)
            </label>
          </div>

          <button
            type="submit"
            disabled={generating}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "none",
              background: "#0ea5e9",
              color: "#ffffff",
              fontSize: "0.9rem",
              cursor: generating ? "wait" : "pointer",
              opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? "Generating task set…" : "Generate task set"}
          </button>
        </div>

        {/* Right column: displays + task-type limiting */}
        <div style={{ flex: 1.4, minWidth: 0 }}>
          {/* Displays / station layout */}
          <div
            style={{
              marginBottom: 16,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              padding: 10,
              background: "#ffffff",
            }}
          >
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Displays / stations (optional)
            </div>
            <p
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              If you have named stations or specific screen locations, list
              them here so the AI can map tasks to physical spots.
            </p>
            {displays.length === 0 && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#9ca3af",
                  margin: 0,
                }}
              >
                No displays added yet.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {displays.map((d, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    padding: 8,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) =>
                        updateDisplay(i, "name", e.target.value)
                      }
                      placeholder="Station name (e.g., Red, Bible, Quiet corner)"
                      style={{
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                    <input
                      type="text"
                      value={d.stationColor}
                      onChange={(e) =>
                        updateDisplay(i, "stationColor", e.target.value)
                      }
                      placeholder="Colour or marker (e.g., red, blue)"
                      style={{
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                  <textarea
                    value={d.description}
                    onChange={(e) =>
                      updateDisplay(i, "description", e.target.value)
                    }
                    placeholder="Equipment or constraints (e.g., 'Chromebook station', 'quiet reading zone', 'hands-on area')."
                    rows={2}
                    style={{
                      width: "100%",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      padding: 6,
                      fontSize: "0.8rem",
                    }}
                  />
                  <div style={{ marginTop: 4, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => removeDisplay(i)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#b91c1c",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDisplay}
              style={{
                marginTop: 8,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px dashed #9ca3af",
                background: "transparent",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              + Add display / station
            </button>
          </div>

          {/* Task-type limiting */}
          <div
            style={{
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              padding: 10,
              background: "#ffffff",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.85rem",
                marginBottom: 6,
              }}
            >
              <input
                type="checkbox"
                checked={limitTasks}
                onChange={(e) => setLimitTasks(e.target.checked)}
              />
              Limit to specific task types
            </label>
            <p
              style={{
                marginTop: 0,
                marginBottom: 6,
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              If enabled, the AI will only use the types you pick and will
              repeat them as needed to fill the time.
            </p>
            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                padding: 6,
                background: "#f9fafb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  fontSize: "0.8rem",
                }}
              >
                {LIMITABLE_TASK_TYPES.map((type) => {
                  const active = selectedTaskTypes.includes(type);
                  const label =
                    TASK_TYPE_META[type]?.label ||
                    type.replace(/-/g, " ");

                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleTaskType(type)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: active
                          ? "1px solid #0ea5e9"
                          : "1px solid #d1d5db",
                        background: active ? "#e0f2fe" : "#ffffff",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Result preview */}
      {result && (
        <div
          style={{
            marginTop: 24,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            padding: 12,
            background: "#ffffff",
          }}
        >
          <h2
            style={{
              marginTop: 0,
              fontSize: "1rem",
              marginBottom: 8,
            }}
          >
            Generated task set
          </h2>
          <p
            style={{
              marginTop: 0,
              fontSize: "0.85rem",
              color: "#6b7280",
            }}
          >
            The task set has been generated. You can review and edit it on the
            Task Sets page.
          </p>
          {result.tasksetId && (
            <button
              type="button"
              onClick={() => navigate(`/tasksets/${result.tasksetId}`)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                background: "#10b981",
                color: "#ffffff",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Open generated task set
            </button>
          )}
        </div>
      )}
    </div>
  );
}
