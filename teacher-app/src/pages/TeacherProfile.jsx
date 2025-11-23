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

const emptyCategory = () => ({
  key: "",
  label: "",
  weight: 25,
});

export default function TeacherProfile() {
  const [profile, setProfile] = useState({
    presenterName: "",
    email: "",
    schoolName: "",
    presenterTitle: "",
    defaultRoomLabel: "Classroom",
    defaultStations: 8,
    includeIndividualReports: false, // unified field name
    assessmentCategories: [
      emptyCategory(),
      emptyCategory(),
      emptyCategory(),
      emptyCategory(),
    ],
    perspectives: [],
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ------------------------
  // Load profile on mount
  // ------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchMyProfile(); // calls /api/profile via src/api/profile.js

        if (!cancelled) {
          const cats = Array.isArray(data.assessmentCategories)
            ? data.assessmentCategories
            : [];

          // Prefer includeIndividualReports but fall back to any older includeStudentReports flag
          const includeReports =
            typeof data.includeIndividualReports === "boolean"
              ? data.includeIndividualReports
              : !!data.includeStudentReports;

          setProfile({
            presenterName: data.presenterName || "",
            email: data.email || "",
            schoolName: data.schoolName || "",
            presenterTitle: data.presenterTitle || data.title || "",
            defaultRoomLabel: data.defaultRoomLabel || "Classroom",
            defaultStations: data.defaultStations || 8,
            includeIndividualReports: includeReports,
            assessmentCategories: [
              ...cats,
              ...Array(Math.max(0, 4 - cats.length))
                .fill(0)
                .map(() => emptyCategory()),
            ].slice(0, 4),
            perspectives: Array.isArray(data.perspectives)
              ? data.perspectives
              : [],
          });
        }
      } catch (err) {
        console.error("Load presenter profile error", err);
        if (!cancelled) {
          setError("Could not load presenter profile.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------
  // Save profile
  // ------------------------
  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const includeReports = !!profile.includeIndividualReports;

      const payload = {
        ...profile,
        // Normalize numeric + structured fields
        defaultStations: Number(profile.defaultStations) || 8,
        assessmentCategories: profile.assessmentCategories
          .filter((c) => c.key.trim() || c.label.trim())
          .map((c) => ({
            key: c.key.trim(),
            label: c.label.trim(),
            weight: Number(c.weight) || 0,
          })),

        // Make sure both field names are sent, so backend / other views stay in sync
        includeIndividualReports: includeReports,
        includeStudentReports: includeReports,

        // Some backends might expect "title" instead of "presenterTitle"
        title: profile.presenterTitle,
      };

      await updateMyProfile(payload); // PUT /api/profile
    } catch (err) {
      console.error("Save presenter profile error", err);
      setError("Could not save presenter profile.");
    } finally {
      setSaving(false);
    }
  }

  // ------------------------
  // Helpers for form updates
  // ------------------------
  function updateField(field, value) {
    setProfile((prev) => ({ ...prev, [field]: value }));
  }

  function togglePerspective(value) {
    setProfile((prev) => {
      const has = prev.perspectives.includes(value);
      return {
        ...prev,
        perspectives: has
          ? prev.perspectives.filter((v) => v !== value)
          : [...prev.perspectives, value],
      };
    });
  }

  function updateCategory(index, field, value) {
    setProfile((prev) => {
      const next = [...prev.assessmentCategories];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, assessmentCategories: next };
    });
  }

  // ------------------------
  // Render
  // ------------------------
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>Presenter Profile</h1>
      <p style={{ marginTop: 0, marginBottom: 16, color: "#4b5563" }}>
        Tell Curriculate a little about who you are and how you want sessions
        to be framed. This helps with reports, AI summaries, and student
        handouts.
      </p>

      {loading && <p>Loading presenter profile…</p>}

      {error && (
        <p style={{ color: "#b91c1c", fontSize: "0.9rem" }}>{error}</p>
      )}

      {/* Basic presenter info */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Who is presenting?</h2>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>Name</label>
          <input
            type="text"
            value={profile.presenterName}
            onChange={(e) => updateField("presenterName", e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            Email for reports
          </label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => updateField("email", e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            School / organization
          </label>
          <input
            type="text"
            value={profile.schoolName}
            onChange={(e) => updateField("schoolName", e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            Role / title (optional)
          </label>
          <input
            type="text"
            value={profile.presenterTitle}
            onChange={(e) => updateField("presenterTitle", e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        </div>
      </section>

      {/* Room / stations settings */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Room & stations</h2>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            Default room label
          </label>
          <input
            type="text"
            value={profile.defaultRoomLabel}
            onChange={(e) =>
              updateField("defaultRoomLabel", e.target.value)
            }
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
          <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 4 }}>
            For example: “Classroom”, “Hallway”, “Gym A”.
          </p>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            Default number of stations
          </label>
          <input
            type="number"
            min={4}
            max={12}
            value={profile.defaultStations}
            onChange={(e) =>
              updateField("defaultStations", e.target.value)
            }
            style={{
              width: 100,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
          <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 4 }}>
            Used as the default layout for Room View and station posters. You
            can still override per session.
          </p>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            fontSize: "0.9rem",
          }}
        >
          <input
            type="checkbox"
            checked={profile.includeIndividualReports}
            onChange={(e) =>
              updateField("includeIndividualReports", e.target.checked)
            }
          />
          Include individual student report pages in PDF exports (where
          available).
        </label>
      </section>

      {/* Perspectives */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Perspectives / lenses
        </h2>
        <p style={{ fontSize: "0.85rem", color: "#4b5563" }}>
          Choose one or more perspectives that describe how you want AI
          summaries and reports to “look at” your sessions.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            marginTop: 8,
          }}
        >
          {PERSPECTIVE_OPTIONS.map((opt) => {
            const checked = profile.perspectives.includes(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: 8,
                  borderRadius: 8,
                  border: checked
                    ? "1px solid #0ea5e9"
                    : "1px solid #e5e7eb",
                  background: checked ? "#e0f2fe" : "#ffffff",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePerspective(opt.value)}
                  style={{ marginTop: 2 }}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Assessment categories */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Optional assessment categories
        </h2>
        <p style={{ fontSize: "0.85rem", color: "#4b5563" }}>
          Use up to four categories (for example: Knowledge, Application,
          Collaboration, Communication) for finer breakdowns in reports.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr",
            gap: 8,
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Key</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Label</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
            Weight %
          </div>

          {profile.assessmentCategories.map((cat, idx) => (
            <React.Fragment key={idx}>
              <input
                placeholder="knowledge"
                value={cat.key}
                onChange={(e) =>
                  updateCategory(idx, "key", e.target.value.toLowerCase())
                }
                style={{
                  padding: "4px 6px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                }}
              />
              <input
                placeholder="Knowledge / Content"
                value={cat.label}
                onChange={(e) =>
                  updateCategory(idx, "label", e.target.value)
                }
                style={{
                  padding: "4px 6px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                }}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={cat.weight ?? 25}
                onChange={(e) =>
                  updateCategory(idx, "weight", e.target.value)
                }
                style={{
                  padding: "4px 6px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                }}
              />
            </React.Fragment>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: saving ? "#9ca3af" : "#0ea5e9",
          color: "#fff",
          fontSize: "0.9rem",
          cursor: saving ? "default" : "pointer",
        }}
      >
        {saving ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );
}
