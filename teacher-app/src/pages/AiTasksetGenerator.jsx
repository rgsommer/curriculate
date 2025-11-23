import { useEffect, useState } from "react";
import { fetchMyProfile } from "../api/profile";
import { generateAiTaskset } from "../api/tasksets";
import { API_BASE_URL } from "../config"; // ⬅️ use shared config

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

  // Subscription / AI-limit state
  const [subscription, setSubscription] = useState(null);
  const [aiLimitMessage, setAiLimitMessage] = useState("");

  // ------------------------------------------------------
  // Load presenter profile defaults
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
        console.error("Failed to load presenter profile for AI defaults:", err);
        if (active)
          setError("Failed to load presenter profile for AI defaults.");
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // ------------------------------------------------------
  // Load subscription info (AI limits, plan name, features)
  // ------------------------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/subscription/me`, {
          credentials: "include",
        });

        if (!active) return;
        if (!res.ok) throw new Error("Failed to load subscription info");
        const sub = await res.json();
        setSubscription(sub);

        // Initial teaser if backend already has one
        if (sub?.aiLimitTeaser) {
          setAiLimitMessage(sub.aiLimitTeaser);
        } else if (
          typeof sub?.aiTaskSetsRemaining === "number" &&
          sub.aiTaskSetsRemaining >= 0
        ) {
          const n = sub.aiTaskSetsRemaining;
          setAiLimitMessage(
            `You can generate ${n} more AI task set${
              n === 1 ? "" : "s"
            } this month on your current plan.`
          );
        }
      } catch (err) {
        console.error("Failed to load subscription info:", err);
        // Silent fail is fine; generator still works.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // ------------------------------------------------------
  // Derived values from subscription (plan badge + limits)
  // ------------------------------------------------------
  const planName = subscription?.planName || "FREE";
  const nicePlanName =
    planName === "FREE"
      ? "Free"
      : planName === "PLUS"
      ? "Plus"
      : planName === "PRO"
      ? "Pro"
      : planName;

  const maxWordListWords =
    subscription?.features?.maxWordListWords ??
    (planName === "FREE" ? 10 : planName === "PLUS" ? 100 : 9999);

  const maxTasksPerSet =
    subscription?.features?.maxTasksPerSet ??
    (planName === "FREE" ? 5 : planName === "PLUS" ? 20 : 50);

  const aiRemaining =
    typeof subscription?.aiTaskSetsRemaining === "number"
      ? subscription.aiTaskSetsRemaining
      : null;

  const wordConceptListRaw = form.wordConceptText
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  const wordConceptCount = wordConceptListRaw.length;
  const overWordLimit =
    typeof maxWordListWords === "number" &&
    maxWordListWords > 0 &&
    wordConceptCount > maxWordListWords;

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
      // Guard 1: AI usage for this period
      if (aiRemaining !== null && aiRemaining <= 0) {
        if (subscription?.aiLimitTeaser) {
          setAiLimitMessage(subscription.aiLimitTeaser);
        } else {
          setAiLimitMessage(
            "You’ve reached your AI limit for this period on your current plan."
          );
        }
        setSubmitting(false);
        return;
      }

      // Guard 2: word list length (e.g., FREE = 10)
      if (overWordLimit) {
        setError(
          `Your current plan allows up to ${maxWordListWords} words in the list. You currently have ${wordConceptCount}.`
        );
        setSubmitting(false);
        return;
      }

      const payload = {
        gradeLevel: form.gradeLevel || profile?.defaultGrade,
        subject: form.subject || profile?.defaultSubject,
        difficulty: form.difficulty,
        durationMinutes: Number(form.durationMinutes),
        topicTitle: form.topicTitle,
        wordConceptList: wordConceptListRaw,
        learningGoal: form.learningGoal,

        // Task preferences, as before
        lenses: {
          includePhysicalMovement: form.allowMovementTasks,
          includeCreative: form.allowDrawingMimeTasks,
          includeAnalytical: true,
          includeInputTasks: true,
        },

        // Hint max tasks to AI (FREE = 5, etc.)
        maxTasksPerSet,
      };

      const data = await generateAiTaskset(payload);
      console.log("✅ AI taskset response:", data);

      // Keep subscription state in sync if backend returns it
      if (data?.subscription) {
        setSubscription(data.subscription);

        if (data.subscription.aiLimitTeaser) {
          setAiLimitMessage(data.subscription.aiLimitTeaser);
        } else if (
          typeof data.subscription.aiTaskSetsRemaining === "number" &&
          data.subscription.aiTaskSetsRemaining >= 0
        ) {
          const n = data.subscription.aiTaskSetsRemaining;
          setAiLimitMessage(
            `You can generate ${n} more AI task set${
              n === 1 ? "" : "s"
            } this month on your current plan.`
          );
        }
      }

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
      {/* Plan badge */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">AI Task Set Generator</h1>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs bg-slate-50 border-slate-300">
          <span className="uppercase tracking-wide text-gray-500">
            Current plan
          </span>
          <span className="font-semibold text-gray-800">
            {nicePlanName}
          </span>
        </div>
      </div>

      {error && <div className="mb-2 text-red-600">{error}</div>}

      {!profile && (
        <div className="mb-4 text-yellow-700">
          You don&apos;t have a presenter profile yet. Defaults will be minimal.
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
              <span>Target Duration (minutes)</span>
              <input
                type="number"
                min="5"
                className="border rounded px-2 py-1"
                name="durationMinutes"
                value={form.durationMinutes}
                onChange={handleChange}
              />
            </label>

            <label className="flex flex-col md:col-span-2">
              <span>Topic / Unit Title</span>
              <input
                className="border rounded px-2 py-1"
                name="topicTitle"
                value={form.topicTitle}
                onChange={handleChange}
                placeholder="e.g. Expulsion of the Acadians"
              />
            </label>
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Curriculum Content</h2>
          <label className="flex flex-col">
            <span>Word & Concept List (comma-separated)</span>
            <textarea
              className="border rounded px-2 py-1 min-h-[80px]"
              name="wordConceptText"
              value={form.wordConceptText}
              onChange={handleChange}
              placeholder="Acadia, Treaty of Utrecht, deportation, oath of allegiance, Mi'kmaq, Grand Pré"
            />
          </label>
          <div className="mt-1 text-xs text-gray-600 flex flex-col md:flex-row md:items-center md:justify-between gap-1">
            <span>
              Words in list: {wordConceptCount} / {maxWordListWords}
            </span>
            {planName === "FREE" && (
              <span>
                On the Free plan, you can include up to {maxWordListWords}{" "}
                words. Longer lists are available with Curriculate Plus and
                Pro.
              </span>
            )}
          </div>

          <label className="flex flex-col mt-3">
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
        </section>

        <section>
          <h2 className="font-semibold mb-2">Task Preferences</h2>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allowMovementTasks"
                checked={form.allowMovementTasks}
                onChange={handleChange}
              />
              <span>Allow movement / Body Break tasks</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allowDrawingMimeTasks"
                checked={form.allowDrawingMimeTasks}
                onChange={handleChange}
              />
              <span>Allow drawing / mime tasks</span>
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            This plan will typically generate up to {maxTasksPerSet} tasks in a
            set, based on your current subscription.
          </p>
        </section>

        <div>
          <button
            type="submit"
            disabled={
              submitting ||
              (aiRemaining !== null && aiRemaining <= 0) ||
              overWordLimit
            }
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Generating…" : "Generate Task Set"}
          </button>

          {/* AI Limit / Teaser Message */}
          {aiLimitMessage && (
            <div
              className={`mt-2 text-sm ${
                aiRemaining === 0 ? "text-red-600" : "text-gray-700"
              }`}
            >
              {aiLimitMessage}
            </div>
          )}
        </div>
      </form>

      {result && (
        <section className="border rounded p-4 bg-gray-50">
          <h2 className="font-semibold mb-2">
            Generated Task Set: {result.name || "(untitled)"}
          </h2>
          <p className="text-sm text-gray-700 mb-4">
            Grade {result.gradeLevel} • {result.subject} • Difficulty{" "}
            {result.difficulty} • {result.durationMinutes} min
          </p>

          <ol className="space-y-4 list-decimal pl-5">
            {result.tasks.map((t) => (
              <li key={t.orderIndex} className="bg-white border rounded p-3">
                <div className="text-xs text-gray-500 mb-1">
                  {t.taskType} • {t.timeLimitSeconds}s • {t.points} pts
                </div>
                <div className="font-medium whitespace-pre-wrap">
                  {t.prompt}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
