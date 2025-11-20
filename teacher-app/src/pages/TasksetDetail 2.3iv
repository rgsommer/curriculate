// src/pages/TasksetDetail.jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTaskset } from '../api/tasksets';

export default function TasksetDetail() {
  const { id } = useParams();
  const [taskset, setTaskset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchTaskset(id);
        if (active) setTaskset(data);
      } catch (err) {
        console.error(err);
        if (active) setError(err.message || 'Failed to load task set');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <div>Loading task set…</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!taskset) return <div>Task set not found.</div>;

  const {
    title,
    gradeLevel,
    subject,
    difficulty,
    durationMinutes,
    learningGoal,
    tasks,
    analytics,
    canViewAnalytics,
    planName
  } = taskset;

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">{title}</h1>
          <p className="text-sm text-gray-600">
            Grade {gradeLevel} • {subject} • Difficulty {difficulty} • {durationMinutes} min •{' '}
            Goal: {learningGoal}
          </p>
        </div>
        <Link
          to="/teacher/tasksets"
          className="text-sm text-blue-600 underline"
        >
          Back to Task Sets
        </Link>
      </div>

      {/* Analytics panel */}
      <section className="mb-6">
        <h2 className="font-semibold mb-2">Analytics</h2>
        {!canViewAnalytics && (
          <div className="p-3 border rounded bg-yellow-50 text-sm text-yellow-800">
            Analytics are not available on your current plan ({planName || 'FREE'}). Upgrade to
            unlock engagement, completion, and scoring data for this TaskSet.
          </div>
        )}

        {canViewAnalytics && analytics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 border rounded p-4">
            <div>
              <div className="text-xs uppercase text-gray-500">Last Played</div>
              <div className="text-lg font-semibold">
                {analytics.lastPlayedAt
                  ? new Date(analytics.lastPlayedAt).toLocaleString()
                  : 'Never'}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Total Plays</div>
              <div className="text-lg font-semibold">{analytics.totalPlays || 0}</div>
              <div className="text-xs text-gray-500">
                Total Players: {analytics.totalPlayers || 0}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Performance</div>
              <div className="text-sm">
                <span className="block">
                  Avg Engagement:{' '}
                  {analytics.avgEngagementScore != null
                    ? `${Math.round(analytics.avgEngagementScore * 100) / 100}`
                    : '—'}
                </span>
                <span className="block">
                  Completion Rate:{' '}
                  {analytics.completionRate != null
                    ? `${Math.round(analytics.completionRate * 100)}%`
                    : '—'}
                </span>
                <span className="block">
                  Avg Score:{' '}
                  {analytics.avgScorePercent != null
                    ? `${Math.round(analytics.avgScorePercent)}%`
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tasks list */}
      <section>
        <h2 className="font-semibold mb-2">Tasks ({tasks.length})</h2>
        <ol className="space-y-3 list-decimal pl-5">
          {tasks.map(t => (
            <li key={t.order} className="bg-white border rounded p-3">
              <div className="text-xs text-gray-500 mb-1">
                {t.taskType} • ~{t.timeMinutes} min •{' '}
                {t.movement ? 'Movement' : 'Non-movement'} •{' '}
                {t.requiresDrawing ? 'Drawing' : 'No drawing'}
              </div>
              <div className="font-medium mb-1">{t.prompt}</div>
              {t.options && t.options.length > 0 && (
                <ul className="list-disc pl-5 text-sm">
                  {t.options.map((opt, i) => (
                    <li key={i}>{opt}</li>
                  ))}
                </ul>
              )}
              {t.notesForTeacher && (
                <div className="mt-2 text-xs text-gray-600">
                  <span className="font-semibold">Teacher note: </span>
                  {t.notesForTeacher}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
