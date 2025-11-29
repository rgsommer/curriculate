// student-app/src/components/tasks/types/CollaborationTask.jsx
import React, { useState, useEffect } from "react";

export default function CollaborationTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  partnerAnswer,        // ← injected by TaskRunner when ready
  showPartnerReply,     // ← true when it's time to reply
  onPartnerReply,       // ← submit reply for bonus
}) {
  const [answer, setAnswer] = useState(answerDraft?.main || "");
  const [reply, setReply] = useState(answerDraft?.reply || "");

  useEffect(() => {
    setAnswer(answerDraft?.main || "");
    setReply(answerDraft?.reply || "");
  }, [task?.id, answerDraft]);

  const handleMainSubmit = () => {
    if (disabled || !answer.trim()) return;
    onSubmit({ main: answer.trim() });
  };

  const handleReplySubmit = () => {
    if (disabled || !reply.trim()) return;
    onPartnerReply(reply.trim());
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="font-semibold text-lg">{task.prompt}</div>

      {!showPartnerReply ? (
        <>
          <textarea
            className="border rounded-lg p-3 flex-1 resize-none"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              onAnswerChange?.({ main: e.target.value, reply });
            }}
            disabled={disabled}
            placeholder="Write your response here..."
          />
          <button
            onClick={handleMainSubmit}
            disabled={disabled || !answer.trim()}
            className="px-5 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            Submit My Answer
          </button>
        </>
      ) : (
        <>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h3 className="font-bold text-purple-900 mb-2">Your Partner's Response:</h3>
            <p className="italic text-gray-800">{partnerAnswer}</p>
          </div>

          <textarea
            className="border rounded-lg p-3 flex-1 resize-none"
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              onAnswerChange?.({ main: answer, reply: e.target.value });
            }}
            disabled={disabled}
            placeholder="Write a thoughtful reply to your partner... (earn up to +5 bonus points!)"
          />

          <div className="flex justify-between items-center">
            <button
              onClick={handleReplySubmit}
              disabled={disabled || !reply.trim()}
              className="px-5 py-2 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              Send Reply & Claim Bonus
            </button>
            <span className="text-sm text-purple-700 font-medium">
              +5 bonus points possible
            </span>
          </div>
        </>
      )}
    </div>
  );
}