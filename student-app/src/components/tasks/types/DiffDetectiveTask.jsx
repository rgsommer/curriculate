// student-app/src/components/tasks/types/DiffDetectiveTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function DiffDetectiveTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  isMultiplayer = false,        // NEW: race mode
  raceStatus,                   // { leader, timeLeft, players }
}) {
  const [answer, setAnswer] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef(null);

  const differences = task.differences || [];
  const numExpected = differences.length;

  // Load draft
  useEffect(() => {
    if (answerDraft && typeof answerDraft === "string") setAnswer(answerDraft);
  }, [answerDraft]);

  // Push draft
  useEffect(() => {
    if (onAnswerChange && answer !== answerDraft) {
      onAnswerChange(answer);
    }
  }, [answer]);

  // Voice Dictation (Web Speech API) – works great on Chrome/Edge mobile
  const startDictation = () => {
    if (!("webkitSpeechRecognition" in window) && !"SpeechRecognition" in window) {
      alert("Sorry, voice dictation not supported on this browser");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join("");
      setAnswer(prev => prev + " " + transcript);
    };

    recognition.onerror = () => setIsDictating(false);
    recognition.onend = () => setIsDictating(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsDictating(true);
  };

  const stopDictation = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsDictating(false);
    }
  };

  const handleSubmit = () => {
    if (!answer.trim() || disabled || isSubmitted) return;
    setAttempts(a => a + 1);
    setIsSubmitted(true);
    onSubmit(answer.trim());
  };

  // Highlight function
  const highlightText = (text, isModified = false) => {
    if (!isSubmitted || !differences.length) return <pre>{text}</pre>;

    let highlighted = text;
    differences.forEach(diff => {
      const parts = diff.expected.split("→");
      if (parts.length < 2) return;

      const original = parts[0].trim();
      const changed = parts[1].trim();

      if (isModified && text.includes(changed)) {
        highlighted = highlighted.replace(
          new RegExp(changed, "gi"),
          `<mark style="background:#fecaca; padding:0 4px; border-radius:4px;">${changed}</mark>`
        );
      } else if (!isModified && text.includes(original)) {
        highlighted = highlighted.replace(
          new RegExp(original, "gi"),
          `<mark style="background:#bbf7d0; padding:0 4px; border-radius:4px;">${original}</mark>`
        );
      }
    });

    return <pre dangerouslySetInnerHTML={{ __html: highlighted }} style={{ whiteSpace: "pre-wrap" }} />;
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      {/* Multiplayer Race Header */}
      {isMultiplayer && raceStatus && (
        <div style={{
          background: "#1e293b",
          color: "white",
          padding: 12,
          borderRadius: 12,
          textAlign: "center",
          marginBottom: 16,
          fontWeight: 700
        }}>
          RACE MODE • {raceStatus.timeLeft}s left • Leader: {raceStatus.leader || "Nobody yet"}
        </div>
      )}

      <h2 style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 16 }}>
        {task.prompt || `Find the ${numExpected} difference${numExpected > 1 ? "s" : ""}!`}
      </h2>

      {/* Passages with Highlights After Submit */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 12, border: "2px solid #e2e8f0" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: "#16a34a" }}>Original</div>
          {highlightText(task.original, false)}
        </div>
        <div style={{ background: "#fef2f2", padding: 16, borderRadius: 12, border: "2px solid #fca5a5" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: "#dc2626" }}>Modified</div>
          {highlightText(task.modified, true)}
        </div>
      </div>

      {/* Answer Input + Voice Button */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <label style={{ fontWeight: 600 }}>Your Answer:</label>
          <button
            onClick={isDictating ? stopDictation : startDictation}
            disabled={disabled || isSubmitted}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: isDictating ? "#ef4444" : "#10b981",
              color: "white",
              border: "none",
              fontSize: "0.8rem"
            }}
          >
            {isDictating ? "Stop Talking" : "Speak Answer"}
          </button>
        </div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={disabled || isSubmitted}
          rows={6}
          placeholder="Speak or type: “jumps was changed to jumped”, “206 to 208”..."
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "2px solid #cbd5e1",
            fontSize: "0.95rem",
            background: disabled || isSubmitted ? "#f3f4f6" : "white"
          }}
        />
      </div>

      {/* Hint */}
      {differences.some(d => d.hint) && !isSubmitted && (
        <button
          onClick={() => setShowHint(true)}
          disabled={disabled || showHint}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            background: showHint ? "#94a3b8" : "#f59e0b",
            color: "white",
            border: "none",
            marginBottom: 12
          }}
        >
          Hint (-2 pts)
        </button>
      )}

      {showHint && (
        <div style={{ background: "#fffbeb", padding: 12, borderRadius: 12, border: "1px solid #fbbf24", marginBottom: 16 }}>
          {differences.map((d, i) => d.hint && <div key={i}>• Hint {i + 1}: {d.hint}</div>)}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={disabled || !answer.trim() || isSubmitted}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 999,
          background: isSubmitted ? "#10b981" : (!answer.trim() ? "#94a3b8" : "#0ea5e9"),
          color: "white",
          fontWeight: 700,
          fontSize: "1rem",
          border: "none",
          cursor: isSubmitted || !answer.trim() ? "not-allowed" : "pointer"
        }}
      >
        {isSubmitted ? "Submitted – Waiting for others..." : "Submit Answer"}
      </button>

      {isSubmitted && (
        <div style={{ textAlign: "center", marginTop: 12, fontSize: "0.9rem", color: "#16a34a", fontWeight: 600 }}>
          Answer locked! Highlights shown above.
        </div>
      )}
    </div>
  );
}