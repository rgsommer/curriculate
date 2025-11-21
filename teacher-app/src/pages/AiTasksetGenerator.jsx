// src/pages/AiTasksetGenerator.jsx
import { useEffect, useState } from 'react';
import { fetchMyProfile } from '../api/profile';
import { generateAiTaskset } from '../api/tasksets.js';

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const LEARNING_GOALS = ['REVIEW', 'INTRODUCTION', 'ENRICHMENT', 'ASSESSMENT'];

export default function AiTasksetGenerator() {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState({
    gradeLevel: '',
    subject: '',
    difficulty: 'MEDIUM',
    durationMinutes: 45,
    topicTitle: '',
    wordConceptText: '',
    learningGoal: 'REVIEW',
    allowMovementTasks: true,
    allowDrawingMimeTasks: true
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const prof = await fetchMyProfile();
        if (!active) return;
        setProfile(prof);

        setForm(prev => ({
          ...prev,
          gradeLevel: prof.defaultGrade || '',
          subject: prof.defaultSubject || '',
          difficulty: prof.defaultDifficulty || 'MEDIUM',
          durationMinutes: prof.defaultDurationMinutes || 45,
          learningGoal: prof.defaultLearningGoal || 'REVIEW',
          allowMovementTasks:
            typeof prof.prefersMovementTasks === 'boolean'
              ? prof.prefersMovementTasks
              : true,
          allowDrawingMimeTasks:
            typeof prof.prefersDrawingMimeTasks === 'boolean'
              ? prof.prefersDrawingMimeTasks
              : true
        }));
      } catch (err) {
        console.error(err);
        if (active) setError('Failed to load teacher profile for defaults');
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const payload = {
        gradeLevel: form.gradeLevel || profile?.defaultGrade,
        subject: form.subject || profile?.defaultSubject,
        difficulty: form.difficulty,
        durationMinutes: Number(form.durationMinutes),
        topicTitle: form.topicTitle,
        wordConceptList: form.wordConceptText
          .split(',')
          .map(w => w.trim())
          .filter(Boolean),
        learningGoal: form.learningGoal,

        // NEW: matches backend lenses format
        lenses: {
          includePhysicalMovement: form.allowMovementTasks,
          includeCreative: form.allowDrawingMimeTasks,
          includeAnalytical: true,
          includeInputTasks: true
        }
      };

      const data = await generateAiTaskset(payload);
      setResult(data.taskset); // keep the same
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to generate TaskSet');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingProfile) return <div>Loading defaults…</div>;

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
                placeholder={profile?.defaultGrade || 'e.g. 7'}
              />
            </label>
            <label className="flex flex-col">
              <span>Subject</span>
              <input
                className="border rounded px-2 py-1"
                name="subject"
                value={form.subject}
                onChange={handleChange}
                placeholder={profile?.defaultSubject || 'e.g. History'}
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
                {DIFFICULTIES.map(d => (
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
          <label className="flex flex-col mt-3">
            <span>Learning Goal</span>
            <select
              className="border rounded px-2 py-1"
              name="learningGoal"
              value={form.learningGoal}
              onChange={handleChange}
            >
              {LEARNING_GOALS.map(g => (
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
        </section>

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
        >
          {submitting ? 'Generating…' : 'Generate Task Set'}
        </button>
      </form>

      {result && (
        <section className="border rounded p-4 bg-gray-50">
          <h2 className="font-semibold mb-2">
            Generated Task Set: {result.name || '(untitled)'}
          </h2>
          <p className="text-sm text-gray-700 mb-4">
            Grade {result.gradeLevel} • {result.subject} • Difficulty{' '}
            {result.difficulty} • {result.durationMinutes} min
          </p>

          <ol className="space-y-4 list-decimal pl-5">
            {result.tasks.map(t => (
              <li key={t.orderIndex} className="bg-white border rounded p-3">
                <div className="text-xs text-gray-500 mb-1">
                  {t.taskType} • {t.timeLimitSeconds}s • {t.points} pts
                </div>
                <div className="font-medium whitespace-pre-wrap">{t.prompt}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
