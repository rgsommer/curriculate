// teacher-app/src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom"; 
import { fetchMyProfile } from "../api/profile";
import { generateAiTaskset } from "../api/tasksets";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];
// ──────────────────────────────────────────────────────────────
// Available task types the teacher can force-include
// ──────────────────────────────────────────────────────────────
const TASK_TYPES = [
  "multiple_choice",
  "open_text",
  "photo_description",
  "scavenger_hunt",
  "jeopardy_game",
  "body_break",
  "sequence",
  "draw",
  "record_audio",
  "sorting",
  "matching",
  "timeline",
  "collaboration",
  "musical-chairs",
  "mystery-clues",
  "true-false-tictactoe",
  "mad-dash-sequence",
  "live-debate",
  "flashcards",
  "brain-spark-notes", 
  "pet-feeding", 
  "motion-mission",
  "brainstorm-battle",
  "mind-mapper",
  "hidenseek",
  "speed-draw",  
];

export default function AiTasksetGenerator() {
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
  // New feature: limit to 1–2 specific task types
  const [limitTasks, setLimitTasks] = useState(false);
  const [selectedTaskTypes, setSelectedTaskTypes] = useState([]);

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

          if ((data?.defaultGradeLevel || data?.defaultGrade) && !next.gradeLevel) {
            next.gradeLevel = data.defaultGradeLevel || data.defaultGrade;
          }
          if (data?.defaultSubject && !next.subject) {
            next.subject = data.defaultSubject;
          } else if (Array.isArray(data?.subjectsTaught) && data.subjectsTaught.length && !next.subject) {
            next.subject = data.subjectsTaught[0];
          }

          if (typeof data?.defaultDurationMinutes === "number" && !prev.durationMinutes) {
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

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

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

      // ————————————————————————————————————————————————
      // Handle "Limit to specific task types" feature
      // ————————————————————————————————————————————————
      let estimatedTaskCount = Math.max(
        4,
        Math.min(20, Math.round(totalDurationMinutes / 5))
      );

      let requiredTaskTypes = [];

      if (limitTasks) {
        if (selectedTaskTypes.length === 0) {
          setError("Please select at least one task type when limiting task types.");
          setGenerating(false);
          return;
        }

        // Allow repeats to fill time: set min tasks to selected.length, max to more
        estimatedTaskCount = Math.max(
          selectedTaskTypes.length,
          Math.min(20, Math.round(totalDurationMinutes / 5))
        );
        requiredTaskTypes = selectedTaskTypes;

        // Append strict instructions to AI prompt
        form.topicDescription = `${form.topicDescription.trim()}\n\nIMPORTANT: Use ONLY these task types: ${selectedTaskTypes.join(", ")}. Repeat types if needed to fill the duration. Do not use any other types.`;
      }

      // Rough task count for planner; AI can still vary internally
      const estimatedTaskCount = Math.max(
        4,
        Math.min(20, Math.round(totalDurationMinutes / 5))
      );

      const payload = {
        // Core planning context
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,
        topicDescription: form.topicDescription,
        presenterProfile: profile || undefined,

        // Time-based control instead of user-facing "number of tasks"
        totalDurationMinutes,
        numberOfTasks: estimatedTaskCount,
        requiredTaskTypes: limitTasks ? requiredTaskTypes : undefined,  // ← saved permanently
        
        // Session / Room context
        tasksetName: form.name || undefined,
        roomLocation: form.roomLocation || "Classroom",
        locationCode: form.roomLocation || "Classroom",

        // Station context
        isFixedStationTaskset:
          form.isFixedStation || cleanedDisplays.length > 0,
        displays: cleanedDisplays.length ? cleanedDisplays : undefined,
      };

      const data = await generateAiTaskset(payload);
      setError("");
      setResult(data);
      navigate('/tasksets');

    } catch (err) {
      console.error("AI Taskset generation error:", err);
      setError(
        err?.message || "Something went wrong while generating the task set."
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>AI Task Set Generator</h1>
      <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.9rem" }}>
        Describe your class context. The AI will design a Task Set that fits
        the room, stations, and time you specify.
      </p>

      {loadingProfile && <p>Loading presenter profile…</p>}

      <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
        {/* Title + Room */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              marginBottom: 2,
              color: "#4b5563",
            }}
          >
            Task set title
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="e.g. Grade 8 – Responsible Stewardship Stations"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              marginBottom: 8,
            }}
          />

          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              marginBottom: 2,
              color: "#4b5563",
            }}
          >
            Room / location (default: Classroom)
          </label>
          <input
            type="text"
            value={form.roomLocation}
            onChange={(e) => handleChange("roomLocation", e.target.value)}
            placeholder="e.g. Classroom, Gym, Library"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
            }}
          />
        </div>

        {/* Core planning parameters */}
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
              Grade / level
            </label>
            <input
              type="text"
              value={form.gradeLevel}
              onChange={(e) => handleChange("gradeLevel", e.target.value)}
              placeholder="e.g. Grade 7, CE8, etc."
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
              Subject / course
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => handleChange("subject", e.target.value)}
              placeholder="e.g. Bible, Geography, Math"
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
                  {d.charAt(0) + d.slice(1).toLowerCase()}
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
                  {g.charAt(0) + g.slice(1).toLowerCase()}
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
              Total duration (minutes)
            </label>
            <input
              type="number"
              min={10}
              max={120}
              value={form.durationMinutes}
              onChange={(e) =>
                handleChange("durationMinutes", e.target.value)
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
            <div
              style={{
                marginTop: 2,
                fontSize: "0.7rem",
                color: "#6b7280",
              }}
            >
              The AI will choose how many tasks fit into this time.
            </div>
          </div>
        </div>

        {/* Fixed-station configuration */}
        <div
          style={{
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            padding: 12,
            marginBottom: 12,
            background: "#f9fafb",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={form.isFixedStation}
              onChange={(e) =>
                handleChange("isFixedStation", e.target.checked)
              }
            />
            This is a fixed-station task set (stations around the room)
          </label>
          <p
            style={{
              margin: 0,
              marginBottom: 6,
              fontSize: "0.75rem",
              color: "#6b7280",
            }}
          >
            Use this if students rotate while stations (equipment, posters,
            manipulatives, etc.) stay in  place. The AI needs to know what each
            station has so it can assign appropriate tasks.
          </p>

          {form.isFixedStation && (
            <div style={{ marginTop: 6 }}>
              {displays.length === 0 && (
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "#6b7280",
                    marginBottom: 6,
                  }}
                >
                  Add a few stations and what each one has available.
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displays.map((d, index) => (
                  <div
                    key={index}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      padding: 8,
                      background: "#ffffff",
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
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                        }}
                      >
                        Station {index + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDisplay(index)}
                        style={{
                          border: "none",
                          background: "transparent",
                          fontSize: "0.7rem",
                          color: "#b91c1c",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(180px, 1fr))",
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
                          Name / label
                        </label>
                        <input
                          type="text"
                          value={d.name || ""}
                          onChange={(e) =>
                            updateDisplay(index, "name", e.target.value)
                          }
                          placeholder="e.g. Red Station, Microscope table"
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
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
                          Station colour (optional)
                        </label>
                        <input
                          type="text"
                          value={d.stationColor || ""}
                          onChange={(e) =>
                            updateDisplay(
                              index,
                              "stationColor",
                              e.target.value
                            )
                          }
                          placeholder="e.g. Red, Blue, etc."
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            fontSize: "0.8rem",
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.75rem",
                          marginBottom: 2,
                        }}
                      >
                        Description / what’s here
                      </label>
                      <textarea
                        value={d.description || ""}
                        onChange={(e) =>
                          updateDisplay(
                            index,
                            "description",
                            e.target.value
                          )
                        }
                        rows={2}
                        placeholder="e.g. Globe + atlases; microscope set; watercolor paints; etc."
                        style={{
                          width: "100%",
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          fontSize: "0.8rem",
                          resize: "vertical",
                        }}
                      />
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
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                + Add station
              </button>
            </div>
          )}
        </div>

        {/* ────────────────────────────────────────────────────── */}
        {/* Limit to specific task types (1+ tasks) */}
        {/* ────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", fontSize: "0.85rem", color: "#4b5563" }}>
            <input
              type="checkbox"
              checked={limitTasks}
              onChange={(e) => {
                setLimitTasks(e.target.checked);
                if (!e.target.checked) {
                  setSelectedTaskTypes([]);
                }
              }}
              style={{ marginRight: 8 }}
            />
            Limit task set to only include specific task types
          </label>
                      {limitTasks && (
            <div
              className="mt-6"
              style={{
                maxHeight: "75vh",
                overflowY: "auto",
                padding: "20px",
                border: "3px solid #6366f1",
                borderRadius: "16px",
                backgroundColor: "#eef2ff",
                boxShadow: "0 10px 25px rgba(99, 102, 241, 0.2)",
              }}
            >
              <p className="text-xl font-bold text-indigo-800 mb-6 text-center">
                Select at least one task type:
              </p>

              <div 
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
              >
                {TASK_TYPES.map((type) => {
                  const isChecked = selectedTaskTypes.includes(type);
                  return (
                    <label
                      key={type}
                      className="flex items-center space-x-4 p-5 bg-white rounded-xl border-2 border-gray-300 hover:border-indigo-500 cursor-pointer transition-all hover:shadow-lg"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSelectedTaskTypes(prev =>
                            isChecked ? prev.filter(t => t !== type) : [...prev, type]
                          );
                        }}
                        className="w-6 h-6 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <span className="text-lg font-medium text-gray-800">
                        {type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </label>
                  );
                })}
              </div>

              {selectedTaskTypes.length === 0 && (
                <p className="mt-8 text-center text-red-600 font-bold text-xl animate-pulse">
                  You must select at least one task type!
                </p>
              )}
            </div>
          )}
        </div>

        {/* Topic description */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              marginBottom: 2,
              color: "#4b5563",
            }}
          >
            Topic / unit focus and any constraints
          </label>
          <textarea
            value={form.topicDescription}
            onChange={(e) =>
              handleChange("topicDescription", e.target.value)
            }
            rows={4}
            placeholder="Explain what you want this TaskSet to cover, key texts, vocabulary, or constraints…"
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
                  disabled={generating || (limitTasks && selectedTaskTypes.length === 0)}
                  style={{
                    padding: "12px 24px",
                    borderRadius: 999,
                    border: "none",
                    backgroundColor: 
                      generating || (limitTasks && selectedTaskTypes.length === 0)
                        ? "#9ca3af"
                        : "#2563eb",
                    color: "#ffffff",
                    fontSize: "1.1rem",
                    fontWeight: "bold",
                    cursor: generating || (limitTasks && selectedTaskTypes.length === 0) ? "not-allowed" : "pointer",
                    opacity: generating || (limitTasks && selectedTaskTypes.length === 0) ? 0.6 : 1,
                    transition: "all 0.3s ease",
                  }}
                >
                  {generating ? "Generating task set…" : "Generate task set"}
                </button>
      </form>

      {error && (
        <p
          style={{
            marginTop: 12,
            fontSize: "0.8rem",
            color: "#b91c1c",
          }}
        >
          {error}
        </p>
      )}
  
      {result && (
        <div className="mt-8 p-8 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl text-white">
          <h2 className="text-4xl font-bold mb-6 text-center">Task Set Created!</h2>
          
          {/* HideNSeek Clue Popup */}
          {result.taskset.tasks.some(t => t.type === "hidenseek") && (
            <div className="mt-8 bg-white/20 backdrop-blur-lg rounded-2xl p-8 border-4 border-white/50">
              <h3 className="text-3xl font-bold mb-6 text-yellow-300">
                HideNSeek Task Detected!
              </h3>
              {result.taskset.tasks
                .filter(t => t.type === "hidenseek")
                .map((task, i) => (
                  <div key={i} className="mb-6">
                    <p className="text-2xl mb-4">
                      Task {task.order || i + 1}: HideNSeek
                    </p>
                    <input
                      type="text"
                      placeholder="e.g. Page 72, Figure 4 | The globe by the window"
                      defaultValue={task.clue || ""}
                      onChange={(e) => {
                        // Save to result so it's persistent
                        result.taskset.tasks.find(t => t === task).clue = e.target.value;
                      }}
                      className="w-full p-6 text-3xl rounded-2xl text-black font-medium"
                    />
                  </div>
                ))}
              <p className="text-xl mt-6 opacity-90">
                This clue will be saved with your taskset.
              </p>
            </div>
          )}

          {/* Rest of success UI */}
          <p className="text-3xl text-center mt-8">
            "{result.taskset.name}" is ready!
          </p>
          <div className="flex justify-center gap-8 mt-8">
            <button onClick={() => navigate('/tasksets')} 
              className="px-12 py-6 bg-white text-indigo-600 rounded-2xl text-3xl font-bold hover:bg-gray-100">
              View Task Sets
            </button>
          </div>
        </div>
      )}
      
      {result && (
        <div className="mt-4 p-4 border rounded bg-green-50">
          <h2 className="text-lg font-bold">Task Set Created!</h2>
          <p>
            "{result.taskset.name}" with <strong>{result.taskset.tasks.length}</strong> task{result.taskset.tasks.length !== 1 ? "s" : ""} for {result.taskset.durationMinutes} minutes
            {limitTasks && selectedTaskTypes.length > 0 && (
              <>
                {" "}— using only: <strong>{selectedTaskTypes.map(t => t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ")}</strong>
              </>
            )}
            .
          </p>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem", color: "#059669" }}>
            Can be found in Task Sets
          </p>
          <div className="mt-4 p-4 border rounded bg-green-50">
          <h2 className="text-lg font-bold">Task Set Created!</h2>
          <p>
            "{result.taskset.name}" with <strong>{result.taskset.tasks.length}</strong> task{result.taskset.tasks.length !== 1 ? "s" : ""} for {result.taskset.durationMinutes} minutes
            {limitTasks && selectedTaskTypes.length > 0 && (
              <> — using only: <strong>{selectedTaskTypes.map(t => t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ")}</strong></>
            )}
            .
          </p>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem", color: "#059669" }}>
            Can be found in Task Sets
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => navigate('/tasksets')}
              className="px-5 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-medium"
            >
              View in Task Sets →
            </button>
            <button
              onClick={() => {
                setResult(null);
                setGenerating(false);
                setError("");
                // Scroll to top so they see the form again
                window.scrollTo(0, 0);
              }}
              className="px-5 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition font-medium"
            >
              Regenerate with Same Settings
            </button>
          </div>
        </div>
        
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f3f4f6",
          }}
        >
          <h2
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontSize: "0.95rem",
            }}
          >
            AI task set preview (raw)
          </h2>
          <pre
            style={{
              margin: 0,
              background: "#111827",
              color: "#e5e7eb",
              fontSize: "0.8rem",
              overflowX: "auto",
              maxHeight: 320,
              padding: 8,
              borderRadius: 8,
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
