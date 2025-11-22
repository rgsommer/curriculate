// teacher-app/src/pages/TeacherProfile.jsx
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

const PLAN_LABELS = {
  FREE: "Free",
  TEACHER_PLUS: "Teacher Plus",
  SCHOOL: "School / Campus",
};

function formatPlanLabel(planName) {
  if (!planName) return "Free";
  return PLAN_LABELS[planName] || planName;
}

export default function TeacherProfilePage() {
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [planName, setPlanName] = useState(null);
  const [planFeatures, setPlanFeatures] = useState({});
  const [loadingPlan, setLoadingPlan] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      setLoadingPlan(true);

      try {
        // Load profile + subscription together
        const [profileRes, subRes] = await Promise.all([
          axios.get(`${API_BASE}/api/profile`),
          axios
            .get(`${API_BASE}/api/subscription/me`)
            .catch((err) => {
              // Don’t break profile load if subscription is not set up yet
              console.warn("subscription /me failed", err?.response?.status);
              return null;
            }),
        ]);

        if (cancelled) return;

        // PROFILE
        const data = (profileRes && profileRes.data) || {};
        const cats = Array.isArray(data.assessmentCategories)
          ? data.assessmentCategories
          : [];

        const filledCats = [
          ...cats,
          ...Array(Math.max(0, 4 - cats.length)).fill(0).map(() => emptyCategory()),
        ].slice(0, 4);

        setProfile({
          ...data,
          assessmentCategories: filledCats,
          perspectives: Array.isArray(data.perspectives)
            ? data.perspectives
            : [],
        });

        // SUBSCRIPTION
        if (subRes && subRes.data) {
          const sub = subRes.data;
          setPlanName(sub.planName || "FREE");
          setPlanFeatures(sub.features || {});
        } else {
          setPlanName("FREE");
          setPlanFeatures({});
        }
      } catch (err) {
        console.error("Load profile error", err);
        if (!cancelled) {
          setError("Could not load presenter profile.");
        }
      } finally {
        if (!cancelled) setLoadingPlan(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field, value) => {
    setProfile((prev) => ({
      ...(prev || {}),
      [field]: value,
    }));
  };

  const updateCategory = (index, field, value) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const list = [...(prev.assessmentCategories || [])];
      const cat = { ...(list[index] || emptyCategory()) };

      if (field === "label") {
        cat.label = value;
        if (!cat.key) {
          cat.key = value
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
        }
      } else if (field === "description") {
        cat.description = value;
      } else if (field === "weight") {
        const num = Number(value);
        cat.weight = Number.isFinite(num) ? num : 25;
      }
      list[index] = cat;
      return {
        ...prev,
        assessmentCategories: list,
      };
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
      setSavedMsg("Presenter profile saved.");
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
        <h1>Presenter Profile</h1>
        {error ? <p style={{ color: "red" }}>{error}</p> : <p>Loading…</p>}
      </div>
    );
  }

  const totalWeight = (profile.assessmentCategories || []).reduce(
    (sum, c) => sum + (Number(c.weight) || 0),
    0
  );

  const canToggleIndividualReports =
    planName === "TEACHER_PLUS" || planName === "SCHOOL";

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, 'Segoe UI'",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* Header with plan badge */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ marginTop: 0, marginBottom: 4 }}>Presenter Profile</h1>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#555" }}>
            This information appears on reports and helps shape AI-generated
            task sets and session summaries.
          </p>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              display: "inline-block",
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              fontSize: "0.8rem",
              background: "#f9fafb",
            }}
          >
            <span style={{ color: "#6b7280", marginRight: 4 }}>
              Current plan:
            </span>
            <strong>{formatPlanLabel(planName)}</strong>
          </div>
          {!loadingPlan && (
            <div style={{ marginTop: 4 }}>
              <a
                href="/my-plan"
                style={{
                  fontSize: "0.75rem",
                  color: "#0ea5e9",
                  textDecoration: "none",
                }}
              >
                View plan &amp; upgrade options
              </a>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p style={{ color: "red", marginTop: 0, marginBottom: 8 }}>{error}</p>
      )}
      {savedMsg && (
        <p style={{ color: "green", marginTop: 0, marginBottom: 8 }}>
          {savedMsg}
        </p>
      )}

      {/* School name */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          School / Organization Name
        </label>
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

      {/* Presenter name */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          Presenter Name
        </label>
        <input
          type="text"
          value={profile.displayName || profile.teacherName || ""}
          onChange={(e) => updateField("displayName", e.target.value)}
          placeholder="e.g., Mr. Sommer"
          style={{
            marginTop: 4,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #ccc",
            width: "100%",
            maxWidth: 260,
            fontSize: "0.9rem",
          }}
        />
        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: 4 }}>
          Reports will refer to you as the <strong>Presenter</strong>, which
          works for classrooms, conferences, PD days, and camps.
        </p>
      </div>

      {/* Email */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          Transcript Email
        </label>
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
            maxWidth: 260,
            fontSize: "0.9rem",
          }}
        />
        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: 4 }}>
          Session transcripts and PDF reports can be emailed here (depending on
          your plan).
        </p>
      </div>

      {/* Perspectives */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>Perspectives</h2>
        <p style={{ fontSize: "0.8rem", color: "#555", marginTop: 0 }}>
          Choose the lens or perspective for your sessions (Christian, business,
          team-building, etc.). These can be surfaced on reports and guide AI
          wording.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 4,
            maxWidth: 420,
          }}
        >
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
                  onChange={(e) =>
                    updateField(
                      "perspectives",
                      e.target.checked
                        ? [...(profile.perspectives || []), opt.value]
                        : (profile.perspectives || []).filter(
                            (v) => v !== opt.value
                          )
                    )
                  }
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Include individual reports (gated by plan) */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.9rem",
          }}
        >
          <input
            type="checkbox"
            checked={!!profile.includeIndividualReports}
            disabled={!canToggleIndividualReports}
            onChange={(e) =>
              updateField("includeIndividualReports", e.target.checked)
            }
          />
          <span>
            Include individual one-page snapshot reports in the PDF transcript
            (where data is available).
          </span>
        </label>
        {!canToggleIndividualReports && (
          <p style={{ fontSize: "0.75rem", color: "#666", marginTop: 4 }}>
            Individual student reports are unlocked on{" "}
            <strong>Teacher Plus</strong> and <strong>School</strong> plans.
            You’re currently on{" "}
            <strong>{formatPlanLabel(planName)}</strong>.{" "}
            <a
              href="/my-plan"
              style={{ color: "#0ea5e9", textDecoration: "none" }}
            >
              See upgrade options
            </a>
            .
          </p>
        )}
      </div>

      {/* Assessment categories */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem" }}>Assessment Categories (optional)</h2>
        <p style={{ fontSize: "0.8rem", color: "#555" }}>
          Define up to four categories for AI-based feedback (Knowledge,
          Application, Thinking, Communication, etc.). We’ll use these when
          summarizing performance.
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
                placeholder={`Category ${idx + 1}`}
                style={{
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                }}
              />
              <input
                type="text"
                value={cat.description || ""}
                onChange={(e) =>
                  updateCategory(idx, "description", e.target.value)
                }
                placeholder="What should AI look for here?"
                style={{
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                }}
              />
              <input
                type="number"
                value={cat.weight ?? ""}
                onChange={(e) =>
                  updateCategory(idx, "weight", e.target.value)
                }
                min={0}
                max={100}
                style={{
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  width: "100%",
                }}
              />
            </React.Fragment>
          ))}
        </div>

        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: 6 }}>
          Total weight:{" "}
          <span
            style={{ fontWeight: 600, color: totalWeight === 100 ? "green" : "red" }}
          >
            {totalWeight}%
          </span>{" "}
          (aim for 100%, but we’ll still work if it’s a bit off).
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: saving ? "#999" : "#0ea5e9",
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
