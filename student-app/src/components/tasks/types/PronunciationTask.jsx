// student-app/src/components/tasks/types/PronunciationTask.jsx
import React, { useState, useRef } from "react";

const ACCENT_FLAGS = {
  american: "US",
  british: "GB",
  australian: "AU",
  canadian: "CA",
  neutral: "International",
};

export default function PronunciationTask({ task, onSubmit, disabled }) {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [selectedAccent, setSelectedAccent] = useState(task.targetAccent || "american");

  const mediaRecorderRef = useRef(null);
  const chunks = useRef([]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    
    mediaRecorderRef.current.ondataavailable = (e) => chunks.current.push(e.data);
    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      chunks.current = [];
    };

    mediaRecorderRef.current.start();
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleSubmit = () => {
    if (!audioUrl) return;
    onSubmit({
      audioUrl,
      referenceText: task.referenceText,
      targetAccent: selectedAccent,
      language: task.language || "English"
    });
    setSubmitted(true);
  };

  return (
    <div style={{ padding: 20, textAlign: "center", fontFamily: "system-ui", maxWidth: 600, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 16, fontSize: "1.5rem", fontWeight: 700 }}>
        Pronunciation Practice
      </h2>

      {/* Accent Selector */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ marginBottom: 12, fontWeight: 600 }}>Choose your target accent:</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          {task.accentOptions?.map(accent => (
            <button
              key={accent}
              onClick={() => setSelectedAccent(accent)}
              disabled={submitted}
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                border: selectedAccent === accent ? "3px solid #8b5cf6" : "2px solid #e2e8f0",
                background: selectedAccent === accent ? "#f3e8ff" : "white",
                fontWeight: selectedAccent === accent ? 700 : 500,
                fontSize: "1rem",
                cursor: submitted ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8
              }}
            >
              <span style={{ fontSize: "1.4rem" }}>{ACCENT_FLAGS[accent]}</span>
              {accent.charAt(0).toUpperCase() + accent.slice(1)} English
            </button>
          ))}
        </div>
      </div>

      {/* Reference Sentence */}
      <div style={{
        background: "#fefce8",
        padding: 24,
        borderRadius: 16,
        border: "2px solid #fde047",
        marginBottom: 24,
        fontSize: "1.4rem",
        lineHeight: 1.6,
        fontWeight: 500
      }}>
        "{task.referenceText}"
      </div>

      {task.phonetic && (
        <div style={{ fontSize: "1.1rem", color: "#d97706", marginBottom: 20, fontStyle: "italic" }}>
          Guide: {task.phonetic}
        </div>
      )}

      {/* Recording UI */}
      <div style={{ marginBottom: 32 }}>
        {!audioUrl ? (
          <button
            onClick={recording ? stopRecording : startRecording}
            style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              fontSize: "2rem",
              background: recording ? "#ef4444" : "#10b981",
              color: "white",
              border: "none",
              boxShadow: "0 8px 25px rgba(0,0,0,0.2)",
              cursor: "pointer"
            }}
          >
            {recording ? "Stop" : "Record"}
          </button>
        ) : (
          <div>
            <audio controls src={audioUrl} style={{ width: "100%", maxWidth: 400 }} />
            <button onClick={() => { setAudioUrl(null); chunks.current = []; }} style={{ marginTop: 8, color: "#dc2626" }}>
              Re-record
            </button>
          </div>
        )}
        {recording && <p style={{ marginTop: 16, fontWeight: 600, color: "#dc2626" }}>Recording... Speak clearly!</p>}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!audioUrl || submitted || disabled}
        style={{
          padding: "14px 40px",
          borderRadius: 999,
          background: (!audioUrl || submitted) ? "#94a3b8" : "#8b5cf6",
          color: "white",
          fontWeight: 700,
          fontSize: "1.2rem",
          border: "none",
          cursor: (!audioUrl || submitted) ? "not-allowed" : "pointer",
          boxShadow: "0 6px 20px rgba(139,92,246,0.4)"
        }}
      >
        {submitted ? "Submitted – Analyzing..." : "Submit & Get Accent Score"}
      </button>
    </div>
  );
}