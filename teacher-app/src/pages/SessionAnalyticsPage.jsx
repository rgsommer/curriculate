// teacher-app/src/pages/SessionAnalyticsPage.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import { TASK_TYPE_META } from "../../../shared/taskTypes";
import { socket } from "../socket";


function typeBadge(typeRaw) {
  const type = String(typeRaw || "").trim();
  const meta = TASK_TYPE_META?.[type] || null;

  const lower = type.toLowerCase();
  const emoji =
    lower === "mad-dash" || lower === "mad_dash" || lower === "maddash" || lower === "mad-dash-sequence" || lower === "mad_dash_sequence" || lower === "maddashsequence"
      ? "🏃‍♂️⚡"
      : lower === "pet-feeding" || lower === "pet_feeding" || lower === "petfeeding"
      ? "🐾"
      : lower === "brainstorm-battle" || lower === "brainstorm_battle" || lower === "brainstormbattle"
      ? "💡"
      : lower === "collaboration" || lower === "collab"
      ? "🤝"
      : lower === "reading-comp" || lower === "reading_comp" || lower === "readingcomp" || lower === "reading-comprehension"
      ? "📖"
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
  const [studentGrades, setStudentGrades] = useState([]);
  const [gradingConfig, setGradingConfig] = useState(null);
  const [classChatBlurb, setClassChatBlurb] = useState("");
  const [skillsDeveloped, setSkillsDeveloped] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [teamFeedback, setTeamFeedback] = useState([]);
  const [error, setError] = useState("");
  const [emailStatus, setEmailStatus] = useState(""); // "sending" | "sent" | "failed"

  const handleResendEmail = useCallback(() => {
    setEmailStatus("sending");
    socket.emit("report:retryEmail", { reportId: id });
    const onSent = () => { setEmailStatus("sent"); cleanup(); };
    const onError = (p) => { setEmailStatus(`failed: ${p?.message || "Unknown error"}`); cleanup(); };
    const cleanup = () => { socket.off("transcript:sent", onSent); socket.off("transcript:error", onError); };
    socket.on("transcript:sent", onSent);
    socket.on("transcript:error", onError);
    // Safety timeout
    setTimeout(() => { setEmailStatus((s) => s === "sending" ? "failed: timed out" : s); cleanup(); }, 60000);
  }, [id]);

  useEffect(() => {
    // Try the reports endpoint first (immutable snapshot); fall back to legacy analytics
    api
      .get(`/reports/${id}`)
      .then((res) => {
        const doc = res.data.report || res.data;
        // Map SessionReport fields to what the page expects
        setSession({
          _id: doc._id,
          classroomName: doc.className || doc.classroomName || "Class",
          taskSetName: doc.taskSetName || doc.headline || "Session",
          startedAt: doc.startedAt || doc.createdAt,
          classAverageScore: doc.classAverageScore,
          classAverageAccuracy: doc.classAverageAccuracy ?? doc.classAverageScore ?? null,
          classAverageEngagement: doc.classAverageEngagement ?? null,
          noiseSummary: doc.noiseSummary ?? null,
          tasks: doc.summary?.tasks || [],
          teams: (doc.teams || []).map((t) => ({
            ...t,
            name: t.teamName || t.name,
            score: t.scorePercent ?? Math.min(100, Math.round(Number(t.teamPoints) || 0)) ?? 0,
          })),
          sharedFromTeacherName: doc.sharedFromTeacherName || "",
          sharedFromTeacherEmail: doc.sharedFromTeacherEmail || "",
          runByPresenterName: doc.runByPresenterName || "",
          totalTasks: doc.summary?.totalTasks ?? doc.summary?.tasks?.length ?? 0,
          roomCode: doc.roomCode || "",
          planTierUsed: doc.planTierUsed || "",
        });
        setStudentAnalytics(doc.perParticipant || []);
        setStudentGrades(doc.studentGrades || []);
        setGradingConfig(doc.gradingConfig || null);
        setClassChatBlurb(doc.summary?.classChatBlurb || "");
        setSkillsDeveloped(doc.summary?.skillsDeveloped || []);
        setTeamFeedback(
          (doc.teams || [])
            .filter(
              (t) =>
                (t.exitFeedback && (t.exitFeedback.rating != null || t.exitFeedback.highlights)) ||
                (t.moodEntry && t.moodEntry.moods?.length > 0)
            )
            .map((t) => ({
              teamName: t.teamName,
              members: t.members || [],
              exitFeedback: t.exitFeedback || null,
              moodEntry: t.moodEntry || null,
            }))
        );
      })
      .catch((err) => {
        console.error("Report load error:", err);
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
            to="/reports"
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
            <strong>Class Avg Score:</strong> {Math.min(100, Math.round(Number(session.classAverageScore) || 0))}%{" "}
            &nbsp;|&nbsp;
            <strong>Accuracy:</strong> {session.classAverageAccuracy != null ? `${Math.min(100, Math.round(Number(session.classAverageAccuracy) || 0))}%` : "—"}
          </p>
          <div className="mt-3">
            <NoiseSummaryCard noiseSummary={session.noiseSummary || session.noise} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleResendEmail}
              disabled={emailStatus === "sending"}
              className="text-xs px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 disabled:opacity-50"
            >
              {emailStatus === "sending" ? "Sending…" : "Resend Email Report"}
            </button>
            {emailStatus === "sent" && <span className="text-xs text-green-600 font-medium">Email sent!</span>}
            {emailStatus.startsWith("failed") && <span className="text-xs text-red-600 font-medium">{emailStatus}</span>}
          </div>
        </div>
      </div>

      <div className="text-xs sm:text-sm space-y-1">
        <p>
          <strong>Teams:</strong> {session.teams.length}
          &nbsp;&nbsp;|&nbsp;&nbsp;
          <strong>Tasks in set:</strong> {session.totalTasks || session.tasks?.length || "—"}
        </p>
        {session.classAverageEngagement != null && (
          <p>
            <strong>Avg Engagement:</strong> {Math.min(100, Math.round(Number(session.classAverageEngagement) || 0))}%
          </p>
        )}
      </div>

      {/* Class Chat Blurb */}
      {classChatBlurb && (
        <section className="border rounded-lg overflow-hidden bg-emerald-50 border-emerald-300">
          <div className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm sm:text-base font-bold text-emerald-900">
                Class Chat Blurb
              </h2>
              <button
                className="text-[10px] sm:text-xs font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-1 rounded-full transition-colors"
                onClick={() => {
                  navigator.clipboard.writeText(classChatBlurb);
                }}
              >
                Copy
              </button>
            </div>
            <p className="text-xs sm:text-sm text-emerald-900 leading-relaxed">
              {classChatBlurb}
            </p>
          </div>
        </section>
      )}

      {/* Skills Developed */}
      {skillsDeveloped.length > 0 && (
        <section>
          <h2 className="text-base sm:text-xl font-semibold mb-2">
            Skills Developed
          </h2>
          <div className="flex flex-wrap gap-2">
            {skillsDeveloped.map((skill, idx) => (
              <span
                key={idx}
                className="inline-block px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] sm:text-xs font-semibold"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Student Exit Feedback */}
      {teamFeedback.length > 0 && (
        <section className="border rounded-lg overflow-hidden bg-purple-50 border-purple-200">
          <div className="p-3 sm:p-4">
            <h2 className="text-sm sm:text-base font-bold text-purple-900 mb-3">
              Student Feedback ({teamFeedback.length} {teamFeedback.length === 1 ? "team" : "teams"})
            </h2>
            <div className="space-y-3">
              {teamFeedback.map((t, idx) => (
                <div key={idx} className="bg-white rounded-md border border-purple-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-xs text-purple-800">{t.teamName}</span>
                    {t.members?.length > 0 && (
                      <span className="text-[10px] text-gray-500">({t.members.join(", ")})</span>
                    )}
                    {t.exitFeedback?.rating != null && (
                      <span className="ml-auto text-sm">
                        {"⭐".repeat(Math.min(5, Math.max(1, t.exitFeedback.rating)))}
                      </span>
                    )}
                  </div>
                  {t.moodEntry?.moods?.length > 0 && (
                    <p className="text-[11px] text-gray-600 mb-1">
                      <strong>Mood:</strong>{" "}
                      {t.moodEntry.moods.map((m) => ["😢","😕","😐","🙂","😄"][Math.max(0,Math.min(4,m-1))] || m).join(" ")}
                      {t.moodEntry.excitement && ` — "${t.moodEntry.excitement}"`}
                    </p>
                  )}
                  {t.exitFeedback?.highlights && (
                    <p className="text-[11px] text-gray-700 mb-1">
                      <strong>Highlights:</strong> {t.exitFeedback.highlights}
                    </p>
                  )}
                  {t.exitFeedback?.improvements && (
                    <p className="text-[11px] text-gray-700 mb-1">
                      <strong>Could improve:</strong> {t.exitFeedback.improvements}
                    </p>
                  )}
                  {t.exitFeedback?.favoriteTask && (
                    <p className="text-[11px] text-gray-700 mb-1">
                      <strong>Favorite:</strong> {t.exitFeedback.favoriteTask}
                    </p>
                  )}
                  {t.exitFeedback?.learned && (
                    <p className="text-[11px] text-gray-700">
                      <strong>Learned:</strong> {t.exitFeedback.learned}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {/* Student Grades (Gradebook) */}
      {studentGrades.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base sm:text-xl font-semibold">
              Student Grades
              {gradingConfig?.maxGrade ? (
                <span className="ml-2 text-xs sm:text-sm font-normal text-gray-500">
                  (out of {gradingConfig.maxGrade})
                </span>
              ) : null}
            </h2>
          </div>
          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] sm:text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 text-left">Student</th>
                    <th className="p-2 text-left">Team</th>
                    <th className="p-2 text-right">Points</th>
                    <th className="p-2 text-right">%</th>
                    <th className="p-2 text-right">Grade</th>
                    <th className="p-2 text-center">Letter</th>
                  </tr>
                </thead>
                <tbody>
                  {studentGrades
                    .slice()
                    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
                    .map((g, idx) => {
                      const letterColor =
                        g.letterGrade === "A"
                          ? "text-green-700 bg-green-50"
                          : g.letterGrade === "B"
                          ? "text-blue-700 bg-blue-50"
                          : g.letterGrade === "C"
                          ? "text-yellow-700 bg-yellow-50"
                          : g.letterGrade === "D"
                          ? "text-orange-700 bg-orange-50"
                          : "text-red-700 bg-red-50";
                      return (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="p-2 font-medium">{g.studentName === "Unknown" && g.teamName ? g.teamName : g.studentName}</td>
                          <td className="p-2 text-gray-600">{g.teamName || "—"}</td>
                          <td className="p-2 text-right">
                            {g.pointsEarned}/{g.pointsPossible}
                          </td>
                          <td className="p-2 text-right font-medium">{g.percent}%</td>
                          <td className="p-2 text-right font-medium">
                            {g.scaledGrade}/{g.maxGrade}
                          </td>
                          <td className="p-2 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${letterColor}`}
                            >
                              {g.letterGrade}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                {studentGrades.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 bg-gray-50 font-semibold">
                      <td className="p-2" colSpan={3}>
                        Class Average
                      </td>
                      <td className="p-2 text-right">
                        {Math.round(
                          studentGrades.reduce((s, g) => s + (g.percent ?? 0), 0) /
                            studentGrades.length
                        )}
                        %
                      </td>
                      <td className="p-2 text-right">
                        {(
                          studentGrades.reduce((s, g) => s + (g.scaledGrade ?? 0), 0) /
                          studentGrades.length
                        ).toFixed(1)}
                        /{studentGrades[0]?.maxGrade ?? 100}
                      </td>
                      <td className="p-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </section>
      )}

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
                {studentAnalytics.map((s, idx) => {
                  // Support both legacy analytics fields and perParticipant report fields
                  const name = s.studentName || s.name || "Unknown";
                  const earned = s.totalPoints ?? s.pointsEarned ?? 0;
                  const possible = s.maxPoints ?? s.pointsPossible ?? 0;
                  const accuracy = s.accuracyPct ?? s.finalPercent ?? (possible > 0 ? Math.round((earned / possible) * 100) : 0);
                  const completed = s.tasksCompleted ?? (s.taskIndices ? (Array.isArray(s.taskIndices) ? s.taskIndices.length : (s.taskIndices.size ?? 0)) : s.attempts ?? 0);
                  const assigned = s.tasksAssigned ?? session?.totalTasks ?? 0;
                  const latency = s.avgLatencyMs;
                  return (
                    <tr
                      key={s._id || idx}
                      className="border-t cursor-pointer hover:bg-gray-50"
                      onClick={() => setSelectedStudent(s)}
                    >
                      <td className="p-2">{name}</td>
                      <td className="p-2 text-right">
                        {earned}/{possible}
                      </td>
                      <td className="p-2 text-right">
                        {accuracy}%
                      </td>
                      <td className="p-2 text-right">
                        {completed}/{assigned}
                      </td>
                      <td className="p-2 text-right">
                        {latency != null && Number.isFinite(latency) ? `${Math.round(latency)} ms` : "—"}
                      </td>
                    </tr>
                  );
                })}
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
                  {selectedStudent.studentName || selectedStudent.name || "Unknown"} –{" "}
                  {selectedStudent.accuracyPct ?? selectedStudent.finalPercent ?? 0}%
                </h3>
                <button
                  className="text-xs text-gray-600"
                  onClick={() => setSelectedStudent(null)}
                >
                  Close
                </button>
              </div>
              <p className="text-[11px] sm:text-xs mb-2">
                Total Points: {selectedStudent.totalPoints ?? selectedStudent.pointsEarned ?? 0}/
                {selectedStudent.maxPoints ?? selectedStudent.pointsPossible ?? 0} &nbsp;|&nbsp; Tasks:{" "}
                {selectedStudent.tasksCompleted ?? selectedStudent.attempts ?? 0}/
                {selectedStudent.tasksAssigned ?? session?.totalTasks ?? 0}
                {selectedStudent.avgLatencyMs != null && Number.isFinite(selectedStudent.avgLatencyMs) ? <> &nbsp;|&nbsp; Avg time: {Math.round(selectedStudent.avgLatencyMs)} ms</> : null}
              </p>
              <h4 className="font-semibold mb-1 text-xs sm:text-sm">
                Task Transcript
              </h4>
              <ul className="text-[11px] sm:text-xs space-y-1">
                {(selectedStudent.perTask || []).map((pt, idx) => (
                  <li key={idx}>
                    <strong>{idx + 1}.</strong>{" "}
                    <span className="uppercase text-[9px] text-gray-500 mr-1">
                      [{pt.type}]
                    </span>
                    {pt.prompt} –{" "}
                    <span
                      className={
                        pt.skipped
                          ? "text-amber-600"
                          : pt.isCorrect == null
                          ? "text-slate-600"
                          : pt.isCorrect
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {pt.skipped ? "Skipped" : pt.isCorrect == null ? "Completed" : pt.isCorrect ? "Correct" : "Incorrect"}
                    </span>
                    {pt.skipped && pt.skipReason && (
                      <span className="ml-1 text-[10px] text-amber-500 italic">
                        — "{pt.skipReason}"
                      </span>
                    )}{" "}
                    ({pt.points != null ? `${pt.points} pts` : "—"}, 
                    {(() => {
                      const t = String(pt.type || "").toLowerCase().replace(/_/g, "-");
                      if (t !== "reading-comp" && t !== "readingcomp" && t !== "reading-comprehension") return null;
                      const d = (pt.details && typeof pt.details === "object" ? pt.details : {}) || {};
                      const rc = (d.readingComp && typeof d.readingComp === "object" ? d.readingComp : d) || {};
                      const lvl = String(rc.comparison || rc.gradeComparison || rc.levelComparison || "").toLowerCase();
                      const norm = lvl.startsWith("below") ? "below" : lvl.startsWith("above") ? "above" : lvl.startsWith("at") ? "at" : "";
                      return norm ? <span className="ml-1 text-slate-600">• Level: {norm}</span> : null;
                    })()}
                    {" "}{pt.latencyMs != null ? `${Math.round(pt.latencyMs)} ms` : "—"})
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
