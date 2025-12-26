// student-app/src/components/tasks/types/OpenTextTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Open-text response task.
 * - Large text box that can fill the task card space
 * - Optional speech-to-text helper
 * - Optional minimum word requirement (for medium/hard)
 *
 * Expected task shape (typical):
 * {
 *   taskType: "open-text",
 *   prompt: "...",
 *   settings: {
 *     gradeLevel: 8,
 *     difficulty: "easy"|"medium"|"hard",
 *     minWords: 16,           // optional; if omitted we compute from grade+difficulty
 *     language: "en-US"       // optional speech recognition language
 *   }
 * }
 */
export default function OpenTextTask({
  task,
  onSubmit,
  // legacy prop name in some callers:
  answered,
  // preferred prop name in TaskRunner:
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const initial = useMemo(() => {
    if (
      answerDraft &&
      typeof answerDraft === "object" &&
      typeof answerDraft.response === "string"
    ) {
      return answerDraft.response;
    }
    if (typeof answerDraft === "string") return answerDraft;
    return "";
  }, [answerDraft]);

  const [value, setValue] = useState(initial);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const isDisabled = !!disabled || !!answered;

  const basePoints = task?.points || 0;

  const gradeLevel = Number(
    task?.settings?.gradeLevel ?? task?.gradeLevel ?? task?.config?.gradeLevel
  );
  const difficultyRaw = String(
    task?.settings?.difficulty ??
      task?.difficulty ??
      task?.config?.difficulty ??
      "easy"
  ).toLowerCase();

  const computedMinWords = useMemo(() => {
    // If backend provides a value, use it.
    const explicit = Number(task?.settings?.minWords ?? task?.config?.minWords);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);

    // Otherwise compute:
    // - medium: 2 words per grade level
    // - hard:   3 words per grade level
    // - easy:   no minimum
    const g = Number.isFinite(gradeLevel) && gradeLevel > 0 ? gradeLevel : 8;
    if (difficultyRaw === "hard") return 3 * g;
    if (difficultyRaw === "medium") return 2 * g;
    return 0;
  }, [task?.settings?.minWords, task?.config?.minWords, gradeLevel, difficultyRaw]);

  const wordCount = useMemo(() => {
    const t = String(value || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }, [value]);

  const meetsMin = computedMinWords <= 0 ? true : wordCount >= computedMinWords;

  // reset when a new task comes in or answerDraft changes
  useEffect(() => {
    setValue(initial);
  }, [task?._id, task?.id, task?.prompt, initial]);

  const emitDraft = (textValue) => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false, // AI-scored elsewhere
      basePoints,
      response: textValue,
      wordCount: String(textValue || "").trim()
        ? String(textValue).trim().split(/\s+/).filter(Boolean).length
        : 0,
      minWords: computedMinWords || 0,
    });
  };

  const handleSubmitClick = () => {
    if (isDisabled) return;
    if (!meetsMin) return;

    const payload = {
      type: task?.taskType || task?.type || "open-text",
      correct: false, // AI-scored elsewhere
      basePoints,
      response: value,
      wordCount,
      minWords: computedMinWords || 0,
    };

    onSubmit?.(payload);

    // Clear after submit (keeps UI consistent with other tasks)
    setValue("");
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setValue(next);
    emitDraft(next);
  };

  const startListening = () => {
    if (isDisabled) return;
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
      for (let i = 0; i < event.results.length; i += 1) {
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

  return (
    <div
      className="flex flex-col h-full p-3 gap-3"
      style={{ opacity: isDisabled ? 0.75 : 1 }}
    >
      <div
        className="rounded-2xl shadow-md flex flex-col h-full"
        style={{
          background: "linear-gradient(135deg, #eff6ff, #e0f2fe)",
          padding: 16,
        }}
      >
        <header
          style={{
            background: "rgba(37,99,235,0.9)",
            color: "#f9fafb",
            padding: "10px 14px",
            borderRadius: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>
            Open-text Response
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            {task?.title || "Explain your thinking"}
          </div>
          {!!task?.prompt && (
            <div
              style={{
                marginTop: 8,
                fontSize: "0.95rem",
                fontWeight: 600,
                lineHeight: 1.25,
              }}
            >
              {task.prompt}
            </div>
          )}
        </header>

        {task?.mediaUrl && (
          <img
            src={task.mediaUrl}
            alt=""
            style={{
              maxWidth: "100%",
              borderRadius: 12,
              marginBottom: 10,
            }}
          />
        )}

        {/* Toolbar: mic + live word count */}
        <div
          className="flex items-center justify-between gap-2"
          style={{
            marginBottom: 8,
            padding: "8px 10px",
            borderRadius: 14,
            border: "1px solid rgba(15,23,42,0.10)",
            background: "rgba(255,255,255,0.85)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
              Write a full response
            </span>

            {computedMinWords > 0 && (
              <span
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: "1px solid rgba(15,23,42,0.12)",
                  background: meetsMin
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(249,115,22,0.12)",
                  color: "#0f172a",
                  fontWeight: 700,
                }}
                title="Minimum word requirement"
              >
                {wordCount}/{computedMinWords} words
              </span>
            )}

            {computedMinWords <= 0 && (
              <span
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: "1px solid rgba(15,23,42,0.12)",
                  background: "rgba(14,165,233,0.10)",
                  color: "#0f172a",
                  fontWeight: 700,
                }}
                title="Word counter"
              >
                {wordCount} words
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={isDisabled}
            style={{
              fontSize: 13,
              padding: "6px 12px",
              borderRadius: 9999,
              border: "none",
              cursor: isDisabled ? "not-allowed" : "pointer",
              backgroundColor: isDisabled
                ? "#cbd5e1"
                : isListening
                ? "#dc2626"
                : "#2563eb",
              color: "#fff",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
            title="Speech-to-text (browser support required)"
          >
            {isListening ? "Stop 🎤" : "Speak 🎤"}
          </button>
        </div>

        <textarea
          value={value}
          onChange={handleChange}
          placeholder={
            isDisabled
              ? "Submitted. Waiting for next task…"
              : "Type a thoughtful response…"
          }
          disabled={isDisabled}
          className="border rounded-xl p-3 w-full flex-1 resize-none text-sm"
          style={{
            borderColor: "rgba(148,163,184,0.8)",
            background: isDisabled ? "#f1f5f9" : "#ffffff",
            minHeight: 160,
            lineHeight: 1.35,
          }}
        />

        {computedMinWords > 0 && !meetsMin && !isDisabled && (
          <div
            style={{ marginTop: 8, fontSize: 12, color: "#b45309", fontWeight: 700 }}
          >
            Keep going — aim for at least {computedMinWords} words.
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={isDisabled || !String(value || "").trim() || !meetsMin}
            className="border rounded-full px-4 py-2 disabled:opacity-50"
            style={{
              background:
                isDisabled || !String(value || "").trim() || !meetsMin
                  ? "#9ca3af"
                  : "#16a34a",
              color: "#fff",
              fontWeight: 800,
              paddingInline: 20,
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            {isDisabled ? "Submitted" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
