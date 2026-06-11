"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { completeQuest } from "../../components/QuestWidget";

/**
 * AudioGrading — Audio upload + AI grading for speech, singing, or instrumental performance.
 * After upload, user selects performance type (Speech, Singing, Instrumental).
 * For Instrumental, cascading dropdowns: instrument family → specific instrument.
 * Sends to POST /grading/audio on the backend.
 */

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const ACCEPTED_AUDIO = ".mp3,.m4a,.wav,.aac,.ogg,.flac,.wma,.webm";

const PERFORMANCE_TYPES = [
  { value: "speech", label: "Speech / Presentation" },
  { value: "singing", label: "Singing" },
  { value: "instrumental", label: "Instrumental" },
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

export default function AudioGrading({
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
  const [studentName, setStudentName] = useState("");
  const [performanceType, setPerformanceType] = useState("");
  const [instrumentFamily, setInstrumentFamily] = useState("");
  const [instrument, setInstrument] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  // Transient network failure — surface a one-tap Retry alongside the message.
  const [errorCanRetry, setErrorCanRetry] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);
  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const progressTimerRef = useRef(null);

  const backendBase = gradingUrl?.replace(/\/grading$/, "") || process.env.NEXT_PUBLIC_BACKEND_URL || "";
  const resultsUrl = backendBase ? `${backendBase.replace(/\/$/, "")}/results` : "";

  // Reset instrument when family changes
  useEffect(() => { setInstrument(""); }, [instrumentFamily]);
  // Reset instrument fields when type changes
  useEffect(() => {
    if (performanceType !== "instrumental") {
      setInstrumentFamily("");
      setInstrument("");
    }
  }, [performanceType]);

  const handleFileSelect = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Validate type — accept audio/* MIME or a known audio extension.
    const okExt = /\.(mp3|m4a|wav|aac|ogg|flac|wma|webm)$/i.test(f.name);
    if (!(f.type || "").startsWith("audio/") && !okExt) {
      setError("Please select an audio file (MP3, M4A, WAV, AAC, OGG, FLAC, or WebM).");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`Audio file is too large (${(f.size / 1024 / 1024).toFixed(0)}MB). Maximum is 200MB.`);
      return;
    }
    setFile(f);
    setError("");
    setResult(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) {
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

  const PROGRESS_STAGES = [
    { label: "Uploading audio...", pct: 15, duration: 5000 },
    { label: "Analyzing audio...", pct: 30, duration: 10000 },
    { label: "Transcribing performance...", pct: 50, duration: 15000 },
    { label: "Pulse grading performance...", pct: 75, duration: 30000 },
    { label: "Compiling feedback & scores...", pct: 88, duration: 20000 },
    { label: "Finalizing results...", pct: 95, duration: 15000 },
  ];

  const startProgressTimer = useCallback(() => {
    setProgressPct(0);
    let stageIdx = 0;
    let currentPct = 0;

    const advance = () => {
      if (stageIdx >= PROGRESS_STAGES.length) {
        progressTimerRef.current = setInterval(() => {
          currentPct = Math.min(99, currentPct + 0.15);
          setProgressPct(Math.round(currentPct));
        }, 1000);
        return;
      }
      const stage = PROGRESS_STAGES[stageIdx];
      setProgress(stage.label);
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
          advance();
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

  useEffect(() => () => stopProgressTimer(), [stopProgressTimer]);

  const gradeAudio = useCallback(async (biasOverride) => {
    if (!file || !performanceType) return;
    if (performanceType === "instrumental" && !instrumentFamily) {
      setError("Please select an instrument family.");
      return;
    }

    const effectiveBias = biasOverride != null ? biasOverride : strictnessBias;

    setSubmitting(true);
    setError("");
    setErrorCanRetry(false);
    setResult(null);
    abortControllerRef.current = new AbortController();
    startProgressTimer();

    try {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("performanceType", performanceType);
      formData.append("instrumentFamily", instrumentFamily || "");
      formData.append("instrument", instrument || "");
      formData.append("rubricOverride", rubricOverride || "");
      formData.append("gradeBand", gradeBand || "6-8");
      formData.append("standards", standards || "canada");
      formData.append("feedbackVoice", feedbackVoice || "coach");
      formData.append("subjectArea", subjectArea || "");
      if (studentName.trim()) formData.append("studentName", studentName.trim());
      if (effectiveBias) formData.append("strictnessBias", String(effectiveBias));

      // POST returns a jobId immediately; poll until done. This avoids the
      // upstream proxy timeout that kills long HTTP requests mid-flight.
      const postResp = await fetch(`${backendBase}/grading/audio`, {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current?.signal,
      });
      if (!postResp.ok) {
        const errData = await postResp.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${postResp.status}`);
      }
      const postData = await postResp.json();
      const jobId = postData?.jobId;
      if (!jobId) throw new Error("Server didn't return a job ID. Try again.");

      const POLL_INTERVAL_MS = 2500;
      const STAGE_LABELS = {
        uploaded: "Uploaded, queueing…",
        transcribing: "Transcribing audio…",
        done: "Finishing up…",
      };
      let data = null;
      // Tolerate transient network failures during polling — the job is alive
      // on the server, so a network blip should not throw away the whole grade.
      let pollFailures = 0;
      const MAX_POLL_FAILURES = 10;
      while (true) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        await new Promise((resolve) => {
          const t = setTimeout(resolve, POLL_INTERVAL_MS);
          abortControllerRef.current?.signal.addEventListener("abort", () => {
            clearTimeout(t); resolve();
          }, { once: true });
        });
        if (abortControllerRef.current?.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let job = null;
        try {
          const jobResp = await fetch(
            `${backendBase}/grading/audio/job/${encodeURIComponent(jobId)}`,
            { signal: abortControllerRef.current?.signal }
          );
          if (jobResp.status === 404) {
            throw new Error("This grading job is no longer available on the server (it may have restarted). Please retry.");
          }
          if (!jobResp.ok) {
            throw new Error(`Job lookup failed (${jobResp.status}).`);
          }
          job = await jobResp.json();
          pollFailures = 0;
        } catch (pollErr) {
          if (pollErr?.name === "AbortError") throw pollErr;
          if (/no longer available/.test(pollErr?.message || "")) throw pollErr;
          pollFailures += 1;
          if (pollFailures >= MAX_POLL_FAILURES) {
            throw new Error("Lost connection to the server while waiting for the grade. Please retry.");
          }
          continue;
        }

        if (typeof job?.progress === "number") {
          setProgressPct((prev) => Math.max(prev || 0, job.progress));
        }
        if (job?.stage && STAGE_LABELS[job.stage]) {
          setProgress(STAGE_LABELS[job.stage]);
        }
        if (job?.status === "done") { data = job.result; break; }
        if (job?.status === "error") {
          throw new Error(job.error || "Audio grading failed.");
        }
      }

      stopProgressTimer();
      setProgressPct(100);
      setProgress("Done!");

      if (!data || data.error) {
        setError(data?.error || "Audio grading failed.");
      } else {
        setResult(data);
        try { if (window.gtag) window.gtag("event", "grading_complete", { mode: "audio" }); } catch {}
        completeQuest("try_audio_grading");

        // Auto-publish for ref code
        if (resultsUrl) {
          try {
            const payload = buildAudioPayloadText(data);
            const pubResp = await fetch(resultsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payload, meta: { source: "audio-grading", gradeBand } }),
            });
            const pubData = await pubResp.json().catch(() => ({}));
            if (pubData?.code) setRefCode(String(pubData.code).toUpperCase());
          } catch (e) {
            console.warn("Audio result publish failed:", e);
          }
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("");
        setErrorCanRetry(false);
      } else {
        const msg = String(err?.message || "");
        const isNetwork = err?.name === "TypeError"
          || /failed to fetch|networkerror|load failed/i.test(msg);
        if (isNetwork) {
          setError("Connection dropped before the grade came back. Your file is still loaded — tap Retry to try again.");
          setErrorCanRetry(true);
        } else {
          setError(err.message || "Audio grading failed.");
          setErrorCanRetry(false);
        }
      }
    } finally {
      stopProgressTimer();
      setSubmitting(false);
      setProgress("");
      setProgressPct(0);
    }
  }, [file, performanceType, instrumentFamily, instrument, backendBase, rubricOverride, gradeBand, standards, feedbackVoice, subjectArea, studentName, strictnessBias, startProgressTimer, stopProgressTimer]);

  function buildAudioPayloadText(r) {
    const lines = [];
    const typeLabel = PERFORMANCE_TYPES.find(t => t.value === performanceType)?.label || performanceType;
    if (r.overall_score > 0 || r.overall_out_of > 0) {
      lines.push(`Grade: ${r.overall_score} / ${r.overall_out_of}`);
    } else {
      lines.push("Performance Feedback");
    }
    lines.push("");
    if (r.student_name) { lines.push(`Student: ${r.student_name}`); lines.push(""); }
    lines.push(`Performance Type: ${typeLabel}`);
    if (instrument) {
      const instLabel = Object.values(INSTRUMENTS_BY_FAMILY).flat().find(i => i.value === instrument)?.label || instrument;
      lines.push(`Instrument: ${instLabel}`);
    }
    if (r.audioDuration) lines.push(`Duration: ${Math.round(r.audioDuration)}s`);
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
    if (r.teacher_comment) { lines.push("Overall Comment:"); lines.push(r.teacher_comment); lines.push(""); }
    if (r.audioSourceUrl) {
      lines.push(`Source Recording: ${r.audioSourceUrl}`);
      if (r.audioSourceExpires) lines.push(`(link expires ${new Date(r.audioSourceExpires).toLocaleDateString()})`);
      lines.push("");
    }
    if (r.transcript) { lines.push("Transcript:"); lines.push(r.transcript); lines.push(""); }
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

  const canSubmit = file && performanceType && (performanceType !== "instrumental" || instrumentFamily);

  function adjustStrictnessAndRegrade(delta) {
    const next = Math.max(-3, Math.min(3, strictnessBias + delta));
    if (onStrictnessChange) onStrictnessChange(next);
    gradeAudio(next);
  }

  // -------- Render result --------
  const renderResult = () => {
    if (!result) return null;
    const r = result;
    const isTutor = feedbackVoice === "tutor";
    const pct = r.overall_out_of ? Math.round((r.overall_score / r.overall_out_of) * 100) : 0;
    const color = isTutor ? "#2563eb" : pct >= 80 ? "#16a34a" : pct >= 60 ? "#ca8a04" : "#dc2626";
    const typeLabel = PERFORMANCE_TYPES.find(t => t.value === performanceType)?.label || "Performance";
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
                &#x1F3B5;
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
              {r.student_name || "Student"} — {typeLabel} Assessment
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {typeLabel}
              {instrument && (() => {
                const instLabel = Object.values(INSTRUMENTS_BY_FAMILY).flat().find(i => i.value === instrument)?.label;
                return instLabel ? ` (${instLabel})` : "";
              })()}
              {r.audioDuration ? ` • ${Math.round(r.audioDuration)}s` : ""}
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

        {/* Transcript (for speech/singing) */}
        {r.transcript && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14, color: "#475569" }}>
              Transcript ({r.transcript.length} chars)
            </summary>
            <pre style={{
              background: "#f1f5f9", padding: 12, borderRadius: 8, fontSize: 12,
              whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", marginTop: 8,
            }}>
              {r.transcript}
            </pre>
          </details>
        )}

        {/* Sections */}
        {Array.isArray(r.sections) && r.sections.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Assessment Areas</div>
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
                      <span style={{ fontWeight: 700, color: sColor, fontSize: 13 }}>{s.score}/{s.out_of}</span>
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
              {r.strengths.map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 2 }}>{s}</li>)}
            </ul>
          </div>
        )}

        {/* Improvements */}
        {Array.isArray(r.improvements) && r.improvements.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#ca8a04", marginBottom: 4 }}>Next Steps</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {r.improvements.map((s, i) => <li key={i} style={{ fontSize: 13, marginBottom: 2 }}>{s}</li>)}
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

        {r.audioSourceUrl && (
          <div style={{
            padding: 10, background: "#f8fafc", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 18 }}>🎧</span>
            <div>
              <a href={r.audioSourceUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
                Listen to source recording
              </a>
              {r.audioSourceExpires && (
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                  Link expires {new Date(r.audioSourceExpires).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        )}

        <button onClick={clearAll} style={{
          padding: "10px 20px", borderRadius: 8, border: "1px solid #cbd5e1",
          background: "#fff", cursor: "pointer", fontSize: 14, marginTop: 8,
        }}>
          Grade Another Recording
        </button>
      </div>
    );
  };

  // -------- Main render --------
  return (
    <div style={{ padding: "0 4px" }}>
      {!result && (
        <>
          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => !submitting && fileInputRef.current?.click()}
            style={{
              border: "2px dashed #cbd5e1", borderRadius: 12,
              padding: file ? "12px" : "40px 20px",
              textAlign: "center",
              cursor: submitting ? "not-allowed" : "pointer",
              background: file ? "#f0fdf4" : "#f8fafc",
              transition: "all 0.2s", marginBottom: 12,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO}
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
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎵</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: "#334155" }}>
                  Drop an audio file here or tap to upload
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                  MP3, M4A, WAV, AAC, OGG, FLAC • Max 200MB
                </div>
              </div>
            )}
          </div>

          {/* Performance type selector — shown after file is uploaded */}
          {file && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>
                What type of performance is this?
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PERFORMANCE_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setPerformanceType(t.value)}
                    style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: performanceType === t.value ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      background: performanceType === t.value ? "#eff6ff" : "#fff",
                      color: performanceType === t.value ? "#2563eb" : "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Instrument family selector — shown for instrumental */}
          {performanceType === "instrumental" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>
                Instrument Family
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {INSTRUMENT_FAMILIES.map(f => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setInstrumentFamily(f.value)}
                    style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: instrumentFamily === f.value ? "2px solid #7c3aed" : "1px solid #cbd5e1",
                      background: instrumentFamily === f.value ? "#f5f3ff" : "#fff",
                      color: instrumentFamily === f.value ? "#7c3aed" : "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Specific instrument — shown after family is selected */}
          {performanceType === "instrumental" && instrumentFamily && INSTRUMENTS_BY_FAMILY[instrumentFamily] && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>
                Instrument
              </label>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
                }}
              >
                <option value="">Select instrument (optional)...</option>
                {INSTRUMENTS_BY_FAMILY[instrumentFamily].map(i => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Student name */}
          {file && performanceType && (
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
          )}

          {/* Rubric indicator */}
          {rubricOverride && file && performanceType && (
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
            onClick={() => gradeAudio()}
            disabled={!canSubmit || submitting}
            style={{
              width: "100%", padding: "14px 20px", borderRadius: 10, border: "none",
              background: !canSubmit || submitting ? "#94a3b8" : "#2563eb",
              color: "#fff", fontSize: 16, fontWeight: 700,
              cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
              marginBottom: 8,
            }}
          >
            {submitting ? progress || "Processing..." : "Grade Recording"}
          </button>

          {submitting && (
            <button
              type="button"
              onClick={() => { abortControllerRef.current?.abort(); }}
              style={{
                width: "100%", padding: "10px 20px", borderRadius: 10,
                border: "1px solid #cbd5e1", background: "#fff", color: "#475569",
                fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 8,
              }}
            >
              Cancel
            </button>
          )}

          {/* Progress bar */}
          {submitting && (
            <div style={{ marginBottom: 12 }}>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPct)}
                aria-label="Audio grading progress"
                style={{
                width: "100%", height: 8, borderRadius: 4,
                background: "#e2e8f0", overflow: "hidden",
              }}>
                <div style={{
                  width: `${progressPct}%`, height: "100%", borderRadius: 4,
                  background: "linear-gradient(90deg, #8b5cf6, #7c3aed)",
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
          border: "1px solid #fecaca", color: "#dc2626", fontSize: 13, marginTop: 8,
        }}>
          <div>{error}</div>
          {errorCanRetry && file && !submitting && (
            <button
              type="button"
              onClick={() => gradeAudio()}
              style={{
                marginTop: 8, padding: "8px 16px", borderRadius: 8,
                border: "none", background: "#dc2626", color: "#fff",
                fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {renderResult()}
    </div>
  );
}
