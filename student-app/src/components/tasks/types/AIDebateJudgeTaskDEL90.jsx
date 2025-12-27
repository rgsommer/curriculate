// student-app/src/components/tasks/types/AIDebateJudgeTask.jsx
import React, { useState, useEffect } from "react";

export default function AIDebateJudgeTask({ task, socket, roomCode }) {
  const [isJudging, setIsJudging] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [showFullFeedback, setShowFullFeedback] = useState(false);

  useEffect(() => {
    socket.on("ai-judge:verdict", (data) => {
      setVerdict(data);
      setIsJudging(false);
    });
    return () => socket.off("ai-judge:verdict");
  }, [socket]);

  const triggerJudging = () => {
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
          Read Full Judge’s Feedback
        </button>

        {showFullFeedback && (
          <div className="mt-16 bg-white p-12 rounded-3xl shadow-2xl text-left text-2xl leading-relaxed">
            <h2 className="text-4xl font-bold mb-8 text-center">Judge’s Written Decision</h2>
            <div className="whitespace-pre-wrap">{verdict.feedback}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h1 className="text-6xl font-bold mb-12 text-indigo-800">Ready for AI Judge?</h1>
      <p className="text-3xl mb-16 text-gray-700">
        The AI has been listening to your entire debate.<br />
        When you're ready, summon the final verdict.
      </p>

      <button
        onClick={triggerJudging}
        disabled={isJudging}
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