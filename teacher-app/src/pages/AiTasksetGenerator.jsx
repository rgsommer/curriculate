// teacher-app/src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from "react";
import { fetchMyProfile } from "../api/profile";
import { generateAiTaskset } from "../api/tasksets";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

export default function AiTasksetGenerator() {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState({
    name: "",
    gradeLevel: "",
    subject: "",
    difficulty: "MEDIUM",
    learningGoal: "REVIEW",
    topicDescription: "",
    numberOfTasks: 8,
    isFixedStation: false,
  });

  const [displays, setDisplays] = useState([]);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // Load presenter profile to prefill grade/subject where possible
  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;
        setProfile(data || null);

        setForm((prev) => {
          let next = { ...prev };
          if (data?.defaultGradeLevel && !next.gradeLevel) {
            next.gradeLevel = data.defaultGradeLevel;
          }
          if (data?.defaultSubject && !next.subject) {
            next.subject = data.defaultSubject;
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
              .filter(
                (d) => d.name || d.stationColor || d.description
              )
          : [];

      const payload = {
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,
        topicDescription: form.topicDescription,
        numberOfTasks: Number(form.numberOfTasks) || 8,
        presenterProfile: profile || undefined,
        // New: give the AI more session context
        tasksetName: form.name || undefined,
        isFixedStationTaskset:
          form.isFixedStation || cleanedDisplays.length > 0,
        displays: cleanedDisplays.length ? cleanedDisplays : undefined,
      };

      const data = await generateAiTaskset(payload);
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
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: 0, marginBottom: 4 }}>AI Task Set Generator</h1>
      <p
        style={{
          margin: 0,
          marginBottom: 12,
          fontSize: "0.85rem",
          color: "#4b5563",
        }}
      >
        Describe the class context and what you want to cover. The AI will
        propose a complete task set you can review and save.
      </p>

      {loadingProfile && (
        <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: 8 }}>
          Loading presenter profile…
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
        {/* Basic context */}
        <div
          style={{
            marginBottom: 12,
          }}
        >
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
        </div>

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
              onChange={(e) =>
                handleChange("gradeLevel", e.target.value)
              }
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
              onChange={(e) =>
                handleChange("difficulty", e.target.value)
              }
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
              onChange={(e) =>
                handleChange("learningGoal", e.target.value)
              }
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
              Number of tasks
            </label>
            <input
              type="number"
              min={4}
              max={24}
              value={form.numberOfTasks}
              onChange={(e) =>
                handleChange("numberOfTasks", e.target.value)
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
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
            manipulatives, etc.) stay in place. The AI can then assign tasks
            that make sense for each station.
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
                        Description / what's here
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
            backgroundColor: generating ? "#9ca3af" : "#2563eb",
            color: "#ffffff",
            fontSize: "0.9rem",
            cursor: generating ? "default" : "pointer",
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
