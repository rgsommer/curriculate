import React, { useEffect, useState } from "react";
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "https://api.curriculate.net";

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
  description: "",
  weight: 25,
});

export default function TeacherProfilePage() {
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      try {
        const res = await axios.get(`${API_BASE}/api/profile`);
        if (!cancelled) {
          const data = res.data || {};
          const cats = Array.isArray(data.assessmentCategories)
            ? data.assessmentCategories
            : [];

          setProfile({
            ...data,
            assessmentCategories: [
              ...cats,
              ...Array(Math.max(0, 4 - cats.length)).fill(0).map(() => emptyCategory()),
            ].slice(0, 4),
            perspectives: Array.isArray(data.perspectives)
              ? data.perspectives
              : [],
          });
        }
      } catch (err) {
        console.error("Load profile error", err);
        if (!cancelled) {
          setError("Could not load teacher profile.");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field, value) => {
    setProfile((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateCategory = (idx, field, value) => {
    setProfile((prev) => {
      const cats = [...(prev.assessmentCategories || [])];
      const current = { ...(cats[idx] || emptyCategory()) };
      if (field === "label") {
        current.label = value;
        if (!current.key) {
          current.key = value
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9\-]/g, "")
            .slice(0, 32);
        }
      } else {
        current[field] = value;
      }
      cats[idx] = current;
      return { ...prev, assessmentCategories: cats };
    });
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setError("");
    setSavedMsg("");

    const payload = {
      ...profile,
      assessmentCategories: (profile.assessmentCategories || [])
        .filter((c) => c && c.label && c.key)
        .map((c) => ({
          key: c.key,
          label: c.label,
          description: c.description || "",
          weight: Number.isFinite(Number(c.weight))
            ? Number(c.weight)
            : 25,
        })),
    };

    try {
      await axios.put(`${API_BASE}/api/profile`, payload);
      setSavedMsg("Profile saved.");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (err) {
      console.error("Save profile error", err);
      setError("Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Teacher Profile</h1>
        {error ? <p style={{ color: "red" }}>{error}</p> : <p>Loading…</p>}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, 'Segoe UI'",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Teacher Profile</h1>

      {error && <p style={{ color: "red", marginTop: 0 }}>{error}</p>}
      {savedMsg && <p style={{ color: "green", marginTop: 0 }}>{savedMsg}</p>}

      {/* School name */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>School / Organization Name</label>
        <input
          type="text"
          value={profile.schoolName || ""}
          onChange={(e) => updateField("schoolName", e.target.value)}
          placeholder="e.g., Brampton Christian School"
          style={{
            marginTop: 4,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #ccc",
            width: "100%",
            maxWidth: 360,
            fontSize: "0.9rem",
          }}
        />
      </div>

      {/* Email */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Transcript Email</label>
        <input
          type="email"
          value={profile.email || ""}
          onChange={(e) => updateField("email", e.target.value)}
          placeholder="you@school.org"
          style={{
            marginTop: 4,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #ccc",
            width: "100%",
            maxWidth: 320,
            fontSize: "0.9rem",
          }}
        />
      </div>

      {/* Perspectives */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>Perspectives</h2>
        <p style={{ fontSize: "0.8rem", color: "#555", marginTop: 0 }}>
          Select one or more perspectives that Curriculate should “wear” when generating summaries and feedback.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PERSPECTIVE_OPTIONS.map((opt) => {
            const selected = (profile.perspectives || []).includes(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    setProfile((prev) => {
                      const current = prev.perspectives || [];
                      const next = e.target.checked
                        ? [...new Set([...current, opt.value])]
                        : current.filter((v) => v !== opt.value);
                      return { ...prev, perspectives: next };
                    });
                  }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>

        <p style={{ marginTop: 4, fontSize: "0.8rem", color: "#555" }}>
          Selected:{" "}
          {(profile.perspectives || [])
            .map(
              (v) =>
                PERSPECTIVE_OPTIONS.find((o) => o.value === v)?.label ||
                v
            )
            .join(", ") || "None"}
        </p>
      </div>

      {/* Include individual reports */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}
        >
          <input
            type="checkbox"
            checked={!!profile.includeIndividualReports}
            onChange={(e) =>
              updateField("includeIndividualReports", e.target.checked)
            }
          />
          Include individual one-page reports in the PDF transcript
        </label>
      </div>

      {/* Assessment categories */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem" }}>Assessment Categories (optional)</h2>
        <p style={{ fontSize: "0.8rem", color: "#555" }}>
          Define up to four categories for AI-based feedback (Knowledge, Application, Thinking, Communication, etc.).
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,2fr) minmax(0,3fr) 80px",
            gap: 8,
            fontSize: "0.8rem",
          }}
        >
          <div style={{ fontWeight: 600 }}>Label</div>
          <div style={{ fontWeight: 600 }}>Description (for AI)</div>
          <div style={{ fontWeight: 600 }}>Weight</div>

          {(profile.assessmentCategories || []).map((cat, idx) => (
            <React.Fragment key={idx}>
              <input
                type="text"
                value={cat.label || ""}
                onChange={(e) =>
                  updateCategory(idx, "label", e.target.value)
                }
                placeholder={
                  idx === 0 ? "Knowledge" : idx === 1 ? "Application" : idx === 2 ? "Thinking" : "Communication"
                }
                style={{
                  padding: "4px 6px",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />

              <input
                type="text"
                value={cat.description || ""}
                onChange={(e) =>
                  updateCategory(idx, "description", e.target.value)
                }
                placeholder="Explain what this category measures"
                style={{
                  padding: "4px 6px",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />

              <input
                type="number"
                value={cat.weight ?? 25}
                onChange={(e) =>
                  updateCategory(idx, "weight", e.target.value)
                }
                style={{
                  padding: "4px 6px",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: saving ? "#999" : "#0ea5e9",
          color: "#fff",
          fontSize: "0.9rem",
        }}
      >
        {saving ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );
}
