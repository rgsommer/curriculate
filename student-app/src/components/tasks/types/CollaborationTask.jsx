// student-app/src/components/tasks/types/CollaborationTask.jsx
import React, { useState, useEffect } from "react";
import { TaskCardFrame, Pill, PrimaryButton, TextArea } from "../taskStyles";

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

  const prompt = task?.prompt || "Work together on this prompt.";

  const right = showPartnerReply ? (
    <Pill theme="light">✨ Bonus reply stage</Pill>
  ) : (
    <Pill theme="light">📝 Write your response</Pill>
  );

  return (
    <TaskCardFrame
      theme="light"
      badge="🤝 Collaboration"
      title="Partner prompt"
      subtitle={showPartnerReply ? "Read your partner’s response and reply thoughtfully." : "Write your best response first."}
      right={right}
    >
      <div style={{ fontSize: 18, fontWeight: 950, color: "rgba(15,23,42,0.90)" }}>
        {prompt}
      </div>

      {!showPartnerReply ? (
        <>
          <div style={{ marginTop: 12 }}>
            <TextArea
              theme="light"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                onAnswerChange?.({ main: e.target.value, reply });
              }}
              disabled={disabled}
              rows={8}
              placeholder="Write your response here…"
            />
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <PrimaryButton
              onClick={handleMainSubmit}
              disabled={disabled || !answer.trim()}
            >
              Submit My Answer
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              marginTop: 14,
              borderRadius: 22,
              border: "1px solid rgba(168,85,247,0.28)",
              background:
                "radial-gradient(700px 260px at 20% 0%, rgba(168,85,247,0.16), transparent 60%), rgba(255,255,255,0.78)",
              boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Pill theme="light">💬 Partner response</Pill>
              <Pill theme="light" subtle>Read carefully, then reply for bonus points.</Pill>
            </div>
            <div style={{ marginTop: 10, fontStyle: "italic", fontWeight: 900, color: "rgba(15,23,42,0.86)" }}>
              {partnerAnswer || "(No partner answer received.)"}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <TextArea
              theme="light"
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                onAnswerChange?.({ main: answer, reply: e.target.value });
              }}
              disabled={disabled}
              rows={6}
              placeholder="Write a thoughtful reply… (earn up to +5 bonus points!)"
            />
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <Pill theme="light">⭐ +5 bonus points possible</Pill>
            <PrimaryButton
              onClick={handleReplySubmit}
              disabled={disabled || !reply.trim()}
              style={{
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.96), rgba(56,189,248,0.76))",
              }}
            >
              Send Reply &amp; Claim Bonus
            </PrimaryButton>
          </div>
        </>
      )}
    </TaskCardFrame>
  );
}
