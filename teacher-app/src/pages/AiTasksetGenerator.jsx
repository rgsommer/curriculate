// teacher-app/src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchMyProfile } from "../api/profile";
import {
  TASK_TYPES,
  TASK_TYPE_META,
} from "../../../shared/taskTypes.js";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

// AI-eligible types (same filter as backend)
const AI_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented !== false && meta.aiEligible !== false)
  .map(([type]) => type);

export default function AiTasksetGenerator() {
  const navigate = useNavigate();
  const location = useLocation();

  const prefillWordListFromState =
    location.state && Array.isArray(location.state.prefillWordList)
      ? location.state.prefillWordList
      : null;

  const prefillWordText = prefillWordListFromState
    ? prefillWordListFromState.join("\n")
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
    topicDescription: "", // "Special considerations"
    durationMinutes: 45,
    isFixedStation: false,
    isMultiRoomScavenger: false, // NEW
  });

  const [displays, setDisplays] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [limitTasks, setLimitTasks] = useState(false);
  const [selectedTaskTypes, setSelectedTaskTypes] = useState([]);

  // Vocabulary / key terms (REQUIRED)
  const [wordListText, setWordListText] = useState(prefillWordText);

  // NEW: multi-room list as text (one per line or comma-separated)
  const [multiRoomText, setMultiRoomText] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;
        setProfile(data || null);

        const defaultGrade =
          (data && (data.defaultGradeLevel || data.gradeLevel)) || "";
        const defaultSubject =
          (data && (data.defaultSubject || data.subject)) || "";

        setForm((prev) => ({
          ...prev,
          gradeLevel: prev.gradeLevel || defaultGrade,
          subject: prev.subject || defaultSubject,
          roomLocation: prev.roomLocation || data?.defaultRoomLocation || "Classroom",
        }));
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

  const toggleTaskType = (type) => {
    setSelectedTaskTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

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
      copy[index] = { ...(copy[index] || {}), [field]: value };
      return copy;
    });
  };

  const removeDisplay = (index) => {
    setDisplays((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (generating) return;

    setError("");
    setResult(null);
    setGenerating(true);

    if (!form.name.trim()) {
      setError("Task set title is required.");
      setGenerating(false);
      return;
    }

    // Word bank
    const aiWordBank = wordListText
      .split(/[\n,;]+/)
      .map((w) => w.trim())
      .filter(Boolean);

    if (!aiWordBank.length) {
      setError(
        "Please provide at least one vocabulary term or key word. The AI uses these to stay on topic."
      );
      setGenerating(false);
      return;
    }

    // Multi-room rooms
    let multiRoomRooms = [];
    if (form.isMultiRoomScavenger) {
      multiRoomRooms = multiRoomText
        .split(/[\n,;]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      if (!multiRoomRooms.length) {
        setError(
          "For a multi-room scavenger hunt, please list at least one room/location."
        );
        setGenerating(false);
        return;
      }
    }

    try {
      // Clean displays if using fixed-station mode
      let cleanedDisplays = displays;
      if (!form.isFixedStation) {
        cleanedDisplays = [];
      } else {
        cleanedDisplays = (displays || []).filter(
          (d) => d && (d.name || d.description || d.stationColor)
        );
      }

      const totalDurationMinutes =
        Number.isFinite(form.durationMinutes) && form.durationMinutes > 0
          ? form.durationMinutes
          : 45;

      // Base task count estimate
      let estimatedTaskCount = Math.max(
        4,
        Math.min(20, Math.round(totalDurationMinutes / 5))
      );

      let requiredTaskTypes = [];
      const specialConsiderations = (form.topicDescription || "").trim();

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
      }

      const curriculumLenses =
        (profile &&
          (profile.curriculumLenses || profile.perspectives)) ||
        [];

      const payload = {
        // Core planning context
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,

        // Title = main topic; textarea = special considerations
        topicTitle: form.name.trim(),
        topicDescription: specialConsiderations,
        presenterProfile: { curriculumLenses },

        // Vocab (required)
        aiWordBank,

        // Time + approximate task count
        totalDurationMinutes,
        numberOfTasks: estimatedTaskCount,
        requiredTaskTypes: limitTasks ? requiredTaskTypes : undefined,

        // Base location
        tasksetName: form.name || undefined,
        roomLocation: form.roomLocation || "Classroom",
        locationCode: form.roomLocation || "Classroom",

        // Fixed-station
        isFixedStationTaskset:
          form.isFixedStation || cleanedDisplays.length > 0,
        displays: cleanedDisplays.length ? cleanedDisplays : undefined,

        // NEW: multi-room scavenger hunt behaviour
        multiRoomScavenger: form.isMultiRoomScavenger,
        multiRoomRooms,
      };

      const token = localStorage.getItem("token");
      const resp = await fetch("/api/ai/tasksets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let msg = `AI generation failed (status ${resp.status})`;
        try {
          const body = await resp.json();
          if (body?.error) msg = body.error;
          if (body?.message) msg = body.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const data = await resp.json();
      setError("");
      setResult(data);
    } catch (err) {
      console.error("AI Taskset generation error:", err);
      setError(
        err?.message || "Something went wrong while generating the task set."
      );
    } finally {
      setGenerating(false);
    }
  };

  const renderTaskTypeBadge = (type) => {
    const meta = TASK_TYPE_META[type] || {};
    const label = meta.label || type;
    const category = meta.category || "other";

    return (
      <button
        key={type}
        type="button"
        onClick={() => toggleTaskType(type)}
        style={{
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: "0.8rem",
          border: selectedTaskTypes.includes(type)
            ? "1px solid #2563eb"
            : "1px solid #d1d5db",
          background: selectedTaskTypes.includes(type)
            ? "rgba(37,99,235,0.08)"
            : "#ffffff",
          color: "#111827",
          cursor: "pointer",
        }}
      >
        {label}{" "}
        <span
          style={{
            fontSize: "0.7rem",
            color: "#6b7280",
            textTransform: "capitalize",
          }}
        >
          · {category}
        </span>
      </button>
    );
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>AI Task Set Generator</h1>
      <p style={{ marginTop: 0, color: "#4b5563", fontSize: "0.95rem" }}>
        Give the AI your topic, vocabulary list, and any special
        considerations. It will build a station-based task set that stays on
        that exact content.
      </p>

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

      <form onSubmit={handleSubmit}>
        {/* TOP ROW: title + base room */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.5fr)",
            gap: 16,
            marginBottom: 16,
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
              Task set title (topic)
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Hist7 Ch3: The Seven Years' War and the Conquest of New France"
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.95rem",
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
              Default room / location
            </label>
            <input
              type="text"
              value={form.roomLocation}
              onChange={(e) => handleChange("roomLocation", e.target.value)}
              placeholder="Classroom, Gym, Hallway..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />
            {/* Multi-room switch */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 6,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.isMultiRoomScavenger}
                onChange={(e) =>
                  handleChange("isMultiRoomScavenger", e.target.checked)
                }
              />
              <span>Multi-room scavenger hunt</span>
            </label>
            <p
              style={{
                marginTop: 2,
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              Leave unchecked if the whole activity stays in one room. When
              checked, you can specify multiple locations (e.g., Classroom,
              Hallway, Library) for a multi-room scavenger hunt.
            </p>
          </div>
        </div>

        {/* SECOND ROW: grade, subject, difficulty, goal */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
              placeholder="7, 8, 7/8 split..."
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
              placeholder="History, Geography, Bible..."
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
              }}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d.charAt(0) + d.slice(1).toLowerCase()}
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
              onChange={(e) => handleChange("learningGoal", e.target.value)}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            >
              {LEARNING_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g.charAt(0) + g.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* TIME + CONSIDERATIONS + VOCAB + MULTI-ROOM ROOM LIST */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.3fr)",
            gap: 16,
            marginBottom: 16,
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
              Approx lesson duration (minutes)
            </label>
            <input
              type="number"
              min={5}
              max={120}
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

            <div style={{ height: 8 }} />

            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                marginBottom: 4,
              }}
            >
              Special considerations (optional)
            </label>
            <textarea
              value={form.topicDescription}
              onChange={(e) =>
                handleChange("topicDescription", e.target.value)
              }
              rows={5}
              placeholder="e.g., 'Reviewing for a test', 'Keep it low-noise', 'They just did a quiz—keep it lighter'..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
                resize: "vertical",
              }}
            />

            {/* Multi-room list text area - only when enabled */}
            {form.isMultiRoomScavenger && (
              <div style={{ marginTop: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    marginBottom: 4,
                  }}
                >
                  Rooms / locations for this scavenger hunt
                </label>
                <textarea
                  value={multiRoomText}
                  onChange={(e) => setMultiRoomText(e.target.value)}
                  rows={4}
                  placeholder={
                    "One per line or separated by commas, e.g.\nClassroom\nHallway\nLibrary\nGym"
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
                  These rooms are *options* for where stations might be
                  located. LiveSession can later decide which of these are
                  active for a particular run.
                </p>
              </div>
            )}
          </div>

          {/* Vocabulary / key terms */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                marginBottom: 4,
              }}
            >
              Vocabulary / key terms <span style={{ color: "#b91c1c" }}>*</span>
            </label>
            <textarea
              value={wordListText}
              onChange={(e) => setWordListText(e.target.value)}
              rows={8}
              placeholder={
                "One term per line or separated by commas, e.g.\nLouisbourg\nPlains of Abraham\nTreaty of Paris\nSeven Years' War"
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
              These words define the topic. The AI is required to stay within
              them, and we’ll track which ones are “used” vs “not yet used”
              so you can quickly generate a second set with the leftovers.
            </p>
          </div>
        </div>

        {/* LIMIT TASK TYPES */}
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={limitTasks}
              onChange={(e) => setLimitTasks(e.target.checked)}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Limit which task types the AI can use
            </span>
          </label>
          {limitTasks && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {AI_ELIGIBLE_TYPES.map(renderTaskTypeBadge)}
            </div>
          )}
        </div>

        {/* FIXED-STATION / DISPLAYS */}
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.isFixedStation}
              onChange={(e) =>
                handleChange("isFixedStation", e.target.checked)
              }
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Attach this task set to specific displays / stations
            </span>
          </label>

          {form.isFixedStation && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={addDisplay}
                style={{
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: "0.8rem",
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                + Add display
              </button>

              {displays.map((d, index) => (
                <div
                  key={d.key}
                  style={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    padding: 8,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 500,
                      }}
                    >
                      Display {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDisplay(index)}
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

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 6,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          marginBottom: 2,
                        }}
                      >
                        Name
                      </label>
                      <input
                        type="text"
                        value={d.name || ""}
                        onChange={(e) =>
                          updateDisplay(index, "name", e.target.value)
                        }
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          marginBottom: 2,
                        }}
                      >
                        Station color
                      </label>
                      <input
                        type="text"
                        value={d.stationColor || ""}
                        onChange={(e) =>
                          updateDisplay(index, "stationColor", e.target.value)
                        }
                        placeholder="red, blue..."
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          marginBottom: 2,
                        }}
                      >
                        Notes for you
                      </label>
                      <input
                        type="text"
                        value={d.notesForTeacher || ""}
                        onChange={(e) =>
                          updateDisplay(
                            index,
                            "notesForTeacher",
                            e.target.value
                          )
                        }
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button
            type="button"
            onClick={() => navigate("/tasksets")}
            style={{
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: "0.85rem",
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generating}
            style={{
              borderRadius: 999,
              padding: "6px 16px",
              fontSize: "0.9rem",
              border: "1px solid #2563eb",
              background: generating ? "#93c5fd" : "#2563eb",
              color: "#ffffff",
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "Generating…" : "Generate task set"}
          </button>
        </div>
      </form>

      {result && result.taskset && (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#ecfdf5",
            fontSize: "0.9rem",
          }}
        >
          <div style={{ marginBottom: 6 }}>
            ✅ Task set <strong>{result.taskset.name}</strong> created.
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/tasksets/${result.tasksetId || result.taskset._id}`)
            }
            style={{
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: "0.85rem",
              border: "1px solid #16a34a",
              background: "#16a34a",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Open task set
          </button>
        </div>
      )}
    </div>
  );
}
