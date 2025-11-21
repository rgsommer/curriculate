// src/pages/TeacherProfile.jsx
import { useEffect, useState } from 'react';
import { fetchMyProfile, updateMyProfile } from '../api/profile';

const ALL_LENSES = [
  { value: 'BIBLICAL_CHRISTIAN', label: 'Biblical Christianity' },
  { value: 'CLASSICAL_CHRISTIAN', label: 'Classical Christian Education' },
  { value: 'GENERIC_CHRISTIAN', label: 'Generic Christian' },
  { value: 'SECULAR_NEUTRAL', label: 'Secular / Neutral' }
];


const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const LEARNING_GOALS = ['REVIEW', 'INTRODUCTION', 'ENRICHMENT', 'ASSESSMENT'];

export default function TeacherProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchMyProfile();
        if (active) {
          // Normalize some fields
          setProfile({
            ...data,
            gradesTaught: data.gradesTaught || [],
            subjectsTaught: data.subjectsTaught || [],
            curriculumLenses: data.curriculumLenses || []
          });
        }
      } catch (err) {
        console.error(err);
        if (active) setError('Failed to load profile');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  }

  function handleCheckboxListChange(e, field, optionValue) {
    const checked = e.target.checked;
    setProfile(prev => {
      const current = new Set(prev[field] || []);
      if (checked) current.add(optionValue);
      else current.delete(optionValue);
      return { ...prev, [field]: Array.from(current) };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        displayName: profile.displayName,
        schoolName: profile.schoolName,
        countryRegion: profile.countryRegion,
        gradesTaught: profile.gradesTaught.filter(Boolean),
        subjectsTaught: profile.subjectsTaught.filter(Boolean),
        curriculumLenses: profile.curriculumLenses,
        defaultGrade: profile.defaultGrade,
        defaultSubject: profile.defaultSubject,
        defaultDifficulty: profile.defaultDifficulty,
        defaultDurationMinutes: Number(profile.defaultDurationMinutes || 45),
        defaultLearningGoal: profile.defaultLearningGoal,
        prefersMovementTasks: !!profile.prefersMovementTasks,
        prefersDrawingMimeTasks: !!profile.prefersDrawingMimeTasks,
        prefersFrenchLanguageSupport: !!profile.prefersFrenchLanguageSupport
      };
      const updated = await updateMyProfile(payload);
      setProfile(updated);
      setSuccess('Profile saved');
    } catch (err) {
      console.error(err);
      setError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div>Loading profile…</div>;
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Teacher Profile</h1>
        <div className="mb-2 text-red-600">{error}</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Teacher Profile</h1>
        <div className="mb-2 text-red-600">
          No profile data returned from the server.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Teacher Profile</h1>
      {error && <div className="mb-2 text-red-600">{error}</div>}
      {success && <div className="mb-2 text-green-600">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <section>
          <h2 className="font-semibold mb-2">Basic Info</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span>Display Name</span>
              <input
                className="border rounded px-2 py-1"
                name="displayName"
                value={profile.displayName || ''}
                onChange={handleChange}
              />
            </label>
            <label className="flex flex-col">
              <span>School Name</span>
              <input
                className="border rounded px-2 py-1"
                name="schoolName"
                value={profile.schoolName || ''}
                onChange={handleChange}
              />
            </label>
            <label className="flex flex-col">
              <span>Country/Region</span>
              <input
                className="border rounded px-2 py-1"
                name="countryRegion"
                value={profile.countryRegion || ''}
                onChange={handleChange}
              />
            </label>
          </div>
        </section>

        {/* Teaching areas */}
        <section>
          <h2 className="font-semibold mb-2">Teaching Areas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span>Grades Taught (comma-separated)</span>
              <input
                className="border rounded px-2 py-1"
                value={profile.gradesTaught.join(', ')}
                onChange={e =>
                  setProfile(prev => ({
                    ...prev,
                    gradesTaught: e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean)
                  }))
                }
              />
            </label>
            <label className="flex flex-col">
              <span>Subjects Taught (comma-separated)</span>
              <input
                className="border rounded px-2 py-1"
                value={profile.subjectsTaught.join(', ')}
                onChange={e =>
                  setProfile(prev => ({
                    ...prev,
                    subjectsTaught: e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean)
                  }))
                }
              />
            </label>
          </div>
        </section>

        {/* Curriculum lens */}
        <section>
          <h2 className="font-semibold mb-2">Curriculum Lens</h2>
          <p className="text-sm text-gray-600 mb-1">
            These choices shape how the AI frames examples, worldview, and doctrine.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ALL_LENSES.map(l => (
              <label key={l.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={(profile.curriculumLenses || []).includes(l.value)}
                  onChange={e => handleCheckboxListChange(e, 'curriculumLenses', l.value)}
                />
                <span>{l.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Defaults for AI generation */}
        <section>
          <h2 className="font-semibold mb-2">Defaults for AI Task Sets</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span>Default Grade</span>
              <input
                className="border rounded px-2 py-1"
                name="defaultGrade"
                value={profile.defaultGrade || ''}
                onChange={handleChange}
              />
            </label>
            <label className="flex flex-col">
              <span>Default Subject</span>
              <input
                className="border rounded px-2 py-1"
                name="defaultSubject"
                value={profile.defaultSubject || ''}
                onChange={handleChange}
              />
            </label>
            <label className="flex flex-col">
              <span>Default Difficulty</span>
              <select
                className="border rounded px-2 py-1"
                name="defaultDifficulty"
                value={profile.defaultDifficulty || 'MEDIUM'}
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
              <span>Default Duration (minutes)</span>
              <input
                type="number"
                min="5"
                className="border rounded px-2 py-1"
                name="defaultDurationMinutes"
                value={profile.defaultDurationMinutes || 45}
                onChange={handleChange}
              />
            </label>
            <label className="flex flex-col">
              <span>Default Learning Goal</span>
              <select
                className="border rounded px-2 py-1"
                name="defaultLearningGoal"
                value={profile.defaultLearningGoal || 'REVIEW'}
                onChange={handleChange}
              >
                {LEARNING_GOALS.map(g => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Pedagogical prefs */}
        <section>
          <h2 className="font-semibold mb-2">Pedagogical Preferences</h2>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!profile.prefersMovementTasks}
                onChange={e =>
                  setProfile(prev => ({
                    ...prev,
                    prefersMovementTasks: e.target.checked
                  }))
                }
              />
              <span>Include movement / Body Break style tasks by default</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!profile.prefersDrawingMimeTasks}
                onChange={e =>
                  setProfile(prev => ({
                    ...prev,
                    prefersDrawingMimeTasks: e.target.checked
                  }))
                }
              />
              <span>Include drawing / mime tasks by default</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!profile.prefersFrenchLanguageSupport}
                onChange={e =>
                  setProfile(prev => ({
                    ...prev,
                    prefersFrenchLanguageSupport: e.target.checked
                  }))
                }
              />
              <span>Include French language support where appropriate</span>
            </label>
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
      </form>
    </div>
  );
}
