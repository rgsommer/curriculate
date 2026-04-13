// student-app/src/components/tasks/types/LetterTask.jsx
import React, { useState, useMemo, useEffect } from "react";
import { API_BASE_URL } from "../../../config.js";

export default function LetterTask({
  task,
  onSubmit,
  disabled,
  answered,
  onAnswerChange,
  answerDraft,
  roomCode,
  teamId,
}) {
  const isDisabled = disabled || answered;

  const cfg = task?.config || {};
  const character = cfg.character || "Unknown";
  const charDesc = cfg.characterDescription || "";
  const letterStyle = cfg.letterStyle || "friendly";
  const topicContext = cfg.topicContext || "";
  const relevantConcepts = Array.isArray(cfg.relevantConcepts) ? cfg.relevantConcepts : [];

  // Grade-scaled word target: 20 × grade level
  const gradeLevel = parseInt(task?.gradeLevel || task?.config?.gradeLevel || task?.settings?.gradeLevel || "7", 10);
  const minWords = gradeLevel * 20;

  const [value, setValue] = useState(answerDraft?.response || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiReply, setAiReply] = useState(null);
  const [loadingReply, setLoadingReply] = useState(false);
  const [replyError, setReplyError] = useState(false);
  const [conceptsFound, setConceptsFound] = useState([]);

  const wordCount = useMemo(() => {
    const trimmed = String(value || "").trim();
    return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  }, [value]);

  const meetsMin = wordCount >= minWords;

  // Detect relevant concepts in the text
  const matchedConcepts = useMemo(() => {
    const lower = String(value || "").toLowerCase();
    return relevantConcepts.filter((c) =>
      lower.includes(String(c).toLowerCase())
    );
  }, [value, relevantConcepts]);

  // Emit draft to parent
  useEffect(() => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false,
      response: value,
      wordCount,
      minWords,
      conceptsUsed: matchedConcepts.length,
      totalConcepts: relevantConcepts.length,
    });
  }, [value, wordCount]);

  const basePoints = task?.points || 10;

  const handleSubmit = async () => {
    if (isDisabled || !meetsMin) return;
    setIsSubmitting(true);

    // Play celebration sound
    try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}

    setConceptsFound(matchedConcepts);

    // Submit to parent for scoring
    const payload = {
      type: "letter",
      correct: false,
      basePoints,
      response: value,
      wordCount,
      minWords,
      conceptsUsed: matchedConcepts.length,
      totalConcepts: relevantConcepts.length,
      character,
      letterStyle,
    };
    onSubmit?.(payload);

    // Request AI reply
    setLoadingReply(true);
    setReplyError(false);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(`${API_BASE_URL}/api/evaluate/letter-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          studentLetter: value,
          character,
          characterDescription: charDesc,
          letterStyle,
          topicContext,
          gradeLevel,
          relevantConcepts,
        }),
      });
      clearTimeout(timeout);
      const data = await res.json();
      setAiReply(data.reply || "Thank you for your letter! I enjoyed reading it.");
    } catch {
      setReplyError(true);
      setAiReply(
        `Dear student,\n\nThank you for writing to me! I received your thoughtful letter about ${topicContext || "this topic"}. ` +
        `Keep asking great questions and exploring history!\n\nSincerely,\n${character}`
      );
    } finally {
      setLoadingReply(false);
    }
  };

  const styleBadge = letterStyle === "business"
    ? { label: "Business Letter", color: "#1e40af", bg: "#dbeafe" }
    : { label: "Friendly Letter", color: "#166534", bg: "#dcfce7" };

  // ── REPLY VIEW (after submission) ──
  if (aiReply || loadingReply) {
    return (
      <div style={{ padding: 4 }}>
        {/* Student's sent letter (collapsed summary) */}
        <div style={{
          padding: "10px 14px",
          background: "#f1f5f9",
          borderRadius: 12,
          fontSize: 13,
          color: "#475569",
          marginBottom: 14,
          maxHeight: 120,
          overflow: "auto",
        }}>
          <strong>Your letter to {character}:</strong>
          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{value}</div>
        </div>

        {/* Concepts found badge */}
        {conceptsFound.length > 0 && (
          <div style={{
            padding: "8px 12px",
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 600,
          }}>
            ⭐ You included {conceptsFound.length}/{relevantConcepts.length} key concepts:{" "}
            {conceptsFound.join(", ")}
          </div>
        )}

        {/* AI reply */}
        {loadingReply ? (
          <div style={{
            textAlign: "center",
            padding: "32px 16px",
            background: "rgba(255,255,255,0.9)",
            borderRadius: 16,
            border: "1px solid #e2e8f0",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, animation: "pulse 1.5s infinite" }}>✉️</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
              {character} is writing back...
            </div>
            <style>{`@keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.6; transform:scale(1.1); } }`}</style>
          </div>
        ) : (
          <div style={{
            padding: "16px 18px",
            background: letterStyle === "business"
              ? "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)"
              : "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
            borderRadius: 16,
            border: `1px solid ${letterStyle === "business" ? "#93c5fd" : "#86efac"}`,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: styleBadge.color,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              📬 Reply from {character}
            </div>
            <div style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: "#1e293b",
              whiteSpace: "pre-wrap",
              fontFamily: letterStyle === "business"
                ? "'Georgia', serif"
                : "system-ui, sans-serif",
            }}>
              {aiReply}
            </div>
            {replyError && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
                (Auto-generated reply — live AI was unavailable)
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── WRITING VIEW ──
  return (
    <div style={{ padding: 4 }}>
      {/* Character intro card */}
      <div style={{
        padding: "14px 16px",
        background: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)",
        borderRadius: 14,
        border: "1px solid #fde68a",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#92400e", marginBottom: 4 }}>
          ✍️ Write a letter to {character}
        </div>
        {charDesc && (
          <div style={{ fontSize: 13, color: "#78350f", marginBottom: 6 }}>
            {charDesc}
          </div>
        )}
        <div style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          background: styleBadge.bg,
          color: styleBadge.color,
          fontSize: 12,
          fontWeight: 700,
        }}>
          {styleBadge.label}
        </div>
      </div>

      {/* Topic context */}
      {topicContext && (
        <div style={{
          fontSize: 13,
          color: "#475569",
          marginBottom: 10,
          padding: "8px 12px",
          background: "#f8fafc",
          borderRadius: 8,
          borderLeft: "3px solid #3b82f6",
        }}>
          {topicContext}
        </div>
      )}

      {/* Relevant concepts hint */}
      {relevantConcepts.length > 0 && (
        <div style={{
          fontSize: 12,
          color: "#64748b",
          marginBottom: 10,
          padding: "6px 10px",
          background: "#fffbeb",
          borderRadius: 8,
          border: "1px solid #fde68a",
        }}>
          <strong>Bonus points</strong> for using these concepts:{" "}
          {relevantConcepts.map((c, i) => (
            <span key={i} style={{
              fontWeight: matchedConcepts.includes(c) ? 700 : 400,
              color: matchedConcepts.includes(c) ? "#16a34a" : "#64748b",
              textDecoration: matchedConcepts.includes(c) ? "none" : "none",
            }}>
              {c}{i < relevantConcepts.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}

      {/* Text area */}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isDisabled}
        placeholder={
          letterStyle === "business"
            ? `Dear ${character},\n\nI am writing to you regarding...`
            : `Dear ${character},\n\nI wanted to write to you because...`
        }
        rows={8}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #d1d5db",
          fontSize: 15,
          lineHeight: 1.6,
          fontFamily: letterStyle === "business"
            ? "'Georgia', serif"
            : "system-ui, sans-serif",
          resize: "vertical",
          color: "#1e293b",
          background: "#fff",
          minHeight: 180,
        }}
      />

      {/* Word count + concept count */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8,
        fontSize: 13,
      }}>
        <span style={{
          color: meetsMin ? "#16a34a" : wordCount > 0 ? "#d97706" : "#94a3b8",
          fontWeight: 600,
        }}>
          {wordCount}/{minWords} words {meetsMin ? "✓" : ""}
        </span>
        {matchedConcepts.length > 0 && (
          <span style={{ color: "#16a34a", fontWeight: 600 }}>
            ⭐ {matchedConcepts.length}/{relevantConcepts.length} concepts
          </span>
        )}
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={isDisabled || !meetsMin || isSubmitting}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "12px 0",
          borderRadius: 12,
          border: "none",
          background: !meetsMin ? "#94a3b8" : isSubmitting ? "#93c5fd" : "#3b82f6",
          color: "#fff",
          fontSize: 16,
          fontWeight: 700,
          cursor: !meetsMin || isDisabled ? "default" : "pointer",
          opacity: isSubmitting ? 0.7 : 1,
          transition: "all 0.2s",
        }}
      >
        {isSubmitting ? "Sending your letter..." : !meetsMin ? `Write at least ${minWords} words` : "Send Letter ✉️"}
      </button>
    </div>
  );
}
