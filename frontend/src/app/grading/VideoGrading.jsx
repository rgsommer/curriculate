"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { completeQuest } from "../../components/QuestWidget";

/**
 * VideoGrading — Video upload + AI grading for speeches/presentations.
 * Sends video to POST /grading/video, which transcribes audio (Whisper),
 * extracts frames (ffmpeg), and grades via GPT vision.
 */

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];

const PERFORMANCE_TYPES = [
  { value: "speech", label: "Speech / Presentation" },
  { value: "acting", label: "Acting / Skit / Drama" },
  { value: "singing", label: "Singing" },
  { value: "instrumental", label: "Instrumental Music" },
  { value: "dance", label: "Dance / Movement" },
  { value: "demo", label: "Demonstration / How-To" },
  { value: "other", label: "Other" },
];

const INSTRUMENT_FAMILIES = [
  { value: "brass", label: "Brass" },
  { value: "woodwind", label: "Woodwind" },
  { value: "strings", label: "Strings" },
  { value: "percussion", label: "Percussion" },
  { value: "keys", label: "Keyboard / Piano" },
  { value: "guitar", label: "Guitar" },
];

const INSTRUMENTS_BY_FAMILY = {
  brass: [
    { value: "trumpet", label: "Trumpet" },
    { value: "trombone", label: "Trombone" },
    { value: "french_horn", label: "French Horn" },
    { value: "tuba", label: "Tuba" },
    { value: "euphonium", label: "Euphonium / Baritone" },
    { value: "cornet", label: "Cornet" },
    { value: "brass_other", label: "Other Brass" },
  ],
  woodwind: [
    { value: "flute", label: "Flute" },
    { value: "clarinet", label: "Clarinet" },
    { value: "saxophone", label: "Saxophone" },
    { value: "oboe", label: "Oboe" },
    { value: "bassoon", label: "Bassoon" },
    { value: "recorder", label: "Recorder" },
    { value: "piccolo", label: "Piccolo" },
    { value: "woodwind_other", label: "Other Woodwind" },
  ],
  strings: [
    { value: "violin", label: "Violin" },
    { value: "viola", label: "Viola" },
    { value: "cello", label: "Cello" },
    { value: "double_bass", label: "Double Bass" },
    { value: "ukulele", label: "Ukulele" },
    { value: "harp", label: "Harp" },
    { value: "strings_other", label: "Other Strings" },
  ],
  percussion: [
    { value: "snare", label: "Snare Drum" },
    { value: "drum_kit", label: "Drum Kit" },
    { value: "timpani", label: "Timpani" },
    { value: "marimba", label: "Marimba / Xylophone" },
    { value: "percussion_other", label: "Other Percussion" },
  ],
  keys: [
    { value: "piano", label: "Piano" },
    { value: "organ", label: "Organ" },
    { value: "synthesizer", label: "Synthesizer / Keyboard" },
    { value: "keys_other", label: "Other Keyboard" },
  ],
  guitar: [
    { value: "acoustic_guitar", label: "Acoustic Guitar" },
    { value: "electric_guitar", label: "Electric Guitar" },
    { value: "bass_guitar", label: "Bass Guitar" },
    { value: "guitar_other", label: "Other Guitar" },
  ],
};

export default function VideoGrading({
  gradingUrl,
  gradeBand,
  standards,
  feedbackVoice,
  rubricOverride,
  subjectArea,
  strictnessBias = 0,
  onStrictnessChange,
  onClose,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [studentName, setStudentName] = useState("");
  const [performanceType, setPerformanceType] = useState("");
  const [instrumentFamily, setInstrumentFamily] = useState("");
  const [instrument, setInstrument] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [refCode, setRefCode] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const progressTimerRef = useRef(null);

  const backendBase = gradingUrl?.replace(/\/grading$/, "") || process.env.NEXT_PUBLIC_BACKEND_URL || "";
  const resultsUrl = backendBase ? `${backendBase.replace(/\/$/, "")}/results` : "";

  const handleFileSelect = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!ACCEPTED_TYPES.includes(f.type) && !f.name.match(/\.(mp4|mov|webm|m4v)$/i)) {
      setError("Please select a video file (MP4, MOV, or WebM).");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`Video is too large (${(f.size / 1024 / 1024).toFixed(0)}MB). Maximum is 500MB.`);
      return;
    }

    setFile(f);
    setError("");
    setResult(null);

    // Generate preview URL
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      // Trigger via synthetic event
      const dt = new DataTransfer();
      dt.items.add(f);
      if (fileInputRef.current) {
        fileInputRef.current.files = dt.files;
        fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Progress stages: each has a label, target percentage, and estimated duration (ms)
  // Total ~3 minutes of animation so the bar keeps moving during the full request.
  // The AI grading step is the longest (bulk of the real work).
  const PROGRESS_STAGES = [
    { label: "Uploading video...",                  pct: 10,  duration: 5000 },
    { label: "Extracting audio...",                 pct: 18,  duration: 6000 },
    { label: "Transcribing speech...",              pct: 30,  duration: 15000 },
    { label: "Extracting video frames...",          pct: 38,  duration: 8000 },
    { label: "Pulse grading transcript...",           pct: 55,  duration: 30000 },
    { label: "Pulse grading visual presentation...",pct: 72,  duration: 30000 },
    { label: "Compiling feedback & scores...",      pct: 85,  duration: 25000 },
    { label: "Finalizing results...",               pct: 92,  duration: 20000 },
  ];

  const startProgressTimer = useCallback(() => {
    setProgressPct(0);
    let stageIdx = 0;
    let currentPct = 0;

    const advance = () => {
      if (stageIdx >= PROGRESS_STAGES.length) {
        // Slow crawl from 92 → 99 so bar never fully stops
        progressTimerRef.current = setInterval(() => {
          currentPct = Math.min(99, currentPct + 0.15);
          setProgressPct(Math.round(currentPct));
        }, 1000);
        return;
      }
      const stage = PROGRESS_STAGES[stageIdx];
      setProgress(stage.label);

      // Smoothly animate to target pct
      const steps = Math.max(1, Math.floor(stage.duration / 300));
      const increment = (stage.pct - currentPct) / steps;
      let step = 0;

      progressTimerRef.current = setInterval(() => {
        step++;
        currentPct = Math.min(stage.pct, currentPct + increment);
        setProgressPct(Math.round(currentPct));

        if (step >= steps) {
          clearInterval(progressTimerRef.current);
          stageIdx++;
          if (stageIdx < PROGRESS_STAGES.length) {
            advance();
          } else {
            advance(); // enter slow crawl
          }
        }
      }, 300);
    };

    advance();
  }, []);

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopProgressTimer(), [stopProgressTimer]);

  const gradeVideo = useCallback(async (biasOverride) => {
    if (!file) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    abortRef.current = false;
    startProgressTimer();

    const effectiveBias = biasOverride != null ? biasOverride : strictnessBias;

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("rubricOverride", rubricOverride || "");
      formData.append("gradeBand", gradeBand || "6-8");
      formData.append("standards", standards || "canada");
      formData.append("feedbackVoice", feedbackVoice || "coach");
      if (studentName.trim()) formData.append("studentName", studentName.trim());
      if (performanceType) formData.append("performanceType", performanceType);
      if (instrumentFamily) formData.append("instrumentFamily", instrumentFamily);
      if (instrument) formData.append("instrument", instrument);
      if (subjectArea) formData.append("subjectArea", subjectArea);
      if (effectiveBias) formData.append("strictnessBias", String(effectiveBias));

      const resp = await fetch(`${backendBase}/grading/video`, {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${resp.status}`);
      }

      stopProgressTimer();
      setProgressPct(100);
      setProgress("Done!");
      const data = await resp.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        try { if (window.gtag) window.gtag("event", "grading_complete", { mode: "video" }); } catch {}
        completeQuest("try_video_grading");

        // Auto-publish to get a ref code
        if (resultsUrl) {
          try {
            const payload = buildVideoPayloadText(data);
            const pubResp = await fetch(resultsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payload, meta: { source: "video-grading", gradeBand } }),
            });
            const pubData = await pubResp.json().catch(() => ({}));
            if (pubData?.code) setRefCode(String(pubData.code).toUpperCase());
          } catch (e) {
            console.warn("Video result publish failed:", e);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Video grading failed.");
    } finally {
      stopProgressTimer();
      setSubmitting(false);
      setProgress("");
      setProgressPct(0);
    }
  }, [file, backendBase, rubricOverride, gradeBand, standards, feedbackVoice, studentName, performanceType, instrumentFamily, instrument, subjectArea, strictnessBias, startProgressTimer, stopProgressTimer]);

  function buildVideoPayloadText(r) {
    const lines = [];
    if (r.overall_score > 0 || r.overall_out_of > 0) {
      lines.push(`Grade: ${r.overall_score} / ${r.overall_out_of}`);
    } else {
      lines.push("Tutor Feedback");
    }
    lines.push("");
    if (r.student_name) { lines.push(`Student: ${r.student_name}`); lines.push(""); }
    if (r.performanceType) {
      const typeLabel = PERFORMANCE_TYPES.find(t => t.value === r.performanceType)?.label || r.performanceType;
      lines.push(`Performance Type: ${typeLabel}`);
      if (r.instrument) {
        const instLabel = Object.values(INSTRUMENTS_BY_FAMILY).flat().find(i => i.value === r.instrument)?.label || r.instrument;
        lines.push(`Instrument: ${instLabel}`);
      }
    }
    if (r.videoDuration) lines.push(`Video: ${Math.round(r.videoDuration)}s, ${r.frameCount || 0} frames analyzed`);
    lines.push("");
    if (Array.isArray(r.sections)) {
      lines.push("Sections:");
      r.sections.forEach(s => {
        const showScore = Number(s.score) > 0 || Number(s.out_of) > 0;
        lines.push(`- ${s.name}:${showScore ? ` ${s.score}/${s.out_of} —` : ""} ${s.teacher_comment || ""}`);
      });
      lines.push("");
    }
    if (Array.isArray(r.strengths)) {
      lines.push("Strengths:");
      r.strengths.forEach(s => lines.push(`- ${s}`));
      lines.push("");
    }
    if (Array.isArray(r.improvements)) {
      lines.push("Next Steps:");
      r.improvements.forEach(s => lines.push(`- ${s}`));
      lines.push("");
    }
    if (Array.isArray(r.achievement_summary)) {
      lines.push("Achievement Categories:");
      r.achievement_summary.forEach(k => {
        const scoreStr = typeof k.score === "number" ? ` ${k.score.toFixed(2)}/${k.out_of.toFixed(2)}` : "";
        lines.push(`- ${k.category}${scoreStr} [${k.level}]: ${k.comment}`);
      });
      lines.push("");
    }
    if (r.teacher_comment) { lines.push("Overall Comment:"); lines.push(r.teacher_comment); lines.push(""); }
    if (r.videoUrl) {
      lines.push("Saved captures (30-day links):");
      lines.push(`Video recording: ${r.videoUrl}`);
      lines.push("");
    }
    // Prefer timestamped transcript, fall back to plain
    const displayTranscript = r.transcriptWithTimestamps || r.transcript;
    if (displayTranscript) { lines.push("Transcript:"); lines.push(displayTranscript); lines.push(""); }
    return lines.join("\n");
  }

  async function copyRefLink() {
    if (!refCode) return;
    const url = `https://www.curriculate.net/results/${refCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    }
  }

  const clearAll = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
    setStudentName("");
    setPerformanceType("");
    setInstrumentFamily("");
    setInstrument("");
    setRefCode("");
    setCopiedRef(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function adjustStrictnessAndRegrade(delta) {
    const next = Math.max(-3, Math.min(3, strictnessBias + delta));
    if (onStrictnessChange) onStrictnessChange(next);
    gradeVideo(next);
  }

  // -------- Render result --------
  const renderResult = () => {
    if (!result) return null;
    const r = result;
    const isTutor = feedbackVoice === "tutor";
    const pct = r.overall_out_of ? Math.round((r.overall_score / r.overall_out_of) * 100) : 0;
    const color = isTutor ? "#2563eb" : pct >= 80 ? "#16a34a" : pct >= 60 ? "#ca8a04" : "#dc2626";
    const biasLabel = strictnessBias > 0
      ? (strictnessBias === 1 ? "strict" : strictnessBias === 2 ? "stricter" : "strictest")
      : strictnessBias < 0
        ? (strictnessBias === -1 ? "lenient" : strictnessBias === -2 ? "more lenient" : "most lenient")
        : "";

    return (
      <div style={{ marginTop: 20 }}>
        {/* Score header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, marginBottom: 16,
          padding: 16, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {!isTutor && !submitting && (
              <button
                type="button"
                onClick={() => adjustStrictnessAndRegrade(1)}
                disabled={submitting || strictnessBias >= 3}
                title="Re-grade more strictly (lower score)"
                style={{
                  border: "none", background: "transparent", cursor: strictnessBias >= 3 ? "default" : "pointer",
                  padding: "0 2px", fontSize: 22, fontWeight: 700, lineHeight: 1,
                  color: strictnessBias >= 3 ? "#cbd5e1" : "#64748b",
                  opacity: strictnessBias >= 3 ? 0.4 : 0.7,
                }}
              >&#8249;</button>
            )}
            {!isTutor ? (
              <div style={{
                width: 72, height: 72, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", flexDirection: "column",
                background: color + "18", border: `3px solid ${color}`,
                fontSize: 20, fontWeight: 700, color,
              }}>
                {r.overall_score}/{r.overall_out_of}
                {biasLabel && (
                  <span style={{
                    fontSize: 8, fontWeight: 600, lineHeight: 1, marginTop: 1,
                    color: strictnessBias > 0 ? "#dc2626" : "#2563eb",
                    textTransform: "uppercase",
                  }}>{biasLabel}</span>
                )}
              </div>
            ) : (
              <div style={{
                width: 72, height: 72, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center",
                background: "#dbeafe", border: "3px solid #2563eb",
                fontSize: 28, fontWeight: 700, color: "#2563eb",
              }}>
                &#x1F393;
              </div>
            )}
            {!isTutor && !submitting && (
              <button
                type="button"
                onClick={() => adjustStrictnessAndRegrade(-1)}
                disabled={submitting || strictnessBias <= -3}
                title="Re-grade more leniently (higher score)"
                style={{
                  border: "none", background: "transparent", cursor: strictnessBias <= -3 ? "default" : "pointer",
                  padding: "0 2px", fontSize: 22, fontWeight: 700, lineHeight: 1,
                  color: strictnessBias <= -3 ? "#cbd5e1" : "#64748b",
                  opacity: strictnessBias <= -3 ? 0.4 : 0.7,
                }}
              >&#8250;</button>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>
              {r.student_name || "Student"} — Video Assessment
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {r.performanceType ? (PERFORMANCE_TYPES.find(t => t.value === r.performanceType)?.label || r.performanceType) : (r.inferred_subject || "Subject")}
              {r.instrument ? ` (${Object.values(INSTRUMENTS_BY_FAMILY).flat().find(i => i.value === r.instrument)?.label || r.instrument})` : ""}
              {" • "}{r.inferred_assessment_type || "Assessment"} •{" "}
              {r.videoDuration ? `${Math.round(r.videoDuration)}s video` : ""}
              {r.frameCount ? ` • ${r.frameCount} frames analyzed` : ""}
            </div>
            {refCode && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={copyRefLink}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                    border: "1px solid #cbd5e1", background: copiedRef ? "#dcfce7" : "#f8fafc",
                    color: copiedRef ? "#16a34a" : "#334155", cursor: "pointer",
                  }}
                >
                  {copiedRef ? "Link copied!" : `Ref: ${refCode}`}
                </button>
                <a
                  href={`https://www.curriculate.net/results/${refCode}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline" }}
                >
                  View feedback
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Transcript */}
        {r.transcript && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14, color: "#475569" }}>
              Transcript ({r.transcript.length} chars)
            </summary>
            <pre style={{
              background: "#f1f5f9", padding: 12, borderRadius: 8, fontSize: 12,
              whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", marginTop: 8,
            }}>
              {r.transcriptWithTimestamps || r.transcript}
            </pre>
          </details>
        )}

        {/* Sections */}
        {Array.isArray(r.sections) && r.sections.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Sections</div>
            {r.sections.map((s, i) => {
              const showSecScore = Number(s.score) > 0 || Number(s.out_of) > 0;
              const sPct = s.out_of ? (s.score / s.out_of) : 0;
              const sColor = sPct >= 0.8 ? "#16a34a" : sPct >= 0.6 ? "#ca8a04" : "#dc2626";
              return (
                <div key={i} style={{
                  padding: "10px 14px", marginBottom: 6, borderRadius: 8,
                  border: "1px solid #e2e8f0", background: "#fff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                    {showSecScore && (
                      <span style={{ fontWeight: 700, color: sColor, fontSize: 13 }}>
                        {s.score}/{s.out_of}
                      </span>
                    )}
                  </div>
                  {s.teacher_comment && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{s.teacher_comment}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Strengths */}
        {Array.isArray(r.strengths) && r.strengths.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#16a34a", marginBottom: 4 }}>Strengths</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {r.strengths.map((s, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 2 }}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Improvements */}
        {Array.isArray(r.improvements) && r.improvements.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#ca8a04", marginBottom: 4 }}>Next Steps</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {r.improvements.map((s, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 2 }}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Teacher comment */}
        {r.teacher_comment && (
          <div style={{
            padding: 12, background: "#f0f9ff", borderRadius: 8,
            border: "1px solid #bae6fd", fontSize: 13, marginBottom: 12,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Overall Comment</div>
            {r.teacher_comment}
          </div>
        )}

        {/* Achievement summary */}
        {Array.isArray(r.achievement_summary) && r.achievement_summary.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Achievement Categories</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {r.achievement_summary.map((cat, i) => {
                const levelColors = { strong: "#16a34a", adequate: "#2563eb", developing: "#ca8a04", limited: "#dc2626" };
                const lc = levelColors[cat.level] || "#64748b";
                return (
                  <div key={i} style={{
                    padding: 10, borderRadius: 8, border: `1px solid ${lc}33`,
                    background: lc + "08",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: lc }}>{cat.category}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: lc }}>
                      {cat.score.toFixed(1)}/{cat.out_of.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{cat.comment}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={clearAll}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "1px solid #cbd5e1",
            background: "#fff", cursor: "pointer", fontSize: 14, marginTop: 8,
          }}
        >
          Grade Another Video
        </button>
      </div>
    );
  };

  // -------- Main render --------
  return (
    <div style={{ padding: "0 4px" }}>
      {/* Upload area */}
      {!result && (
        <>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => !submitting && fileInputRef.current?.click()}
            style={{
              border: "2px dashed #cbd5e1",
              borderRadius: 12,
              padding: file ? "12px" : "40px 20px",
              textAlign: "center",
              cursor: submitting ? "not-allowed" : "pointer",
              background: file ? "#f0fdf4" : "#f8fafc",
              transition: "all 0.2s",
              marginBottom: 12,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />

            {file ? (
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#16a34a", marginBottom: 4 }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </div>
                {preview && (
                  <video
                    src={preview}
                    controls
                    style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginTop: 8 }}
                  />
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎥</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: "#334155" }}>
                  Drop a video here or tap to upload
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                  MP4, MOV, or WebM • Max 500MB
                </div>
              </div>
            )}
          </div>

          {/* Student name (optional) */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>
              Student Name (optional)
            </label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Enter student name..."
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
              }}
              disabled={submitting}
            />
          </div>

          {/* Performance type selector */}
          {file && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>
                What type of performance is this?
              </label>
              <select
                value={performanceType}
                onChange={(e) => { setPerformanceType(e.target.value); setInstrumentFamily(""); setInstrument(""); }}
                disabled={submitting}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
                  background: "#fff",
                }}
              >
                <option value="">Select performance type...</option>
                {PERFORMANCE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Instrument family (instrumental only) */}
          {performanceType === "instrumental" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>
                Instrument Family
              </label>
              <select
                value={instrumentFamily}
                onChange={(e) => { setInstrumentFamily(e.target.value); setInstrument(""); }}
                disabled={submitting}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
                  background: "#fff",
                }}
              >
                <option value="">Select family...</option>
                {INSTRUMENT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Specific instrument */}
          {instrumentFamily && INSTRUMENTS_BY_FAMILY[instrumentFamily] && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>
                Instrument
              </label>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                disabled={submitting}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
                  background: "#fff",
                }}
              >
                <option value="">Select instrument...</option>
                {INSTRUMENTS_BY_FAMILY[instrumentFamily].map(i => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Rubric status indicator */}
          {rubricOverride && (
            <div style={{
              padding: 8, background: "#eff6ff", borderRadius: 8,
              border: "1px solid #bfdbfe", fontSize: 12, color: "#1e40af",
              marginBottom: 12,
            }}>
              Rubric active (see Rubric Options above)
            </div>
          )}

          {/* Grade button */}
          <button
            onClick={() => gradeVideo()}
            disabled={!file || !performanceType || submitting}
            style={{
              width: "100%",
              padding: "14px 20px",
              borderRadius: 10,
              border: "none",
              background: !file || !performanceType || submitting ? "#94a3b8" : "#2563eb",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: !file || !performanceType || submitting ? "not-allowed" : "pointer",
              marginBottom: 8,
            }}
          >
            {submitting ? progress || "Processing..." : "Grade Video"}
          </button>

          {/* Progress bar */}
          {submitting && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                width: "100%", height: 8, borderRadius: 4,
                background: "#e2e8f0", overflow: "hidden",
              }}>
                <div style={{
                  width: `${progressPct}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                  transition: "width 0.3s ease",
                }} />
              </div>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 11, color: "#64748b", marginTop: 4,
              }}>
                <span>{progress}</span>
                <span>{progressPct}%</span>
              </div>
            </div>
          )}

          {file && !submitting && (
            <button
              onClick={clearAll}
              style={{
                width: "100%", padding: "10px", borderRadius: 8,
                border: "1px solid #e2e8f0", background: "#fff",
                cursor: "pointer", fontSize: 13, color: "#64748b",
              }}
            >
              Clear
            </button>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: 12, background: "#fef2f2", borderRadius: 8,
          border: "1px solid #fecaca", color: "#dc2626", fontSize: 13,
          marginTop: 8,
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {renderResult()}
    </div>
  );
}
