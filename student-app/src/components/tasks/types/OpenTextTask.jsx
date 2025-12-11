// student-app/src/components/tasks/types/OpenTextTask.jsx
import React, { useEffect, useRef, useState } from "react";

export default function OpenTextTask({
  task,
  onSubmit,
  answered,
  onAnswerChange,
  answerDraft,
}) {
  const [value, setValue] = useState(answerDraft ?? "");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const basePoints = task.points || 0;

  // reset when a new task comes in or answerDraft changes
  useEffect(() => {
    setValue(answerDraft ?? "");
  }, [task?.prompt, task?.id, answerDraft]);

  const emitDraft = (textValue) => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false, // manual review / AI scoring elsewhere
      basePoints,
      response: textValue,
    });
  };

  const handleClick = () => {
    if (answered) return; // don’t double-submit
    const payload = {
      correct: false, // manual review
      basePoints,
      response: value,
    };
    onSubmit && onSubmit(payload);
    setValue(""); // clear after submit
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setValue(next);
    emitDraft(next);
  };

  const startListening = () => {
    if (answered) return;
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = task?.settings?.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) {
        spoken += event.results[i][0].transcript + " ";
      }
      const text = spoken.trim();
      if (!text) return;

      const current = value || "";
      const newText = (current ? current + " " : "") + text;

      setValue(newText);
      emitDraft(newText);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const micDisabled = answered;

  return (
    <div style={{ marginTop: 16, opacity: answered ? 0.7 : 1 }}>
      <h3>{task.prompt}</h3>

      {task.mediaUrl && (
        <img
          src={task.mediaUrl}
          alt=""
          style={{ maxWidth: "100%", marginTop: 10 }}
        />
      )}

      {/* Toolbar with mic */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginTop: 12,
          marginBottom: 4,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: "#64748b",
          }}
        >
          Type your answer, or use the mic:
        </span>
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={micDisabled}
          style={{
            fontSize: 13,
            padding: "4px 10px",
            borderRadius: 9999,
            border: "none",
            cursor: micDisabled ? "not-allowed" : "pointer",
            backgroundColor: micDisabled
              ? "#cbd5e1"
              : isListening
              ? "#dc2626"
              : "#2563eb",
            color: "#fff",
          }}
        >
          {isListening ? "Stop listening" : "🎤 Speak"}
        </button>
      </div>

      <textarea
        value={value}
        onChange={handleChange}
        placeholder={
          answered
            ? "Submitted. Waiting for next task…"
            : "Type your answer…"
        }
        disabled={answered}
        style={{
          width: "100%",
          minHeight: 90,
          marginTop: 4,
          padding: 6,
          background: answered ? "#f1f5f9" : "#fff",
        }}
      />

      <button
        onClick={handleClick}
        disabled={answered}
        style={{
          marginTop: 10,
          background: answered ? "#cbd5e1" : "#2563eb",
          color: answered ? "#475569" : "#fff",
          border: "none",
          padding: "6px 12px",
          borderRadius: 6,
          cursor: answered ? "not-allowed" : "pointer",
        }}
      >
        {answered ? "Submitted" : "Submit"}
      </button>
    </div>
  );
}
