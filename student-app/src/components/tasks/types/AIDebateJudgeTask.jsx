// student-app/src/components/tasks/types/AIDebateJudgeTask.jsx
import React, { useState, useEffect } from "react";
import TaskInstructions from "../TaskInstructions";
import { useServerEventTimeout } from "../useServerEventTimeout.js";

export default function AIDebateJudgeTask({ task, socket, roomCode, disabled, onSubmit, presenter }) {
  const config = task?.config || {};

  // This task uses dark Tailwind text (text-slate-900, text-gray-700, …) that
  // assumes a LIGHT page. The student app theme is often DARK, which made the
  // topic prompt "black on dark" and the judge's feedback "white on white"
  // (tester report). We render every screen on an explicit light surface so the
  // dark text is always legible regardless of the surrounding theme.
  const lightSurface = {
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: 24,
    boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
    margin: "0 auto",
    maxWidth: 1040,
    width: "100%",
  };

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
  const [liveStuck, setLiveStuck] = useState(false);
  const [showFullFeedback, setShowFullFeedback] = useState(false);
  // Key arguments captured for each side so the AI judge has real content to
  // evaluate (the debate itself is spoken/in-person). Without these the judge
  // falls back to a generic verdict.
  const [affArgs, setAffArgs] = useState("");
  const [negArgs, setNegArgs] = useState("");

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

  // ── P1 safety: don't sit forever waiting on the AI verdict ────────────
  // After SUMMON we set isJudging=true and wait on the "ai-judge:verdict"
  // socket event. If it never arrives (WiFi drop, dropped event, no server
  // orchestrating), the button is disabled and there's no way forward.
  // Re-request the verdict once, then surface a clear "Continue".
  useServerEventTimeout({
    armed: isJudging && !verdict && !liveStuck,
    timeoutMs: 30000,
    onTimeout: () => {
      try {
        socket?.emit?.("ai-judge:request", {
          roomCode,
          topic,
          affirmative: affArgs,
          negative: negArgs,
        });
      } catch { /* noop */ }
      setLiveStuck(true);
    },
  });
  // Clear the stuck flag once the verdict actually arrives (waiting ends).
  useEffect(() => {
    if ((verdict || !isJudging) && liveStuck) setLiveStuck(false);
  }, [verdict, isJudging]); // eslint-disable-line react-hooks/exhaustive-deps

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
    socket.emit("ai-judge:request", {
      roomCode,
      topic,
      affirmative: affArgs,
      negative: negArgs,
    });
  };

  if (verdict) {
    return (
      <div style={{ ...lightSurface, padding: 32, fontFamily: "system-ui", textAlign: "center" }}>
        <h1 className="text-6xl font-bold mb-8 text-indigo-800">AI DEBATE JUDGE VERDICT</h1>

        <div className="text-9xl mb-8">
          {verdict.winner === "affirmative" ? "Affirmative" : "Negative"}
        </div>

        <div className="text-8xl font-bold mb-12 text-green-600">
          {verdict.winner.toUpperCase()} WINS!
        </div>

        <div className="grid grid-cols-2 gap-12 text-5xl mb-16">
          <div className="bg-green-100 p-12 rounded-3xl text-slate-900">
            <strong>AFFIRMATIVE</strong><br />
            {verdict.scores.affirmative}/100
          </div>
          <div className="bg-red-100 p-12 rounded-3xl text-slate-900">
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
          <div className="mt-16 bg-white p-12 rounded-3xl shadow-2xl text-left text-2xl leading-relaxed" style={{ color: "#0f172a" }}>
            <h2 className="text-4xl font-bold mb-8 text-center" style={{ color: "#0f172a" }}>Judge's Written Decision</h2>
            <div className="whitespace-pre-wrap" style={{ color: "#1e293b" }}>
              {verdict.feedback || "The judge did not return written feedback. Scores and the winner are shown above."}
            </div>
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
      <div style={{ ...lightSurface, padding: 32, textAlign: "center" }}>
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
            <TaskInstructions
              label="How this works"
              style={{ maxWidth: 900, margin: "0 auto 24px" }}
              steps={[
                "Each side makes its case with evidence and clear structure.",
                <>You have <b>{fmtTime(goalSeconds)}</b> to debate — watch the timer.</>,
                "When time's up, summon the AI Judge for a verdict.",
              ]}
            />
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
    <div style={{ ...lightSurface, padding: 40, textAlign: "center" }}>
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
        <TaskInstructions
          label="How this works"
          style={{ background: "transparent", border: "none", padding: 0 }}
          steps={[
            "Finish your debate first.",
            <>Tap <b>SUMMON AI JUDGE</b>.</>,
            "The AI gives scores and picks a winner.",
          ]}
        />
        <div style={{ marginTop: 8, opacity: 0.85 }}>
          Tip: once you summon the judge, the decision is final.
        </div>
      </div>

      <p className="text-2xl mb-6 text-gray-700">
        Enter each side's <b>key arguments</b> below so the judge can weigh them,
        then summon the verdict.
      </p>

      {/* Per-side argument capture — gives the AI real content to judge. */}
      <div className="grid grid-cols-2 gap-6 mx-auto mb-10" style={{ maxWidth: 980 }}>
        <div style={{ borderRadius: 16, padding: 14, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.35)" }}>
          <div className="text-2xl font-extrabold text-green-700 mb-2">✅ {affLabel}</div>
          <textarea
            value={affArgs}
            onChange={(e) => setAffArgs(e.target.value)}
            disabled={disabled}
            rows={5}
            placeholder="Type the Affirmative side's strongest points (evidence, reasons, rebuttals)…"
            className="w-full rounded-xl border border-green-300 p-3 text-lg bg-white text-slate-900 placeholder:text-slate-400 outline-none resize-none"
          />
        </div>
        <div style={{ borderRadius: 16, padding: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.30)" }}>
          <div className="text-2xl font-extrabold text-red-700 mb-2">❌ {negLabel}</div>
          <textarea
            value={negArgs}
            onChange={(e) => setNegArgs(e.target.value)}
            disabled={disabled}
            rows={5}
            placeholder="Type the Negative side's strongest points (evidence, reasons, rebuttals)…"
            className="w-full rounded-xl border border-red-300 p-3 text-lg bg-white text-slate-900 placeholder:text-slate-400 outline-none resize-none"
          />
        </div>
      </div>

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

      {isJudging && liveStuck && (
        <div style={{ textAlign: "center", padding: "20px 16px" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Waiting for your teacher…</div>
          <div style={{ opacity: 0.75, fontSize: "0.9rem", marginBottom: 14 }}>This is taking longer than usual — you can keep going.</div>
          <button
            type="button"
            onClick={() => { try { onSubmit?.({ skipped: true, reason: "ai-debate-judge-timeout" }); } catch { /* noop */ } }}
            style={{ padding: "11px 24px", borderRadius: 999, border: "none", fontWeight: 800, background: "linear-gradient(135deg,#fb923c,#ea580c)", color: "#fff", cursor: "pointer" }}
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}