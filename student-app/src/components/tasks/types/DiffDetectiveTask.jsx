// student-app/src/components/tasks/types/DiffDetectiveTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function DiffDetectiveTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  isMultiplayer = false, // Race mode banner only – logic comes from TaskRunner
  raceStatus, // { leader, timeLeft, players }
}) {
  const [answer, setAnswer] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef(null);

  const differences = task?.differences || [];
  const numExpected = differences.length;

  // --- Load draft from parent (when task changes / saved draft exists) ---
  useEffect(() => {
    if (typeof answerDraft === "string") {
      setAnswer(answerDraft);
    }
  }, [answerDraft, task?.id]);

  // --- Push draft back up so TaskRunner can persist between re-renders ---
  useEffect(() => {
    if (onAnswerChange && answer !== answerDraft) {
      onAnswerChange(answer);
    }
  }, [answer, answerDraft, onAnswerChange]);

  // --- Clean up speech recognition on unmount ---
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // --- Voice Dictation (Web Speech API) ---
  const startDictation = () => {
    if (typeof window === "undefined") return;

    const hasWebkit = "webkitSpeechRecognition" in window;
    const hasStandard = "SpeechRecognition" in window;

    if (!hasWebkit && !hasStandard) {
      alert("Sorry, voice dictation is not supported on this browser.");
      return;
    }

    const SpeechRecognition =
      window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      setAnswer((prev) => (prev + " " + transcript).trimStart());
    };

    recognition.onerror = () => {
      setIsDictating(false);
    };
    recognition.onend = () => {
      setIsDictating(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsDictating(true);
  };

  const stopDictation = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsDictating(false);
  };

  const handleSubmit = () => {
    if (!answer.trim() || disabled || isSubmitted) return;
    setAttempts((a) => a + 1);
    setIsSubmitted(true);
    if (typeof onSubmit === "function") {
      onSubmit(answer.trim());
    }
  };

  // --- Highlight helpers ---
  const escapeRegExp = (str) =>
    str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightText = (text = "", isModified = false) => {
    if (!isSubmitted || !differences.length || !text) {
      return (
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
      );
    }

    let highlighted = text;

    differences.forEach((diff) => {
      if (!diff || !diff.expected) return;

      const parts = String(diff.expected).split("→");
      if (parts.length < 2) return;

      const original = parts[0].trim();
      const changed = parts[1].trim();

      try {
        if (isModified && changed && text.includes(changed)) {
          const pattern = new RegExp(escapeRegExp(changed), "gi");
          highlighted = highlighted.replace(
            pattern,
            `<mark style="background:#fecaca; padding:0 4px; border-radius:4px;">${changed}</mark>`
          );
        } else if (!isModified && original && text.includes(original)) {
          const pattern = new RegExp(escapeRegExp(original), "gi");
          highlighted = highlighted.replace(
            pattern,
            `<mark style="background:#bbf7d0; padding:0 4px; border-radius:4px;">${original}</mark>`
          );
        }
      } catch {
        // If regex fails for some reason, just bail out gracefully
      }
    });

    return (
      <pre
        style={{ whiteSpace: "pre-wrap", margin: 0 }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  };

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Multiplayer Race Header (driven by TaskRunner props) */}
      {isMultiplayer && raceStatus && (
        <div
          style={{
            background: "#1e293b",
            color: "white",
            padding: 12,
            borderRadius: 12,
            textAlign: "center",
            marginBottom: 16,
            fontWeight: 700,
          }}
        >
          RACE MODE • {raceStatus.timeLeft ?? "–"}s left • Leader:{" "}
          {raceStatus.leader || "Nobody yet"}
        </div>
      )}

      <h2
        style={{
          fontWeight: 700,
          fontSize: "1.2rem",
          marginBottom: 16,
        }}
      >
        {task?.prompt ||
          `Find the ${numExpected} difference${
            numExpected === 1 ? "" : "s"
          }!`}
      </h2>

      {/* Passages with Highlights After Submit */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#f8fafc",
            padding: 16,
            borderRadius: 12,
            border: "2px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              marginBottom: 8,
              color: "#16a34a",
            }}
          >
            Original
          </div>
          {highlightText(task?.original, false)}
        </div>
        <div
          style={{
            background: "#fef2f2",
            padding: 16,
            borderRadius: 12,
            border: "2px solid #fca5a5",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              marginBottom: 8,
              color: "#dc2626",
            }}
          >
            Modified
          </div>
          {highlightText(task?.modified, true)}
        </div>
      </div>

      {/* Answer Input + Voice Button */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 8,
            alignItems: "center",
          }}
        >
          <label style={{ fontWeight: 600 }}>Your Answer:</label>
          <button
            type="button"
            onClick={isDictating ? stopDictation : startDictation}
            disabled={disabled || isSubmitted}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: isDictating ? "#ef4444" : "#10b981",
              color: "white",
              border: "none",
              fontSize: "0.8rem",
              cursor:
                disabled || isSubmitted ? "not-allowed" : "pointer",
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
          placeholder='Speak or type: “jumps was changed to jumped”, “206 to 208”…'
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "2px solid #cbd5e1",
            fontSize: "0.95rem",
            background: disabled || isSubmitted ? "#f3f4f6" : "white",
            resize: "vertical",
          }}
        />
      </div>

      {/* Hint */}
      {differences.some((d) => d?.hint) && !isSubmitted && (
        <button
          type="button"
          onClick={() => setShowHint(true)}
          disabled={disabled || showHint}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            background: showHint ? "#94a3b8" : "#f59e0b",
            color: "white",
            border: "none",
            marginBottom: 12,
            cursor:
              disabled || showHint ? "not-allowed" : "pointer",
          }}
        >
          Hint (-2 pts)
        </button>
      )}

      {showHint && (
        <div
          style={{
            background: "#fffbeb",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fbbf24",
            marginBottom: 16,
            fontSize: "0.9rem",
          }}
        >
          {differences.map(
            (d, i) =>
              d?.hint && (
                <div key={i}>• Hint {i + 1}: {d.hint}</div>
              )
          )}
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !answer.trim() || isSubmitted}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 999,
          background: isSubmitted
            ? "#10b981"
            : !answer.trim()
            ? "#94a3b8"
            : "#0ea5e9",
          color: "white",
          fontWeight: 700,
          fontSize: "1rem",
          border: "none",
          cursor:
            isSubmitted || !answer.trim() ? "not-allowed" : "pointer",
        }}
      >
        {isSubmitted
          ? "Submitted – Waiting for others..."
          : "Submit Answer"}
      </button>

      {isSubmitted && (
        <div
          style={{
            textAlign: "center",
            marginTop: 12,
            fontSize: "0.9rem",
            color: "#16a34a",
            fontWeight: 600,
          }}
        >
          Answer locked! Highlights shown above.
        </div>
      )}
    </div>
  );
}
