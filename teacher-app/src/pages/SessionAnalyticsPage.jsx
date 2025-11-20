// src/pages/SessionAnalyticsPage.jsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";

export default function SessionAnalyticsPage() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [studentAnalytics, setStudentAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/analytics/sessions/${id}`)
      .then((res) => {
        setSession(res.data.sessionAnalytics);
        setStudentAnalytics(res.data.studentAnalytics || []);
      })
      .catch((err) => {
        console.error(err);
        setError(err.response?.data?.error || "Unable to load session.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-4">Loading session analytics…</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!session) return <div className="p-4">Session not found.</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/analytics" className="text-xs text-blue-600 underline">
            ← Back to Analytics
          </Link>
          <h1 className="text-2xl font-bold mt-1">{session.classroomName}</h1>
          <p className="text-sm text-gray-600">
            {session.taskSetName} –{" "}
            {new Date(session.startedAt).toLocaleString()}
          </p>
          <p className="mt-2 text-sm">
            <strong>Class Avg Score:</strong> {session.classAverageScore}%{" "}
            &nbsp;|&nbsp;
            <strong>Accuracy:</strong> {session.classAverageAccuracy}%
          </p>
        </div>
      </div>

      {/* Task breakdown */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Task Breakdown</h2>
        <div className="border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Prompt</th>
                <th className="p-2 text-right">Avg Score</th>
                <th className="p-2 text-right">Accuracy</th>
                <th className="p-2 text-right">Submissions</th>
              </tr>
            </thead>
            <tbody>
              {session.tasks.map((t, idx) => (
                <tr key={t.taskId} className="border-t">
                  <td className="p-2 align-top">{idx + 1}</td>
                  <td className="p-2 align-top">
                    <span className="uppercase text-[10px] text-gray-500 mr-1">
                      [{t.type}]
                    </span>
                    {t.prompt}
                  </td>
                  <td className="p-2 align-top text-right">{t.avgScore}%</td>
                  <td className="p-2 align-top text-right">
                    {t.avgCorrectPct}%
                  </td>
                  <td className="p-2 align-top text-right">
                    {t.submissionsCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Student summaries */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Student Performance</h2>
        <div className="border rounded-lg bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 text-left">Student</th>
                <th className="p-2 text-right">Score</th>
                <th className="p-2 text-right">Accuracy</th>
                <th className="p-2 text-right">Tasks</th>
                <th className="p-2 text-right">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {studentAnalytics.map((s) => (
                <tr
                  key={s._id}
                  className="border-t cursor-pointer hover:bg-gray-50"
                  onClick={() => setSelectedStudent(s)}
                >
                  <td className="p-2">{s.studentName}</td>
                  <td className="p-2 text-right">
                    {s.totalPoints}/{s.maxPoints}
                  </td>
                  <td className="p-2 text-right">{s.accuracyPct}%</td>
                  <td className="p-2 text-right">
                    {s.tasksCompleted}/{s.tasksAssigned}
                  </td>
                  <td className="p-2 text-right">
                    {Math.round(s.avgLatencyMs)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Student transcript modal */}
        {selectedStudent && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-xl w-full max-h-[80vh] overflow-auto p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">
                  {selectedStudent.studentName} –{" "}
                  {selectedStudent.accuracyPct}%
                </h3>
                <button
                  className="text-xs text-gray-600"
                  onClick={() => setSelectedStudent(null)}
                >
                  Close
                </button>
              </div>
              <p className="text-xs mb-2">
                Total Points: {selectedStudent.totalPoints}/
                {selectedStudent.maxPoints} &nbsp;|&nbsp; Tasks:{" "}
                {selectedStudent.tasksCompleted}/
                {selectedStudent.tasksAssigned} &nbsp;|&nbsp; Avg time:{" "}
                {Math.round(selectedStudent.avgLatencyMs)} ms
              </p>
              <h4 className="font-semibold mb-1 text-sm">Task Transcript</h4>
              <ul className="text-xs space-y-1">
                {selectedStudent.perTask.map((pt, idx) => (
                  <li key={idx}>
                    <strong>{idx + 1}.</strong>{" "}
                    <span className="uppercase text-[9px] text-gray-500 mr-1">
                      [{pt.type}]
                    </span>
                    {pt.prompt} –{" "}
                    <span
                      className={
                        pt.isCorrect ? "text-green-600" : "text-red-600"
                      }
                    >
                      {pt.isCorrect ? "Correct" : "Incorrect"}
                    </span>{" "}
                    ({pt.points} pts, {Math.round(pt.latencyMs)} ms)
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
