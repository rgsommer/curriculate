// teacher-app/src/pages/TeacherProfile.jsx
import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

const DEFAULT_CATEGORIES = [
  { key: "knowledge", label: "Knowledge", weight: 25 },
  { key: "application", label: "Application", weight: 25 },
  { key: "communication", label: "Communication", weight: 25 },
  { key: "collaboration", label: "Collaboration", weight: 25 },
];

export default function TeacherProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [perspectives, setPerspectives] = useState([]);
  const [newPerspective, setNewPerspective] = useState("");

  const [includeIndividualReports, setIncludeIndividualReports] =
    useState(true);
  const [assessmentCategories, setAssessmentCategories] = useState(
    DEFAULT_CATEGORIES
  );

  const [plan, setPlan] = useState(null); // "FREE" | "PLUS" | "PRO"
  const [planLabel, setPlanLabel] = useState("Loading…");

  // Load profile + subscription
  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setError("");

      try {
        const [profileRes, subRes] = await Promise.all([
          fetch(`${API_BASE}/api/profile/me`),
          fetch(`${API_BASE}/api/subscription/me`),
        ]);

        const profileText = await profileRes.text();
        const subText = await subRes.text();

        let profile = {};
        let sub = {};

        try {
          profile = profileText ? JSON.parse(profileText) : {};
        } catch {
          console.error("Profile JSON parse error:", profileText.slice(0, 500));
        }

        try {
          sub = subText ? JSON.parse(subText) : {};
        } catch {
          console.error("Subscription JSON parse error:", subText.slice(0, 500));
        }

        if (!profileRes.ok) {
          throw new Error(profile?.error || "Failed to load presenter profile");
        }

        // Profile fields
        setDisplayName(profile.displayName || profile.name || "");
        setEmail(profile.email || "");
        setSchoolName(profile.schoolName || "");

        if (Array.isArray(profile.perspectives)) {
          setPerspectives(profile.perspectives);
        }

        if (typeof profile.includeIndividualReports === "boolean") {
          setIncludeIndividualReports(profile.includeIndividualReports);
        }

        if (Array.isArray(profile.assessmentCategories)) {
          const cleaned = profile.assessmentCategories.map((c, idx) => ({
            key:
              c.key ||
              c.name ||
              (DEFAULT_CATEGORIES[idx] && DEFAULT_CATEGORIES[idx].key) ||
              `category-${idx + 1}`,
            label:
              c.label ||
              c.name ||
              (DEFAULT_CATEGORIES[idx] && DEFAULT_CATEGORIES[idx].label) ||
              `Category ${idx + 1}`,
            weight:
              typeof c.weight === "number"
                ? c.weight
                : DEFAULT_CATEGORIES[idx]
                ? DEFAULT_CATEGORIES[idx].weight
                : 25,
          }));
          setAssessmentCategories(cleaned);
        } else {
          setAssessmentCategories(DEFAULT_CATEGORIES);
        }

        // Subscription
        if (sub && sub.tier) {
          setPlan(sub.tier);
          setPlanLabel(
            sub.tier === "PRO"
              ? "Pro"
              : sub.tier === "PLUS"
              ? "Plus"
              : "Free"
          );
        } else {
          setPlan("FREE");
          setPlanLabel("Free");
        }
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  const handleAddPerspective = () => {
    const trimmed = newPerspective.trim();
    if (!trimmed) return;
    if (perspectives.includes(trimmed)) {
      setNewPerspective("");
      return;
    }
    setPerspectives((prev) => [...prev, trimmed]);
    setNewPerspective("");
  };

  const handleRemovePerspective = (p) => {
    setPerspectives((prev) => prev.filter((x) => x !== p));
  };

  const handleCategoryChange = (index, field, value) => {
    setAssessmentCategories((prev) => {
      const next = [...prev];
      const item = { ...(next[index] || {}) };
      if (field === "label") {
        item.label = value;
      } else if (field === "weight") {
        const num = parseFloat(value);
        if (!isNaN(num)) item.weight = num;
      }
      next[index] = item;
      return next;
    });
  };

  const totalWeight = assessmentCategories.reduce(
    (sum, c) => sum + (c.weight || 0),
    0
  );

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const payload = {
        displayName,
        email,
        schoolName,
        perspectives,
        includeIndividualReports,
        assessmentCategories,
      };

      const res = await fetch(`${API_BASE}/api/profile/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save profile");
      }

      alert("Presenter profile saved.");
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold">Presenter profile</h1>
          <p className="text-sm text-gray-600">
            This information appears on reports and helps tailor AI-generated
            task sets and summaries.
          </p>
        </div>
        <PlanBadge plan={plan} label={planLabel} />
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p>Loading profile…</p>
      ) : (
        <>
          {/* Identity */}
          <section className="p-4 rounded border bg-white space-y-3">
            <h2 className="font-semibold text-lg">Presenter details</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Your name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="e.g., Mr. Sommer"
              />
              <Field
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="you@school.org"
                type="email"
              />
            </div>

            <Field
              label="School / organization"
              value={schoolName}
              onChange={setSchoolName}
              placeholder="e.g., Brampton Christian School"
            />

            <p className="text-xs text-gray-500">
              On reports, your role is referred to as <strong>Presenter</strong>{" "}
              so this works equally well for conferences, PD days, and camps.
            </p>
          </section>

          {/* Perspectives */}
          <section className="p-4 rounded border bg-white space-y-3">
            <h2 className="font-semibold text-lg">Perspectives</h2>
            <p className="text-sm text-gray-600">
              Choose a few words that describe the lens or perspective of your
              sessions (e.g., Christian, Professional, Team-building). These can
              appear on reports and guide AI summaries.
            </p>

            <div className="flex flex-wrap gap-2 mb-2">
              {perspectives.length === 0 && (
                <span className="text-xs text-gray-500">
                  No perspectives added yet.
                </span>
              )}
              {perspectives.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-800 border border-blue-200"
                >
                  {p}
                  <button
                    type="button"
                    className="text-blue-500 hover:text-blue-700"
                    onClick={() => handleRemovePerspective(p)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newPerspective}
                onChange={(e) => setNewPerspective(e.target.value)}
                className="border rounded px-2 py-1 flex-1 text-sm"
                placeholder="Add a perspective (e.g., Christian, Professional)"
              />
              <button
                type="button"
                onClick={handleAddPerspective}
                className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                Add
              </button>
            </div>
          </section>

          {/* Reporting options */}
          <section className="p-4 rounded border bg-white space-y-3">
            <h2 className="font-semibold text-lg">Reporting & assessment</h2>

            <div className="flex items-center gap-2">
              <input
                id="include-individual-reports"
                type="checkbox"
                checked={includeIndividualReports}
                onChange={(e) =>
                  setIncludeIndividualReports(e.target.checked)
                }
              />
              <label
                htmlFor="include-individual-reports"
                className="text-sm text-gray-700"
              >
                Include individual student snapshot pages in PDF reports (where
                available).
              </label>
            </div>

            <p className="text-xs text-gray-500">
              On Free plans this may be limited to class-level summaries only.
            </p>

            <div className="mt-3">
              <h3 className="font-medium text-sm mb-1">
                Assessment categories
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Up to four categories can be used when computing final session
                evaluations (e.g., Knowledge, Application, Communication,
                Collaboration).
              </p>

              <div className="space-y-2">
                {assessmentCategories.map((cat, i) => (
                  <div
                    key={cat.key || i}
                    className="grid grid-cols-[minmax(0,1fr)_80px] gap-2 text-sm"
                  >
                    <input
                      type="text"
                      value={cat.label || ""}
                      onChange={(e) =>
                        handleCategoryChange(i, "label", e.target.value)
                      }
                      className="border rounded px-2 py-1"
                      placeholder={`Category ${i + 1}`}
                    />
                    <input
                      type="number"
                      value={cat.weight ?? ""}
                      onChange={(e) =>
                        handleCategoryChange(i, "weight", e.target.value)
                      }
                      className="border rounded px-2 py-1 w-full"
                      min={0}
                      max={100}
                      step={1}
                      placeholder="%"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-2 text-xs text-gray-500">
                Total weight:{" "}
                <span
                  className={
                    totalWeight === 100 ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {totalWeight}%
                </span>{" "}
                (aim for 100%).
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save presenter profile"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="text-sm text-gray-700 space-y-1">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border rounded px-2 py-1 w-full"
      />
    </label>
  );
}

function PlanBadge({ plan, label }) {
  if (!plan) {
    return (
      <div className="px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">
        Loading…
      </div>
    );
  }

  const colorClasses =
    plan === "PRO"
      ? "bg-purple-100 text-purple-800 border-purple-200"
      : plan === "PLUS"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div
      className={`px-3 py-1 rounded-full border text-xs font-semibold ${colorClasses}`}
    >
      Current plan: {label}
    </div>
  );
}
