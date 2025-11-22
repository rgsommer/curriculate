import React, { useEffect, useState } from "react";
import axios from "axios";

import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

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

// Make sure we always have 4 perspective slots in the UI
function ensureFourSlots(perspectives = []) {
  const base = Array.isArray(perspectives) ? perspectives : [];
  return [...base, ...Array(Math.max(0, 4 - base.length)).fill("")].slice(
    0,
    4
  );
}

export default function TeacherProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    displayName: "",
    schoolName: "",
    defaultGrade: "",
    defaultSubject: "",
    defaultDurationMinutes: 45,
    defaultDifficulty: "MEDIUM",
    defaultLearningGoal: "REVIEW",
    perspectives: [],
    allowIndividualReports: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const res = await axios.get(`${API_BASE}/teacher-profile/me`, {
          withCredentials: true,
        });

        if (cancelled) return;
        const data = res.data || {};
        const {
          displayName,
          schoolName,
          defaultGrade,
          defaultSubject,
          defaultDurationMinutes,
          defaultDifficulty,
          defaultLearningGoal,
          perspectives,
          allowIndividualReports,
        } = data;

        setForm({
          displayName: displayName || "",
          schoolName: schoolName || "",
          defaultGrade: defaultGrade || "",
          defaultSubject: defaultSubject || "",
          defaultDurationMinutes: defaultDurationMinutes || 45,
          defaultDifficulty: defaultDifficulty || "MEDIUM",
          defaultLearningGoal: defaultLearningGoal || "REVIEW",
          perspectives: ensureFourSlots(perspectives),
          allowIndividualReports: !!allowIndividualReports,
        });
      } catch (err) {
        console.error("Load profile error", err);
        if (!cancelled) {
          setError("Could not load teacher profile.");
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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handlePerspectiveChange = (index, value) => {
    setForm((prev) => {
      const copy = [...prev.perspectives];
      copy[index] = value;
      return { ...prev, perspectives: copy };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        ...form,
        perspectives: form.perspectives.filter(Boolean),
      };

      await axios.put(`${API_BASE}/teacher-profile/me`, payload, {
        withCredentials: true,
      });

      alert("Presenter profile saved.");
    } catch (err) {
      console.error("Save profile error", err);
      setError("Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading presenter profile…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">Presenter Profile</h1>
      <p className="text-sm text-gray-600 mb-4">
        This information helps Curriculate tune AI-generated task sets and
        reporting for your context.
      </p>

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <section>
          <h2 className="font-semibold mb-2">Basic Info</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span>Display Name</span>
              <input
                type="text"
                name="displayName"
                value={form.displayName}
                onChange={handleChange}
                className="border rounded px-2 py-1"
                placeholder="How should we refer to you in the app?"
              />
            </label>
            <label className="flex flex-col">
              <span>School / Organization</span>
              <input
                type="text"
                name="schoolName"
                value={form.schoolName}
                onChange={handleChange}
                className="border rounded px-2 py-1"
                placeholder="School or organization name"
              />
            </label>
            <label className="flex flex-col">
              <span>Default Grade</span>
              <input
                type="text"
                name="defaultGrade"
                value={form.defaultGrade}
                onChange={handleChange}
                className="border rounded px-2 py-1"
                placeholder="e.g. 7"
              />
            </label>
            <label className="flex flex-col">
              <span>Default Subject</span>
              <input
                type="text"
                name="defaultSubject"
                value={form.defaultSubject}
                onChange={handleChange}
                className="border rounded px-2 py-1"
                placeholder="e.g. History"
              />
            </label>
          </div>
        </section>

        {/* Defaults for AI */}
        <section>
          <h2 className="font-semibold mb-2">AI Defaults</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col">
              <span>Default Duration (minutes)</span>
              <input
                type="number"
                name="defaultDurationMinutes"
                value={form.defaultDurationMinutes}
                onChange={handleChange}
                className="border rounded px-2 py-1"
                min={5}
                max={120}
              />
            </label>
            <label className="flex flex-col">
              <span>Default Difficulty</span>
              <select
                name="defaultDifficulty"
                value={form.defaultDifficulty}
                onChange={handleChange}
                className="border rounded px-2 py-1"
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <label className="flex flex-col">
              <span>Default Learning Goal</span>
              <select
                name="defaultLearningGoal"
                value={form.defaultLearningGoal}
                onChange={handleChange}
                className="border rounded px-2 py-1"
              >
                <option value="REVIEW">Review / Practice</option>
                <option value="INTRODUCTION">Introduce New Material</option>
                <option value="ENRICHMENT">Enrichment / Extension</option>
                <option value="ASSESSMENT">Assessment / Check-in</option>
              </select>
            </label>
          </div>
        </section>

        {/* Perspectives */}
        <section>
          <h2 className="font-semibold mb-2">Perspectives (Curriculum Lenses)</h2>
          <p className="text-xs text-gray-600 mb-2">
            Choose up to four perspectives that often shape how you approach a
            topic. These help AI suggest tasks that fit your teaching style and
            context.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {form.perspectives.map((value, index) => (
              <label key={index} className="flex flex-col text-sm">
                <span>Perspective {index + 1}</span>
                <select
                  value={value}
                  onChange={(e) =>
                    handlePerspectiveChange(index, e.target.value)
                  }
                  className="border rounded px-2 py-1"
                >
                  <option value="">— None —</option>
                  {PERSPECTIVE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        {/* Reporting preferences */}
        <section>
          <h2 className="font-semibold mb-2">Reporting</h2>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allowIndividualReports"
              checked={form.allowIndividualReports}
              onChange={handleChange}
            />
            <span>
              I would like the option to generate individual student PDF
              reports when available on my plan.
            </span>
          </label>
          <p className="mt-1 text-xs text-gray-600">
            On Free, you&apos;ll see a basic session summary. Curriculate Plus
            and Pro add richer class and individual reporting options.
          </p>
        </section>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Presenter Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
