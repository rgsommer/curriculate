// student-app/src/components/tasks/types/AIDebateJudgeTask.jsx
import React, { useState, useEffect } from "react";

export default function AIDebateJudgeTask({ task, socket, roomCode, disabled, onSubmit, presenter }) {
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
      // optional: bubble up to parent for reporting
      onSubmit?.({ taskType: "ai-debate-judge", verdict: data, completed: true });
    };
    socket.on("ai-judge:verdict", handleVerdict);
    return () => socket.off("ai-judge:verdict", handleVerdict);
  }, [socket, onSubmit]);

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
          <div>1) Finish your debate first.</div>
          <div>2) Tap <b>SUMMON AI JUDGE</b>.</div>
          <div>3) The AI gives scores and picks a winner.</div>
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