// student-app/src/components/tasks/types/SpeechRecognitionTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function SpeechRecognitionTask({
  task,
  onSubmit,
  disabled = false,
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);

  const targetText = task.referenceText || task.prompt;
  const language = task.language || "en-US";

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("Speech recognition not supported in this browser. Try Chrome/Edge.");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      setTranscript(interim);
      if (final) {
        setFinalTranscript(prev => prev + " " + final);
      }
    };

    recognition.onerror = (event) => {
      setError("Speech recognition error: " + event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [language]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript("");
      setError("");
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleSubmit = () => {
    if (!finalTranscript.trim()) return;

    onSubmit({
      spokenText: finalTranscript.trim(),
      referenceText: targetText,
      language: task.language || "English",
      taskType: "speech-recognition",
    });

    setSubmitted(true);
  };

  const fullText = (finalTranscript + " " + transcript).trim();

  return (
    <div style={{
      padding: "24px",
      maxWidth: "700px",
      margin: "0 auto",
      fontFamily: "system-ui, -apple-system, sans-serif",
      background: "#f8fafc",
      borderRadius: "16px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
    }}>
      <h2 style={{ textAlign: "center", fontSize: "1.8rem", fontWeight: 700, marginBottom: "20px" }}>
        Speak Your Answer
      </h2>

      {/* Instructions */}
      <div style={{
        background: "#fef3c7",
        padding: "16px",
        borderRadius: "12px",
        border: "2px solid #f59e0b",
        marginBottom: "24px",
        textAlign: "center",
        fontSize: "1.1rem"
      }}>
        {task.prompt || "Read the sentence aloud clearly. AI will listen and score you!"}
      </div>

      {/* Reference Text (if reading aloud) */}
      {targetText && (
        <div style={{
          background: "#ecfdf5",
          padding: "20px",
          borderRadius: "16px",
          border: "3px solid #34d399",
          marginBottom: "24px",
          fontSize: "1.4rem",
          lineHeight: "1.8",
          textAlign: "center",
          fontWeight: 500
        }}>
          "{targetText}"
        </div>
      )}

      {/* Live Transcript */}
      <div style={{
        minHeight: "100px",
        padding: "16px",
        background: "white",
        borderRadius: "12px",
        border: "2px solid #e2e8f0",
        marginBottom: "24px",
        fontSize: "1.2rem",
        lineHeight: "1.6",
        whiteSpace: "pre-wrap"
      }}>
        {fullText || (
          <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
            Click the microphone and start speaking...
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: "#dc2626", textAlign: "center", marginBottom: "16px", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Microphone Button */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <button
          onClick={toggleListening}
          disabled={disabled || submitted}
          style={{
            width: "120px",
            height: "120px",
            borderRadius: "50%",
            background: isListening ? "#ef4444" : submitted ? "#10b981" : "#3b82f6",
            color: "white",
            border: "none",
            fontSize: "3rem",
            boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
            cursor: disabled || submitted ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            animation: isListening ? "pulse 1.5s infinite" : "none"
          }}
        >
          {isListening ? "Stop" : submitted ? "Checkmark" : "Microphone"}
        </button>
        {isListening && <p style={{ marginTop: "12px", fontWeight: 700, color: "#dc2626" }}>Listening...</p>}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!fullText.trim() || submitted || disabled}
        style={{
          width: "100%",
          padding: "16px",
          borderRadius: "999px",
          background: (!fullText.trim() || submitted) ? "#94a3b8" : "#8b5cf6",
          color: "white",
          fontSize: "1.2rem",
          fontWeight: 700,
          border: "none",
          cursor: (!fullText.trim() || submitted) ? "not-allowed" : "pointer",
          boxShadow: "0 8px 25px rgba(139,92,246,0.4)"
        }}
      >
        {submitted ? "Submitted – Scoring Your Speech..." : "Submit & Score My Answer"}
      </button>

      <style jsx>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
}