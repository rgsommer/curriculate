// src/pages/AnalyticsOverview.jsx
import React, { useEffect, useState } from "react";
import api from "../api/client";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AnalyticsOverview() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/analytics/sessions")
      .then((res) => setSessions(res.data.sessions || []))
      .catch((err) => {
        console.error(err);
        setError(
          err.response?.data?.error || "Unable to load analytics sessions."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  if (!user) return <div className="p-4">Please log in.</div>;

  if (loading) return <div className="p-4">Loading analytics…</div>;

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-gray-600">
            Session-level reports for your recent classes.
          </p>
        </div>
        {user.subscriptionTier === "PLUS" || user.subscriptionTier === "PRO" ? null : (
          <div className="text-xs text-red-600">
            Analytics requires PLUS or PRO. Upgrade in your account to unlock
            full reports.
          </div>
        )}
      </header>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {sessions.length === 0 && !error && (
        <p className="text-sm text-gray-600">
          No analytics yet. Run a task set and end the session to generate a
          report.
        </p>
      )}

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
                <div>Class accuracy: {s.classAverageAccuracy}%</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
