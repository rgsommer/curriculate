// teacher-app/src/pages/AnalyticsOverview.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../auth/useAuth";

export default function AnalyticsOverview() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/analytics/sessions");
        if (!cancelled) {
          setSessions(res.data.sessions || []);
        }
      } catch (err) {
        console.error("Analytics load error", err);
        if (!cancelled) {
          setError(
            err.response?.data?.error ||
              "We couldn’t load your reports right now."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSessions();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) {
    return <div className="p-4">Please sign in to view reports.</div>;
  }

  if (loading) {
    return <div className="p-4">Loading reports…</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-gray-600">
            Session-level summaries for your recent classes.
          </p>
        </div>
      </header>

      {error && (
        <div className="text-sm text-red-600">
          {error}
          <div className="text-xs text-gray-600 mt-1">
            Analytics is still warming up behind the scenes. You can keep
            using Curriculate; reports will appear here once they’re ready.
          </div>
        </div>
      )}

      {!error && sessions.length === 0 && (
        <p className="text-sm text-gray-600">
          No analytics yet. Run a live session, end it, and we’ll start
          building reports here.
        </p>
      )}

      {sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link
              key={s._id}
              to={`/analytics/sessions/${s._id}`}
              className="block border rounded-lg bg-white hover:bg-gray-50 p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    {s.classroomName} – {s.taskSetName}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(s.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div>Class avg score: {s.classAverageScore}%</div>
                  <div>
                    Engagement:{" "}
                    {s.classAverageEngagement != null
                      ? `${s.classAverageEngagement}%`
                      : "–"}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
