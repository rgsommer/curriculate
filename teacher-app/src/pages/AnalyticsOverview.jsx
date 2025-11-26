// teacher-app/src/pages/AnalyticsOverview.jsx
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../auth/useAuth";

export default function AnalyticsOverview() {
  const navigate = useNavigate();
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

  const handleBack = () => {
    // Try going back; if nothing to go back to, send to home/dashboard
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  // Not signed in (if/when auth is active)
  if (!user) {
    return (
      <div className="p-6 space-y-4">
        <button
          type="button"
          onClick={handleBack}
          className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-100"
        >
          ← Back
        </button>
        <div>Please sign in to view reports.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <button
          type="button"
          onClick={handleBack}
          className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-100"
        >
          ← Back
        </button>
        <div>Loading reports…</div>
      </div>
    );
  }

  const hasSessions = sessions && sessions.length > 0;

  return (
    <div className="p-6 space-y-4">
      {/* Header row with Back button */}
      <header className="flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="border rounded-lg px-3 py-1 text-sm hover:bg-gray-100"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="text-sm text-gray-600">
              Session-level summaries for your recent classes.
            </p>
          </div>
        </div>
      </header>

      {/* Error message, if any */}
      {error && (
        <div className="text-sm text-red-600">
          {error}
          <div className="text-xs text-gray-600 mt-1">
            You can keep using Curriculate; reports will appear here once
            they’ve been generated for your live sessions.
          </div>
        </div>
      )}

      {/* Empty state when there are no sessions and no hard error */}
      {!error && !hasSessions && (
        <div className="border rounded-lg bg-white p-4 text-sm text-gray-700">
          <div className="font-semibold mb-1">No reports yet</div>
          <p className="mb-2">
            Run a live session, complete a task set, and finish the session.
            Once analytics are generated, your class reports will show up here.
          </p>
          <p className="text-xs text-gray-500">
            Tip: Use the{" "}
            <span className="font-semibold">Host</span> view to launch a
            task set and then end the session from the teacher controls.
          </p>
        </div>
      )}

      {/* Session list when we have data */}
      {hasSessions && (
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
                    {s.startedAt
                      ? new Date(s.startedAt).toLocaleString()
                      : "Date unknown"}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div>
                    Class avg score:{" "}
                    {s.classAverageScore != null
                      ? `${s.classAverageScore}%`
                      : "–"}
                  </div>
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
