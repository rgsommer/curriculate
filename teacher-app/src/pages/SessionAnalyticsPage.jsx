// teacher-app/src/pages/SessionAnalyticsPage.jsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import { TASK_TYPE_META } from "../../../shared/taskTypes";


function typeBadge(typeRaw) {
  const type = String(typeRaw || "").trim();
  const meta = TASK_TYPE_META?.[type] || null;

  const lower = type.toLowerCase();
  const emoji =
    lower === "pet-feeding" || lower === "pet_feeding" || lower === "petfeeding"
      ? "🐾"
      : lower === "brainstorm-battle" || lower === "brainstorm_battle" || lower === "brainstormbattle"
      ? "💡"
      : lower === "collaboration" || lower === "collab"
      ? "🤝"
      : lower === "live-debate" || lower === "live_debate" || lower === "livedebate"
      ? "🗣️"
      : lower.includes("debate")
      ? "🗣️"
      : lower.includes("brain")
      ? "🧠"
      : lower.includes("hangman")
      ? "🪢"
      : lower.includes("mood")
      ? "🙂"
      : lower.includes("pronunciation") || lower.includes("speech")
      ? "🎙️"
      : "🧩";

  const label = meta?.label || type;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200 text-[11px] font-semibold">
      <span aria-hidden="true">{emoji}</span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}


function NoiseSummaryCard({ noiseSummary }) {
  const ns = noiseSummary && typeof noiseSummary === "object" ? noiseSummary : null;
  if (!ns) return null;

  const enabled = !!ns.enabled;
  const thr = Number.isFinite(Number(ns.threshold)) ? Number(ns.threshold) : 0;
  const avg = Number.isFinite(Number(ns.avgLevel)) ? Number(ns.avgLevel) : null;
  const peak = Number.isFinite(Number(ns.peakLevel)) ? Number(ns.peakLevel) : null;
  const pctOver = Number.isFinite(Number(ns.pctOverThreshold)) ? Number(ns.pctOverThreshold) : null;
  const samplesCount = Number.isFinite(Number(ns.samplesCount)) ? Number(ns.samplesCount) : null;

  const hasAny = enabled || thr > 0 || avg != null || peak != null || pctOver != null || (samplesCount != null && samplesCount > 0);
  if (!hasAny) return null;

  const mode = !enabled ? "Off" : thr < 40 ? "Strict" : thr < 70 ? "Normal" : "Lenient";
  const gaugeVal = avg != null ? avg : peak != null ? peak : 0;

  return (
    <section className="border rounded-lg bg-white p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm sm:text-base font-semibold">Noise &amp; Focus</div>
          <div className="text-[11px] sm:text-xs text-gray-600">
            Mode: <strong>{mode}</strong>{enabled ? "" : " (disabled)"} {thr > 0 ? ` • Threshold ${Math.round(thr)}/100` : ""}
          </div>
        </div>
        <div className="text-right text-[11px] sm:text-xs text-gray-700">
          {avg != null && <div>Avg: {Math.round(avg)}/100</div>}
          {peak != null && <div>Peak: {Math.round(peak)}/100</div>}
          {pctOver != null && thr > 0 && <div>Over thr: {pctOver}%</div>}
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-2 bg-sky-400"
            style={{ width: `${Math.max(0, Math.min(100, gaugeVal))}%` }}
          />
        </div>
        {enabled && thr > 0 && (
          <div className="relative h-0">
            <div
              className="absolute -top-2 w-[2px] h-6 bg-red-500/80"
              style={{ left: `${Math.max(0, Math.min(100, thr))}%` }}
            />
          </div>
        )}
        {samplesCount != null && (
          <div className="mt-2 text-[11px] sm:text-xs text-gray-500">
            Samples: {samplesCount}
          </div>
        )}
      </div>
    </section>
  );
}

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
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <Link
            to="/analytics"
            className="text-xs text-blue-600 underline inline-block mb-1"
          >
            ← Back to Analytics
          </Link>
          <h1 className="text-lg sm:text-2xl font-bold mt-1">
            {session.classroomName}
          </h1>
          <p className="text-xs sm:text-sm text-gray-600">
            {session.taskSetName} –{" "}
            {new Date(session.startedAt).toLocaleString()}
          </p>
          {(session.sharedFromTeacherName || session.sharedFromTeacherEmail || session.runByPresenterName) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {(session.sharedFromTeacherName || session.sharedFromTeacherEmail) && (
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                  TaskSet from {session.sharedFromTeacherName || session.sharedFromTeacherEmail}
                </span>
              )}
              {session.runByPresenterName && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Presented by {session.runByPresenterName}
                </span>
              )}
            </div>
          )}
          <p className="mt-2 text-xs sm:text-sm">
            <strong>Class Avg Score:</strong> {session.classAverageScore}%{" "}
            &nbsp;|&nbsp;
            <strong>Accuracy:</strong> {session.classAverageAccuracy != null ? `${session.classAverageAccuracy}%` : "—"}
          </p>
          <div className="mt-3">
            <NoiseSummaryCard noiseSummary={session.noiseSummary || session.noise} />
          </div>
        </div>
      </div>

      <div className="text-xs sm:text-sm space-y-1">
        <p>
          Tasks Completed: {session.totalTasks} → {session.completedTasks} (
          {Math.round(
            (session.completedTasks / session.totalTasks) * 100
          )}
          %)
        </p>
        <p>
          Fastest Average Response:{" "}
          {Math.min(
            ...session.teams.map((t) => t.avgResponseTime || 999)
          ).toFixed(1)}
          s
        </p>
        <p>
          Perfect Task Rate:{" "}
          {(
            (session.teams.reduce(
              (s, t) => s + t.perfectTasks,
              0
            ) /
              session.completedTasks) *
            100
          ).toFixed(1)}
          %
        </p>
      </div>

      {/* Task breakdown */}
      <section>
        <h2 className="text-base sm:text-xl font-semibold mb-2">
          Task Breakdown
        </h2>
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] sm:text-xs">
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
                    <td className="p-2 align-top max-w-xs sm:max-w-none">
                      {typeBadge(t.type)}
                      {t.prompt}
                    </td>
                    <td className="p-2 align-top text-right">
                      {t.avgScore != null ? `${t.avgScore}%` : "—"}
                    </td>
                    <td className="p-2 align-top text-right">
                      {t.avgCorrectPct != null ? `${t.avgCorrectPct}%` : "—"}
                    </td>
                    <td className="p-2 align-top text-right">
                      {t.submissionsCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Student summaries */}
      <section>
        <h2 className="text-base sm:text-xl font-semibold mb-2">
          Student Performance
        </h2>
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] sm:text-xs">
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
                    <td className="p-2 text-right">
                      {s.accuracyPct}%
                    </td>
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
        </div>

        {/* Student transcript modal */}
        {selectedStudent && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-xl w-full max-h-[80vh] overflow-auto p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-base sm:text-lg font-semibold">
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
              <p className="text-[11px] sm:text-xs mb-2">
                Total Points: {selectedStudent.totalPoints}/
                {selectedStudent.maxPoints} &nbsp;|&nbsp; Tasks:{" "}
                {selectedStudent.tasksCompleted}/
                {selectedStudent.tasksAssigned} &nbsp;|&nbsp; Avg time:{" "}
                {Math.round(selectedStudent.avgLatencyMs)} ms
              </p>
              <h4 className="font-semibold mb-1 text-xs sm:text-sm">
                Task Transcript
              </h4>
              <ul className="text-[11px] sm:text-xs space-y-1">
                {selectedStudent.perTask.map((pt, idx) => (
                  <li key={idx}>
                    <strong>{idx + 1}.</strong>{" "}
                    <span className="uppercase text-[9px] text-gray-500 mr-1">
                      [{pt.type}]
                    </span>
                    {pt.prompt} –{" "}
                    <span
                      className={
                        pt.isCorrect == null
                          ? "text-slate-600"
                          : pt.isCorrect
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {pt.isCorrect == null ? "Completed" : pt.isCorrect ? "Correct" : "Incorrect"}
                    </span>{" "}
                    ({pt.points != null ? `${pt.points} pts` : "—"}, {pt.latencyMs != null ? `${Math.round(pt.latencyMs)} ms` : "—"})
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
