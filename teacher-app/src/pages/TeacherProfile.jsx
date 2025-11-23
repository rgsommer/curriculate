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
    perspectives: [],
    assessmentCategories: [EMPTY_CATEGORY],
    includeIndividualReports: false,
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
          perspectives: Array.isArray(data.perspectives)
            ? data.perspectives
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
        };

        setProfile(merged);
      } catch (err) {
        console.error("Failed to load profile:", err);
        setError("Could not load presenter profile.");
      } finally {
        if (!cancelled) setLoading(false);
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
        defaultStations: Number(profile.defaultStations) || 8,
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
        presenterTitle: updated.presenterTitle || updated.title || prev.presenterTitle,
        includeIndividualReports:
          typeof updated.includeIndividualReports === "boolean"
            ? updated.includeIndividualReports
            : !!updated.includeStudentReports,
      }));
      setMessage("Profile saved.");
    } catch (err) {
      console.error("Failed to save profile:", err);
      setError("Could not save presenter profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>Loading presenter profile…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 900,
        margin: "0 auto",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Presenter Profile</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        These details personalize your sessions, reports, and AI suggestions.
      </p>

      <form onSubmit={handleSubmit}>
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Basics</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
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
                onChange={(e) => handleChange("presenterName", e.target.value)}
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
                onChange={(e) => handleChange("presenterTitle", e.target.value)}
                placeholder="Teacher, Pastor, Facilitator…"
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
                Email
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
                    color: active ? "#fff" : "#374151",
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
            Optional: define categories (e.g., Knowledge, Collaboration,
            Communication) and weights used in AI summaries and reports.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                    fontSize: "0.8rem",
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
                    fontSize: "0.8rem",
                  }}
                />
                <input
                  type="number"
                  placeholder="%"
                  value={cat.weight}
                  onChange={(e) =>
                    handleCategoryChange(index, "weight", e.target.value)
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: "0.8rem",
                    width: "100%",
                  }}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCategoryRow}
            style={{
              marginTop: 8,
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px dashed #d1d5db",
              background: "#f9fafb",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            + Add category
          </button>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Reporting options
          </h2>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.9rem",
              color: "#374151",
            }}
          >
            <input
              type="checkbox"
              checked={profile.includeIndividualReports}
              onChange={(e) =>
                handleChange("includeIndividualReports", e.target.checked)
              }
            />
            Include individual student reports with class transcript
          </label>
        </section>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "none",
              background: "#0ea5e9",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.9rem",
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
