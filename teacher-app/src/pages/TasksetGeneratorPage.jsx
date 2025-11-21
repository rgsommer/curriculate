// src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from "react";
import { fetchMyProfile } from "../api/profile";
import { generateAiTaskset } from "../api/tasksets";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

export default function AiTasksetGenerator() {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState({
    gradeLevel: "",
    subject: "",
    difficulty: "MEDIUM",
    durationMinutes: 45,
    topicTitle: "",
    wordConceptText: "",
    learningGoal: "REVIEW",
    allowMovementTasks: true,
    allowDrawingMimeTasks: true,
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // ------------------------------------------------------
  // Load teacher profile defaults
  // ------------------------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const prof = await fetchMyProfile();
        if (!active) return;
        setProfile(prof);

        setForm((prev) => ({
          ...prev,
          gradeLevel: prof.defaultGrade || "",
          subject: prof.defaultSubject || "",
          difficulty: prof.defaultDifficulty || "MEDIUM",
          durationMinutes: prof.defaultDurationMinutes || 45,
          learningGoal: prof.defaultLearningGoal || "REVIEW",
          allowMovementTasks:
            typeof prof.prefersMovementTasks === "boolean"
              ? prof.prefersMovementTasks
              : true,
          allowDrawingMimeTasks:
            typeof prof.prefersDrawingMimeTasks === "boolean"
              ? prof.prefersDrawingMimeTasks
              : true,
        }));
      } catch (err) {
        console.error("Failed to load teacher profile for AI defaults:", err);
        if (active)
          setError("Failed to load teacher profile for defaults (AI).");
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // ------------------------------------------------------
  // Handlers
  // ------------------------------------------------------
  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setResult(null);

    try {
      const payload = {
        gradeLevel: form.gradeLevel || profile?.defaultGrade,
        subject: form.subject || profile?.defaultSubject,
        difficulty: form.difficulty,
        durationMinutes: Number(form.durationMinutes),
        topicTitle: form.topicTitle,
        wordConceptList: form.wordConceptText
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean),
        learningGoal: form.learningGoal,
        allowMovementTasks: form.allowMovementTasks,
        allowDrawingMimeTasks: form.allowDrawingMimeTasks,
        curriculumLenses: profile?.curriculumLenses || [],
      };

      const data = await generateAiTaskset(payload);
      console.log("✅ AI taskset response in component:", data);

      const taskset = data?.taskset || data;
      if (!taskset) {
        throw new Error(
          "Server did not return a taskset object. Check backend /api/ai/tasksets."
        );
      }

      setResult(taskset);
    } catch (err) {
      console.error("AI TaskSet generation error:", err);
      setError(err.message || "Failed to generate TaskSet");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingProfile) return <div>Loading defaults…</div>;

  // ------------------------------------------------------
  // Render
  // ------------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AI Task Set Generator</h1>

      {error && <div className="mb-2 text-red-600">{error}</div>}

      {!profile && (
        <div className="mb-4 text-yellow-700">
          You don&apos;t have a teacher profile yet. Defaults will be minimal.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 mb-8">
        <section>
          <h2 className="font-semibold mb-2">Basic Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span>Grade</span>
              <input
                className="border rounded px-2 py-1"
                name="gradeLevel"
                value={form.gradeLevel}
                onChange={handleChange}
                placeholder={profile?.defaultGrade || "e.g. 7"}
              />
            </label>

            <label className="flex flex-col">
              <span>Subject</span>
              <input
                className="border rounded px-2 py-1"
                name="subject"
                value={form.subject}
                onChange={handleChange}
                placeholder={profile?.defaultSubject || "e.g. History"}
              />
            </label>

            <label className="flex flex-col">
              <span>Difficulty</span>
              <select
                className="border rounded px-2 py-1"
                name="difficulty"
                value={form.difficulty}
                onChange={handleChange}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col">
              <span>Duration (minutes)</span>
              <input
                type="number"
                className="border rounded px-2 py-1"
                name="durationMinutes"
                value={form.durationMinutes}
                onChange={handleChange}
                min={5}
                max={120}
              />
            </label>
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Topic & Concepts</h2>
          <label className="flex flex-col mb-3">
            <span>Topic Title</span>
            <input
              className="border rounded px-2 py-1"
              name="topicTitle"
              value={form.topicTitle}
              onChange={handleChange}
              placeholder="e.g. Expulsion of the Acadians"
            />
          </label>

          <label className="flex flex-col">
            <span>Word / Concept List (comma-separated)</span>
            <textarea
              className="border rounded px-2 py-1 min-h-[80px]"
              name="wordConceptText"
              value={form.wordConceptText}
              onChange={handleChange}
              placeholder="Acadia, Treaty of Utrecht, deportation, oath of allegiance, Mi'kmaq, Grand Pré"
            />
          </label>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Learning Goal & Lenses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <label className="flex flex-col">
              <span>Learning Goal</span>
              <select
                className="border rounded px-2 py-1"
                name="learningGoal"
                value={form.learningGoal}
                onChange={handleChange}
              >
                {LEARNING_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="allowMovementTasks"
                checked={form.allowMovementTasks}
                onChange={handleChange}
              />
              <span>Allow movement / body tasks</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="allowDrawingMimeTasks"
                checked={form.allowDrawingMimeTasks}
                onChange={handleChange}
              />
              <span>Allow drawing / mime tasks</span>
            </label>
          </div>
        </section>

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? "Generating…" : "Generate Task Set"}
        </button>
      </form>

      {result && (
        <section className="border rounded p-4 bg-gray-50">
          <h2 className="font-semibold mb-2">
            Generated Task Set: {result.name || result.title || "(untitled)"}
          </h2>
          <p className="text-sm text-gray-700 mb-2">
            Grade {result.gradeLevel || "?"} • {result.subject || "?"} •
            Difficulty {result.difficulty || "?"} •{" "}
            {result.durationMinutes || "?"} min
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Saved to your account. You can now edit it in the Task Sets
            section.
          </p>
          <ol className="space-y-2 list-decimal pl-5">
            {(result.tasks || []).map((t, idx) => (
              <li
                key={t.order ?? idx}
                className="bg-white border rounded p-2"
              >
                <div className="text-xs text-gray-500 mb-1">
                  {t.taskType} •{" "}
                  {t.timeMinutes
                    ? `~${t.timeMinutes} min`
                    : t.timeLimitSeconds
                    ? `~${Math.round(t.timeLimitSeconds / 60)} min`
                    : "time n/a"}{" "}
                  • {t.movement ? "Movement" : "Non-movement"} •{" "}
                  {t.requiresDrawing ? "Drawing" : "No drawing"}
                </div>
                <div className="font-medium">{t.prompt}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
