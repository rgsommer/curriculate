// student-app/src/components/tasks/types/AIDebateJudgeTask.jsx
import React, { useState, useEffect } from "react";
import StepCircle from "../StepCircle";

export default function AIDebateJudgeTask({ task, socket, roomCode, disabled, onSubmit, presenter }) {
  const config = task?.config || {};

  // Tester (Nysa, May 2026): "no topic is ever prepared. there should be a clear
  // declaration of the topic, instructions, a 1-2-3 GO start button, and a
  // running timer with a time goal." So before the judge step we now run a
  // structured DEBATE phase: topic + sides + start + countdown.
  const topic = String(
    config.topic || config.resolution || config.postulate || config.motion || task?.prompt || ""
  ).trim();
  const affLabel = config.affirmativeLabel || config.sideA || "Affirmative";
  const negLabel = config.negativeLabel || config.sideB || "Negative";
  const goalSeconds = (() => {
    const c = Number(config.debateSeconds ?? task?.timeLimitSeconds ?? config.timeLimitSeconds);
    return Number.isFinite(c) && c > 0 ? c : 120; // default 2:00
  })();

  const [phase, setPhase] = useState("debate"); // "debate" -> "judge"
  const [started, setStarted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(goalSeconds);
  const [isJudging, setIsJudging] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [showFullFeedback, setShowFullFeedback] = useState(false);

  // If there is no room connection, the judge cannot be summoned.
  // We show a clear message so students know what is wrong.
  const notConnected = !socket || !roomCode;

  useEffect(() => {
    if (!socket) return;
    const handleVerdict = (data) => {
      setVerdict(data);
      setIsJudging(false);
      // Don't auto-submit — let students read the verdict first
    };
    socket.on("ai-judge:verdict", handleVerdict);
    return () => socket.off("ai-judge:verdict", handleVerdict);
  }, [socket, onSubmit]);

  // Debate countdown (client-side, presentational time goal).
  useEffect(() => {
    if (phase !== "debate" || !started) return;
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [phase, started, secondsLeft]);

  const fmtTime = (s) => {
    const v = Math.max(0, Math.floor(s));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  };

  const startDebate = async () => {
    if (disabled || started) return;
    try {
      await presenter?.showCountdown?.({ title: "Debate starts in…", seconds: 3, subtext: "1 — 2 — 3 — GO!" });
    } catch (e) {
      // ignore — countdown is best-effort
    }
    setStarted(true);
  };

  const triggerJudging = async () => {
    if (disabled || isJudging) return;
    if (!socket || !roomCode) return;
    // Optional: standard presenter countdown
    try {
      await presenter?.showCountdown?.({ title: "Summoning AI Judge…", mode: "video" });
    } catch (e) {
      // ignore
    }
    setIsJudging(true);
    socket.emit("ai-judge:request", { roomCode });
  };

  if (verdict) {
    return (
      <div style={{ padding: 32, fontFamily: "system-ui", maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
        <h1 className="text-6xl font-bold mb-8 text-indigo-800">AI DEBATE JUDGE VERDICT</h1>

        <div className="text-9xl mb-8">
          {verdict.winner === "affirmative" ? "Affirmative" : "Negative"}
        </div>

        <div className="text-8xl font-bold mb-12 text-green-600">
          {verdict.winner.toUpperCase()} WINS!
        </div>

        <div className="grid grid-cols-2 gap-12 text-5xl mb-16">
          <div className="bg-green-100 p-12 rounded-3xl">
            <strong>AFFIRMATIVE</strong><br />
            {verdict.scores.affirmative}/100
          </div>
          <div className="bg-red-100 p-12 rounded-3xl">
            <strong>NEGATIVE</strong><br />
            {verdict.scores.negative}/100
          </div>
        </div>

        <button
          onClick={() => setShowFullFeedback(true)}
          className="px-16 py-8 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-4xl rounded-full shadow-2xl hover:shadow-3xl transition"
        >
          Read Full Judge's Feedback
        </button>

        {showFullFeedback && (
          <div className="mt-16 bg-white p-12 rounded-3xl shadow-2xl text-left text-2xl leading-relaxed">
            <h2 className="text-4xl font-bold mb-8 text-center">Judge's Written Decision</h2>
            <div className="whitespace-pre-wrap">{verdict.feedback}</div>
          </div>
        )}

        <button
          onClick={() => onSubmit?.({ taskType: "ai-debate-judge", verdict, completed: true })}
          className="mt-12 px-20 py-8 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-4xl font-bold rounded-full shadow-2xl hover:shadow-3xl transition"
        >
          Continue →
        </button>
      </div>
    );
  }

  // ─── DEBATE PHASE: topic, sides, 1-2-3 GO start, running timer ───
  if (phase === "debate") {
    const timeUp = started && secondsLeft <= 0;
    const pct = goalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / goalSeconds) * 100)) : 0;
    return (
      <div style={{ padding: 32, textAlign: "center", maxWidth: 1000, margin: "0 auto" }}>
        <div className="text-2xl font-bold text-indigo-700 mb-2">🗣️ Debate Time</div>

        {/* Topic declaration */}
        <div
          style={{
            margin: "0 auto 20px",
            maxWidth: 900,
            borderRadius: 20,
            padding: 20,
            background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(56,189,248,0.10))",
            border: "1px solid rgba(99,102,241,0.35)",
          }}
        >
          <div className="text-lg font-bold uppercase tracking-wide text-indigo-600 mb-2">Today's Resolution</div>
          <div className="text-3xl font-extrabold text-slate-900 leading-snug">
            {topic || "Your teacher will announce the debate topic."}
          </div>
        </div>

        {/* Sides */}
        <div className="grid grid-cols-2 gap-4" style={{ maxWidth: 900, margin: "0 auto 24px" }}>
          <div style={{ borderRadius: 16, padding: 16, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)" }}>
            <div className="text-xl font-extrabold text-green-700">✅ {affLabel}</div>
            <div className="text-base text-slate-700 mt-1">Argue <b>for</b> the resolution.</div>
          </div>
          <div style={{ borderRadius: 16, padding: 16, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)" }}>
            <div className="text-xl font-extrabold text-red-700">❌ {negLabel}</div>
            <div className="text-base text-slate-700 mt-1">Argue <b>against</b> the resolution.</div>
          </div>
        </div>

        {!started ? (
          <>
            <div
              className="mx-auto mb-6 text-left"
              style={{ maxWidth: 900, borderRadius: 16, padding: 16, background: "rgba(255,255,255,0.85)", border: "1px solid rgba(15,23,42,0.12)" }}
            >
              <div className="text-xl font-bold mb-2">How this works</div>
              <div className="text-lg leading-relaxed text-gray-700">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={1} /> Each side makes its case with evidence and clear structure.</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={2} /> You have <b>{fmtTime(goalSeconds)}</b> to debate — watch the timer.</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><StepCircle n={3} /> When time's up, summon the AI Judge for a verdict.</div>
              </div>
            </div>
            <button
              onClick={startDebate}
              disabled={disabled}
              className="px-20 py-12 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-4xl font-bold rounded-full shadow-2xl hover:shadow-3xl transition disabled:opacity-50"
            >
              ▶️ Start Debate (1‑2‑3 GO!)
            </button>
          </>
        ) : (
          <>
            <div className="text-base font-bold uppercase tracking-wide text-slate-500 mb-1">
              {timeUp ? "Time!" : "Time remaining"} · Goal {fmtTime(goalSeconds)}
            </div>
            <div
              className="font-extrabold mb-4"
              style={{
                fontSize: 72,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                color: timeUp ? "#dc2626" : secondsLeft <= 15 ? "#f59e0b" : "#0f172a",
              }}
            >
              {fmtTime(secondsLeft)}
            </div>
            <div style={{ maxWidth: 700, margin: "0 auto 24px", height: 14, borderRadius: 999, background: "rgba(15,23,42,0.10)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  borderRadius: 999,
                  background: timeUp ? "#dc2626" : "linear-gradient(90deg, #22c55e, #0ea5e9)",
                  transition: "width 1s linear",
                }}
              />
            </div>
            <button
              onClick={() => setPhase("judge")}
              disabled={disabled}
              className={`px-16 py-8 text-white text-3xl font-bold rounded-full shadow-2xl transition disabled:opacity-50 ${
                timeUp
                  ? "bg-gradient-to-r from-purple-700 to-pink-700 animate-pulse"
                  : "bg-gradient-to-r from-slate-600 to-slate-700"
              }`}
            >
              {timeUp ? "⏰ Time's up — Summon the Judge ▶" : "We're done — Summon the Judge ▶"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h1 className="text-6xl font-bold mb-12 text-indigo-800">Ready for AI Judge?</h1>

      {/* Grade-7 clear instructions */}
      <div
        className="mx-auto mb-10 text-left"
        style={{
          maxWidth: 900,
          borderRadius: 18,
          padding: 18,
          background: "rgba(255,255,255,0.85)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 12px 40px rgba(15,23,42,0.08)",
        }}
      >
        <div className="text-2xl font-bold mb-3">How this works</div>
        <div className="text-xl leading-relaxed text-gray-700">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={1} /> Finish your debate first.</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={2} /> Tap <b>SUMMON AI JUDGE</b>.</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={3} /> The AI gives scores and picks a winner.</div>
          <div style={{ marginTop: 8, opacity: 0.85 }}>
            Tip: once you summon the judge, the decision is final.
          </div>
        </div>
      </div>

      <p className="text-3xl mb-16 text-gray-700">
        The AI has been listening to your entire debate.<br />
        When you're ready, summon the final verdict.
      </p>

      {notConnected && (
        <div
          className="mx-auto mb-10"
          style={{
            maxWidth: 900,
            borderRadius: 16,
            padding: 14,
            background: "rgba(239,68,68,0.10)",
            border: "1px solid rgba(239,68,68,0.28)",
            color: "rgb(153,27,27)",
            fontWeight: 900,
            fontSize: 20,
          }}
        >
          Not connected to a room — the AI Judge can't be summoned yet.
        </div>
      )}

      <button
        onClick={triggerJudging}
        disabled={isJudging || disabled || !socket || !roomCode}
        className="px-24 py-16 bg-gradient-to-r from-purple-700 to-pink-700 text-white text-5xl font-bold rounded-full shadow-2xl hover:shadow-3xl transition disabled:opacity-50"
      >
        {isJudging ? "AI IS JUDGING..." : "SUMMON AI JUDGE"}
      </button>

      {isJudging && (
        <div className="mt-16 text-4xl text-purple-600 animate-pulse">
          AI is analyzing speeches, logic, delivery, and rebuttals...
        </div>
      )}
    </div>
  );
}