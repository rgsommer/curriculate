// student-app/src/components/tasks/types/PronunciationTask.jsx
import React, { useState, useRef } from "react";
import { API_BASE_URL } from "../../../config.js";

const ACCENT_FLAGS = {
  american: "US",
  british: "GB",
  australian: "AU",
  canadian: "CA",
  neutral: "International",
};

export default function PronunciationTask({ task, onSubmit, disabled }) {
  const safeTask = task || {};
  const language = safeTask.language || "English";

  // Accent options: always include american; merge with any task-specified options.
  const rawOptions = Array.isArray(safeTask.accentOptions) && safeTask.accentOptions.length
    ? safeTask.accentOptions.map((a) => String(a).toLowerCase())
    : ["american", "british", "canadian", "australian", "neutral"];
  // Guarantee "american" is always available (students' most natural accent)
  const accentOptions = rawOptions.includes("american") ? rawOptions : ["american", ...rawOptions];

  // Provide a readable reference sentence even if the generator forgot.
  const referenceTextRaw =
    safeTask.referenceText ||
    safeTask.prompt ||
    safeTask.sentence ||
    safeTask.phrase ||
    safeTask.text ||
    "";

  const fallbackReference = (() => {
    // Keep this stable and classroom-friendly.
    const topicHint = String(safeTask.topic || safeTask.unit || safeTask.title || "").trim();
    if (topicHint) {
      return `Today we are learning about ${topicHint}. Please say this sentence clearly.`;
    }
    return "Please read this sentence clearly and naturally.";
  })();

  const referenceText = String(referenceTextRaw || fallbackReference).trim();

  const initialAccent =
    safeTask.targetAccent && accentOptions.includes(String(safeTask.targetAccent).toLowerCase())
      ? String(safeTask.targetAccent).toLowerCase()
      : (accentOptions.includes("american") ? "american" : accentOptions[0]);

  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [selectedAccent, setSelectedAccent] = useState(initialAccent);
  const [errorMsg, setErrorMsg] = useState(null);
  // AI response shown BEFORE advancing (tester: "did not see the AI response").
  const [feedbackPhase, setFeedbackPhase] = useState("idle"); // idle | scoring | feedback
  const [aiFeedback, setAiFeedback] = useState("");
  const [transcript, setTranscript] = useState("");

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunks = useRef([]);
  const audioBlobRef = useRef(null);
  const pendingSubmitRef = useRef(null);

  const safeStopStream = () => {
    try {
      const s = streamRef.current;
      if (s && s.getTracks) s.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
  };

  const startRecording = async () => {
    if (disabled || submitted) return;
    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e?.data && e.data.size > 0) chunks.current.push(e.data);
      };

      mr.onstop = () => {
        try {
          const blob = new Blob(chunks.current, { type: "audio/webm" });
          audioBlobRef.current = blob;
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        } catch (e) {
          setErrorMsg("Could not finalize audio. Please try again.");
        } finally {
          chunks.current = [];
          safeStopStream();
        }
      };

      mr.start();
      setRecording(true);
    } catch (e) {
      setRecording(false);
      safeStopStream();

      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("permission") || msg.includes("denied")) {
        setErrorMsg("Microphone permission denied. Please allow mic access and try again.");
      } else {
        setErrorMsg("Could not access the microphone. Please try again.");
      }
    }
  };

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop?.();
    } catch {}
    setRecording(false);
  };

  const handleSubmit = () => {
    if (disabled || submitted) return;
    if (!audioUrl) return;

    setSubmitted(true);

    // Stash the submission; fire it only after the student reads the AI response.
    pendingSubmitRef.current = {
      type: safeTask.taskType || safeTask.type || "pronunciation",
      audioUrl,
      referenceText,
      targetAccent: selectedAccent,
      language,
      phonetic: safeTask.phonetic || null,
      accentOptions,
    };

    setFeedbackPhase("scoring");
    (async () => {
      let said = "";
      // 1) Transcribe what they said (Whisper).
      try {
        const blob = audioBlobRef.current;
        if (blob) {
          const form = new FormData();
          form.append("audio", blob, "pronunciation.webm");
          form.append("language", "en");
          const r = await fetch(`${API_BASE_URL}/api/speech/transcribe`, { method: "POST", body: form });
          const j = r.ok ? await r.json().catch(() => null) : null;
          said = j?.transcript ? String(j.transcript).trim() : "";
        }
      } catch { /* ignore */ }
      if (said) setTranscript(said);
      pendingSubmitRef.current = { ...pendingSubmitRef.current, transcript: said };

      // 2) Coach feedback comparing what they said to the reference.
      let coach = "";
      try {
        const r = await fetch(`${API_BASE_URL}/api/text-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "pronunciation",
            prompt: `A student read this sentence aloud in a ${accentLabel(selectedAccent).nice} accent and we transcribed it. Compare what they SAID to the TARGET. Praise what matched, then point out any words that were dropped/mispronounced and how to say them. Keep it warm and 2-3 sentences.`,
            context: `TARGET: "${referenceText}"`,
            response: said ? `They said: "${said}"` : "(no clear transcript captured)",
          }),
        });
        const j = await r.json().catch(() => null);
        if (j?.feedback) coach = String(j.feedback);
      } catch { /* fall through */ }
      if (!coach) {
        coach = said
          ? "Nice work reading aloud! Compare your recording to the sentence — slow down on any longer words and pronounce each syllable clearly."
          : "Recording received! Read the sentence again slowly and clearly, pronouncing each word fully.";
      }
      setAiFeedback(coach);
      setFeedbackPhase("feedback");
    })();
  };

  const handleContinue = () => {
    const p = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    onSubmit?.(p || { type: "pronunciation", audioUrl, referenceText, targetAccent: selectedAccent, language });
  };

  const accentLabel = (accent) => {
    const key = String(accent || "").toLowerCase();
    const flag = ACCENT_FLAGS[key] || key.toUpperCase();
    const nice = key ? key.charAt(0).toUpperCase() + key.slice(1) : "Accent";
    return { flag, nice };
  };

  return (
    <div
      style={{
        padding: 20,
        textAlign: "center",
        fontFamily: "system-ui",
        maxWidth: 780,
        margin: "0 auto",
        color: "#0f172a",
      }}
    >
      <h2 style={{ marginBottom: 10, fontSize: "1.6rem", fontWeight: 900 }}>
        Pronunciation Practice
      </h2>

      <div style={{ marginBottom: 16, color: "#475569", fontWeight: 650 }}>
        Read the sentence below in your selected accent. Then record and submit for AI feedback.
      </div>

      {/* Clear, student-friendly instructions (Grade 7 level) */}
      <div
        style={{
          margin: "0 auto 16px auto",
          maxWidth: 740,
          padding: 14,
          borderRadius: 18,
          border: "1px solid rgba(226,232,240,1)",
          background: "linear-gradient(180deg, #ffffff, #f8fafc)",
          boxShadow: "0 10px 30px rgba(2,6,23,0.05)",
          textAlign: "left",
        }}
      >
        <div style={{ fontWeight: 1000, marginBottom: 8 }}>How to do this task</div>
        <ol style={{ margin: 0, paddingLeft: 18, color: "#334155", lineHeight: 1.4 }}>
          <li>
            <strong>Choose an accent</strong> (example: Canadian, British).
          </li>
          <li>
            <strong>Read the sentence out loud</strong> the best you can.
          </li>
          <li>
            Tap <strong>Record</strong>, speak clearly, then tap <strong>Stop</strong>.
          </li>
          <li>
            Listen to your recording, then tap <strong>Submit</strong>.
          </li>
        </ol>
        <div style={{ marginTop: 10, fontSize: "0.92rem", color: "#64748b", fontWeight: 650 }}>
          Tip: If you make a mistake, tap <strong>Re-record</strong> and try again.
        </div>
      </div>

      {/* Accent Selector */}
      <div
        style={{
          marginBottom: 18,
          padding: 14,
          borderRadius: 16,
          border: "1px solid rgba(226,232,240,1)",
          background: "linear-gradient(180deg, #ffffff, #f8fafc)",
          boxShadow: "0 10px 30px rgba(2,6,23,0.05)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Choose your target accent</div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {accentOptions.map((accent) => {
            const a = String(accent || "").toLowerCase();
            const { flag, nice } = accentLabel(a);
            const selected = selectedAccent === a;

            return (
              <button
                key={a}
                type="button"
                onClick={() => setSelectedAccent(a)}
                disabled={submitted || disabled}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: selected ? "3px solid #8b5cf6" : "1px solid rgba(226,232,240,1)",
                  background: selected ? "#f3e8ff" : "#ffffff",
                  fontWeight: selected ? 900 : 700,
                  fontSize: "0.98rem",
                  cursor: submitted || disabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  boxShadow: selected ? "0 10px 24px rgba(139,92,246,0.20)" : "none",
                }}
                title={`${nice} English`}
              >
                <span style={{ fontSize: "1.1rem" }}>{flag}</span>
                <span>{nice} English</span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: "0.9rem", color: "#64748b" }}>
          Target accent: <strong>{accentLabel(selectedAccent).nice}</strong> • Language:{" "}
          <strong>{language}</strong>
        </div>
      </div>

      {/* Reference Sentence */}
      <div
        style={{
          background: "#fefce8",
          padding: 18,
          borderRadius: 18,
          border: "1px solid rgba(253,224,71,0.9)",
          marginBottom: 14,
          fontSize: "1.35rem",
          lineHeight: 1.55,
          fontWeight: 650,
          boxShadow: "0 10px 30px rgba(2,6,23,0.05)",
        }}
      >
        "{referenceText}"
      </div>

      {safeTask.phonetic && (
        <div
          style={{
            fontSize: "1.05rem",
            color: "#b45309",
            marginBottom: 14,
            fontStyle: "italic",
          }}
        >
          Guide: {safeTask.phonetic}
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            margin: "0 auto 14px auto",
            maxWidth: 640,
            padding: 10,
            borderRadius: 14,
            border: "1px solid rgba(254,202,202,1)",
            background: "#fff1f2",
            color: "#991b1b",
            fontWeight: 800,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Recording UI */}
      <div style={{ marginBottom: 20 }}>
        {!audioUrl ? (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={disabled || submitted}
            style={{
              width: 108,
              height: 108,
              borderRadius: "50%",
              fontSize: "1.2rem",
              background: recording ? "#ef4444" : "#10b981",
              color: "white",
              border: "none",
              boxShadow: "0 14px 30px rgba(2,6,23,0.18)",
              cursor: disabled || submitted ? "not-allowed" : "pointer",
              fontWeight: 1000,
            }}
            title={recording ? "Stop recording" : "Start recording"}
          >
            {recording ? "Stop" : "Record"}
          </button>
        ) : (
          <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
            <audio controls src={audioUrl} style={{ width: "100%", maxWidth: 520 }} />
            <button
              type="button"
              onClick={() => {
                setAudioUrl(null);
                chunks.current = [];
                setSubmitted(false);
                setErrorMsg(null);
              }}
              disabled={disabled}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(226,232,240,1)",
                background: "#ffffff",
                color: "#dc2626",
                fontWeight: 900,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              Re-record
            </button>
          </div>
        )}

        {recording && (
          <p style={{ marginTop: 12, fontWeight: 900, color: "#dc2626" }}>
            Recording… Speak clearly!
          </p>
        )}
      </div>

      {/* Submit / AI response */}
      {feedbackPhase === "idle" && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!audioUrl || submitted || disabled}
          style={{
            padding: "14px 34px",
            borderRadius: 999,
            background: !audioUrl || submitted || disabled ? "#94a3b8" : "#8b5cf6",
            color: "white",
            fontWeight: 1000,
            fontSize: "1.15rem",
            border: "none",
            cursor: !audioUrl || submitted || disabled ? "not-allowed" : "pointer",
            boxShadow: "0 10px 24px rgba(139,92,246,0.35)",
          }}
        >
          Submit &amp; Get AI Feedback
        </button>
      )}

      {feedbackPhase === "scoring" && (
        <div style={{ fontWeight: 900, color: "#8b5cf6", fontSize: "1.05rem" }}>
          🎧 Listening to your recording…
        </div>
      )}

      {feedbackPhase === "feedback" && (
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "left" }}>
          {transcript && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 14, background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 900, color: "#475569", marginBottom: 4 }}>What we heard</div>
              <div style={{ fontStyle: "italic", color: "#0f172a" }}>"{transcript}"</div>
            </div>
          )}
          <div style={{ padding: 14, borderRadius: 14, background: "#f3e8ff", border: "1px solid #d8b4fe", color: "#0f172a" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 900, color: "#7c3aed", marginBottom: 6 }}>🤖 AI feedback</div>
            <div style={{ fontSize: "0.98rem", lineHeight: 1.5 }}>{aiFeedback}</div>
          </div>
          <button
            type="button"
            onClick={handleContinue}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "13px 24px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
              color: "white",
              fontWeight: 1000,
              fontSize: "1.05rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Continue ▶
          </button>
        </div>
      )}

      {feedbackPhase === "idle" && (
        <div style={{ marginTop: 14, fontSize: "0.9rem", color: "#64748b" }}>
          Tip: students can repeat this task over time to track pronunciation progress.
        </div>
      )}
    </div>
  );
}
