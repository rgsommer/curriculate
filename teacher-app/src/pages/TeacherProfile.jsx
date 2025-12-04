// teacher-app/src/pages/TeacherProfile.jsx
import React, { useEffect, useState } from "react";
import { fetchMyProfile, updateMyProfile } from "../api/profile";

// Options for perspectives (can grow later)
const PERSPECTIVE_OPTIONS = [
  { value: "christian-biblical", label: "Christian / Biblical" },
  { value: "character-formation", label: "Character / Virtue Formation" },
  { value: "historical-thinking", label: "Historical Thinking" },
  { value: "inquiry-learning", label: "Inquiry-Based Learning" },
  { value: "business-professional", label: "Business / Professional" },
  { value: "leadership-development", label: "Leadership Development" },
  { value: "team-building", label: "Team-Building" },
  { value: "missions-outreach", label: "Missions / Outreach" },
];

const EMPTY_CATEGORY = { key: "", label: "", weight: 0 };

export default function TeacherProfile() {
  const [profile, setProfile] = useState({
    presenterName: "",
    presenterTitle: "",
    email: "",
    schoolName: "",
    defaultStations: 8,
    treatsPerSession: 4,
    perspectives: [],
    assessmentCategories: [EMPTY_CATEGORY],
    includeIndividualReports: false,
    locationOptions: [],

    // Jeopardy defaults
    jeopardyDefaultContestantCount: 3,
    jeopardyDefaultAnswerMode: "buzz-first", // or "all-try"
    jeopardyAllowNegativeScores: true,
    jeopardyAllowRebound: true,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await fetchMyProfile();

        if (cancelled || !data) return;

        const merged = {
          presenterName: data.presenterName || data.name || "",
          presenterTitle: data.presenterTitle || data.title || "",
          email: data.email || "",
          schoolName: data.schoolName || "",
          defaultStations: data.defaultStations || 8,
          treatsPerSession:
            typeof data.treatsPerSession === "number"
              ? data.treatsPerSession
              : 4,
          perspectives: Array.isArray(data.perspectives)
            ? data.perspectives
            : [],
          locationOptions: Array.isArray(data.locationOptions)
            ? data.locationOptions
            : [],
          assessmentCategories:
            Array.isArray(data.assessmentCategories) &&
            data.assessmentCategories.length > 0
              ? data.assessmentCategories
              : [EMPTY_CATEGORY],
          includeIndividualReports:
            typeof data.includeIndividualReports === "boolean"
              ? data.includeIndividualReports
              : !!data.includeStudentReports,

          // Jeopardy defaults (with safe fallbacks)
          jeopardyDefaultContestantCount:
            Number(data.jeopardyDefaultContestantCount) || 3,
          jeopardyDefaultAnswerMode:
            data.jeopardyDefaultAnswerMode || "buzz-first",
          jeopardyAllowNegativeScores:
            typeof data.jeopardyAllowNegativeScores === "boolean"
              ? data.jeopardyAllowNegativeScores
              : true,
          jeopardyAllowRebound:
            typeof data.jeopardyAllowRebound === "boolean"
              ? data.jeopardyAllowRebound
              : true,
        };

        setProfile(merged);
      } catch (err) {
        console.error("Failed to load profile:", err);
        setError("Could not load profile. Please try again.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handlePerspectiveToggle = (value) => {
    setProfile((prev) => {
      const has = prev.perspectives.includes(value);
      return {
        ...prev,
        perspectives: has
          ? prev.perspectives.filter((v) => v !== value)
          : [...prev.perspectives, value],
      };
    });
  };

  const handleCategoryChange = (index, field, value) => {
    setProfile((prev) => {
      const list = [...prev.assessmentCategories];
      list[index] = { ...list[index], [field]: value };
      return { ...prev, assessmentCategories: list };
    });
  };

  const addCategoryRow = () => {
    setProfile((prev) => ({
      ...prev,
      assessmentCategories: [...prev.assessmentCategories, EMPTY_CATEGORY],
    }));
  };

  const removeCategoryRow = (index) => {
    setProfile((prev) => {
      const list = prev.assessmentCategories.filter((_, i) => i !== index);
      return {
        ...prev,
        assessmentCategories: list.length ? list : [EMPTY_CATEGORY],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    setError("");
    setMessage("");
    setSaving(true);

    try {
      const includeReports = !!profile.includeIndividualReports;

      const payload = {
        ...profile,
        locationOptions: Array.isArray(profile.locationOptions)
          ? profile.locationOptions
              .map((s) => s && s.toString().trim())
              .filter((s) => s)
          : [],
        defaultStations: Number(profile.defaultStations) || 8,
        treatsPerSession:
          Number(profile.treatsPerSession ?? 4),
        jeopardyDefaultContestantCount:
          Number(profile.jeopardyDefaultContestantCount) || 3,
        assessmentCategories: profile.assessmentCategories
          .filter((c) => c.key.trim() || c.label.trim())
          .map((c) => ({
            key: c.key.trim(),
            label: c.label.trim(),
            weight: Number(c.weight) || 0,
          })),
        // keep both field names in sync for older views
        includeIndividualReports: includeReports,
        includeStudentReports: includeReports,
        title: profile.presenterTitle,
      };

      const updated = await updateMyProfile(payload);
      setProfile((prev) => ({
        ...prev,
        ...updated,
        presenterTitle:
          updated.presenterTitle || updated.title || prev.presenterTitle,
        includeIndividualReports:
          typeof updated.includeIndividualReports === "boolean"
            ? updated.includeIndividualReports
            : !!updated.includeStudentReports,
      }));
      setMessage("Profile saved.");
    } catch (err) {
      console.error("Failed to save profile:", err);
      setError("Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Presenter Profile</h1>
        <p>Loading your profile…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Presenter Profile</h1>
      <p style={{ marginTop: 0, color: "#4b5563", fontSize: "0.9rem" }}>
        These settings personalize how Curriculate generates tasks, runs
        live sessions, and prepares reports.
      </p>

      <form onSubmit={handleSubmit}>
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Basic info
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
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
                Name
              </label>
              <input
                type="text"
                value={profile.presenterName}
                onChange={(e) =>
                  handleChange("presenterName", e.target.value)
                }
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
                Title / Role
              </label>
              <input
                type="text"
                value={profile.presenterTitle}
                onChange={(e) =>
                  handleChange("presenterTitle", e.target.value)
                }
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
                Contact email
              </label>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => handleChange("email", e.target.value)}
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
                School / Organization
              </label>
              <input
                type="text"
                value={profile.schoolName}
                onChange={(e) => handleChange("schoolName", e.target.value)}
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
                Default number of stations
              </label>
              <input
                type="number"
                min={2}
                max={12}
                value={profile.defaultStations}
                onChange={(e) =>
                  handleChange("defaultStations", e.target.value)
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
        </section>

        {/* Random treats config */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Random Treats
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            Set how many random treats you would like to sprinkle into a
            typical session. Treats will only be issued once at least 30% of
            the tasks in a task set have been completed.
          </p>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 4,
                color: "#4b5563",
              }}
            >
              Number of treats per session
            </label>
            <input
              type="range"
              min={0}
              max={10}
              value={Number(profile.treatsPerSession ?? 4)}
              onChange={(e) =>
                handleChange(
                  "treatsPerSession",
                  Number(e.target.value)
                )
              }
              style={{ width: "100%" }}
            />
            <div
              style={{
                marginTop: 4,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              {Number(profile.treatsPerSession ?? 4) === 0
                ? "No random treats will be issued for this session."
                : `${Number(
                    profile.treatsPerSession ?? 4
                  )} random treat${
                    Number(profile.treatsPerSession ?? 4) === 1 ? "" : "s"
                  } per session (after at least 30% of tasks are completed).`}
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Perspectives
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            Choose the lenses you tend to emphasize. These can guide AI
            suggestions and reporting language.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PERSPECTIVE_OPTIONS.map((p) => {
              const active = profile.perspectives.includes(p.value);
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePerspectiveToggle(p.value)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: active ? "none" : "1px solid #d1d5db",
                    background: active ? "#0ea5e9" : "#f9fafb",
                    color: active ? "#ffffff" : "#111827",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Assessment categories
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            These are used as headings in your reports and can help structure
            how students are evaluated.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {profile.assessmentCategories.map((cat, index) => (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr 90px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  placeholder="Key (e.g., knowledge)"
                  value={cat.key}
                  onChange={(e) =>
                    handleCategoryChange(index, "key", e.target.value)
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                  }}
                />
                <input
                  type="text"
                  placeholder="Label (e.g., Knowledge of content)"
                  value={cat.label}
                  onChange={(e) =>
                    handleCategoryChange(index, "label", e.target.value)
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    placeholder="%"
                    value={cat.weight}
                    onChange={(e) =>
                      handleCategoryChange(index, "weight", e.target.value)
                    }
                    style={{
                      width: 60,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeCategoryRow(index)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#b91c1c",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                    title="Remove category"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCategoryRow}
            style={{
              marginTop: 8,
              border: "none",
              background: "transparent",
              color: "#0ea5e9",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            + Add category
          </button>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Jeopardy defaults
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
            These settings are used when you generate Jeopardy-style boards.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
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
                Default contestant teams
              </label>
              <input
                type="number"
                min={2}
                max={8}
                value={profile.jeopardyDefaultContestantCount}
                onChange={(e) =>
                  handleChange(
                    "jeopardyDefaultContestantCount",
                    e.target.value
                  )
                }
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
                Answer mode
              </label>
              <select
                value={profile.jeopardyDefaultAnswerMode}
                onChange={(e) =>
                  handleChange("jeopardyDefaultAnswerMode", e.target.value)
                }
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                }}
              >
                <option value="buzz-first">Buzz in first</option>
                <option value="all-try">All teams answer</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: "0.85rem" }}>
            <label style={{ display: "block", marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={!!profile.jeopardyAllowNegativeScores}
                onChange={(e) =>
                  handleChange(
                    "jeopardyAllowNegativeScores",
                    e.target.checked
                  )
                }
              />{" "}
              Allow negative scores for wrong answers
            </label>
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={!!profile.jeopardyAllowRebound}
                onChange={(e) =>
                  handleChange("jeopardyAllowRebound", e.target.checked)
                }
              />{" "}
              Allow rebound if a team misses a clue
            </label>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: 12 }}>
            Available Rooms for Scavenger Hunts
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#4b5563",
              marginBottom: 12,
            }}
          >
            These labels appear when you run multi-room scavenger hunts.
            Examples: <code>Classroom</code>, <code>Hallway</code>,{" "}
            <code>Gym</code>, <code>Library</code>.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(profile.locationOptions || []).map((room, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <input
                  type="text"
                  value={room}
                  onChange={(e) => {
                    const newRooms = [...profile.locationOptions];
                    newRooms[idx] = e.target.value;
                    handleChange("locationOptions", newRooms);
                  }}
                  placeholder="e.g. Hallway"
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const newRooms = profile.locationOptions.filter(
                      (_, i) => i !== idx
                    );
                    handleChange("locationOptions", newRooms);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#b91c1c",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              handleChange("locationOptions", [
                ...(profile.locationOptions || []),
                "",
              ])
            }
            style={{
              fontSize: "0.85rem",
              color: "#0ea5e9",
              marginTop: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            + Add Room
          </button>
        </section>

        <div
          style={{
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "none",
              background: "#0ea5e9",
              color: "#ffffff",
              fontSize: "0.95rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
          {message && (
            <span style={{ fontSize: "0.85rem", color: "#16a34a" }}>
              {message}
            </span>
          )}
          {error && (
            <span style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
