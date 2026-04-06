// student-app/src/components/tasks/types/RecordAudioTask.jsx
import React, { useState, useRef, useEffect, useCallback } from "react";

// ── Parse minimum-seconds from task config or prompt text ─────────────────
function parseMinSeconds(task) {
  const fromConfig = Number(task?.config?.minSeconds ?? task?.minSeconds ?? task?.config?.minimumSeconds ?? 0);
  if (fromConfig > 0) return fromConfig;
  // Scan prompt for patterns like "20s minimum", "at least 30 seconds", "minimum 20"
  const text = String(task?.prompt || "");
  const m =
    text.match(/(\d+)\s*s(?:ec(?:onds?)?)?\s*min(?:imum)?/i) ||
    text.match(/min(?:imum)?\s+(?:of\s+)?(\d+)\s*s/i) ||
    text.match(/at\s+least\s+(\d+)\s*s/i);
  if (m) return parseInt(m[1], 10);
  return 0; // no minimum
}

export default function RecordAudioTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [isRecording, setIsRecording]       = useState(false);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [audioUrl, setAudioUrl]             = useState(null);
  const [duration, setDuration]             = useState(0);
  const [hasRecording, setHasRecording]     = useState(false);
  const [errorMsg, setErrorMsg]             = useState(null);
  const [isPreparingSubmit, setIsPreparingSubmit] = useState(false);

  // ── Minimum-time enforcement ──────────────────────────────────────────────
  const minSeconds = parseMinSeconds(task);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedRef   = useRef(0);
  const countUpRef   = useRef(null);
  const canStop      = minSeconds <= 0 || elapsedSeconds >= minSeconds;
  const remaining    = minSeconds > 0 ? Math.max(0, minSeconds - elapsedSeconds) : 0;

  // ── Audio level meter (WebAudio API) ─────────────────────────────────────
  const [audioLevel, setAudioLevel]         = useState(0);   // 0..1
  const [micActive, setMicActive]           = useState(false); // has signal above threshold
  const analyserRef     = useRef(null);
  const audioCtxRef     = useRef(null);
  const animFrameRef    = useRef(null);
  const levelDataRef    = useRef(null);
  // Rolling peak for the bar display
  const [barHeights, setBarHeights]         = useState(Array(12).fill(0.15));
  const barRef          = useRef(Array(12).fill(0.15));

  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const audioRef         = useRef(null);
  const streamRef        = useRef(null);
  const autoStopRef      = useRef(null);

  // ── S3 upload ─────────────────────────────────────────────────────────────
  const presignAndUploadToS3 = async ({ blob, contentType, purpose }) => {
    const roomCode = task?.roomCode || task?.config?.roomCode || null;
    const teamId   = task?.teamId   || task?.config?.teamId   || null;
    if (!roomCode || !teamId) throw new Error("Missing roomCode/teamId for S3 upload.");

    const presignController = new AbortController();
    const presignTimeout = setTimeout(() => presignController.abort(), 6000);
    let presignResp;
    try {
      presignResp = await fetch("/api/media/presign", {
        method: "POST",
        signal: presignController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode, teamId,
          taskType: "record-audio",
          contentType: contentType || blob.type || "application/octet-stream",
          purpose: purpose || "audio",
          fileName: `record-audio-${Date.now()}`,
        }),
      });
    } finally { clearTimeout(presignTimeout); }

    const presignJson = await presignResp.json().catch(() => null);
    if (!presignResp.ok || !presignJson?.uploadUrl || !presignJson?.key) {
      throw new Error(presignJson?.error || "Presign failed.");
    }

    const putController = new AbortController();
    const putTimeout = setTimeout(() => putController.abort(), 15000);
    let putResp;
    try {
      putResp = await fetch(presignJson.uploadUrl, {
        method: "PUT",
        signal: putController.signal,
        headers: { "Content-Type": contentType || blob.type || "application/octet-stream" },
        body: blob,
      });
    } finally { clearTimeout(putTimeout); }
    if (!putResp.ok) throw new Error("Upload to S3 failed.");

    return { s3Key: presignJson.key, signedGetUrl: presignJson.signedGetUrl || null };
  };

  // ── Draft restore ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (answerDraft?.audioUrl) {
      setAudioUrl(answerDraft.audioUrl);
      setHasRecording(true);
      if (answerDraft.duration) setDuration(answerDraft.duration);
    }
  }, [answerDraft]);

  useEffect(() => {
    setErrorMsg(null);
    setIsPreparingSubmit(false);
  }, [task?.id, task?.taskType, task?.prompt]);

  // ── Cleanup helpers ───────────────────────────────────────────────────────
  const stopLevelMeter = useCallback(() => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (audioCtxRef.current)  { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current  = null;
    levelDataRef.current = null;
    setAudioLevel(0);
    setMicActive(false);
    setBarHeights(Array(12).fill(0.15));
    barRef.current = Array(12).fill(0.15);
  }, []);

  const stopCountUp = useCallback(() => {
    if (countUpRef.current) { clearInterval(countUpRef.current); countUpRef.current = null; }
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Level meter loop ──────────────────────────────────────────────────────
  const startLevelMeter = useCallback((stream) => {
    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize             = 256;
      analyser.smoothingTimeConstant = 0.6;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioCtxRef.current  = ctx;
      analyserRef.current  = analyser;
      levelDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const NUM_BARS = 12;
      const THRESHOLD = 0.08; // mic-active threshold

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(levelDataRef.current);

        // RMS of waveform data (centre around 128)
        let sum = 0;
        for (let i = 0; i < levelDataRef.current.length; i++) {
          const v = (levelDataRef.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / levelDataRef.current.length);
        const level = Math.min(1, rms * 4); // scale up so it's visible

        setAudioLevel(level);
        setMicActive(level > THRESHOLD);

        // Cascade bars: shift left, append new reading with some jitter for bars
        const prev = barRef.current;
        const next = [...prev.slice(1)];
        // Add noise to neighbouring bars so it looks like a proper spectrum
        const base = Math.max(0.12, level);
        next.push(Math.min(1, base * (0.6 + Math.random() * 0.8)));
        // Smooth each bar toward new value
        const smoothed = next.map((v, i) => prev[i + 1] !== undefined
          ? prev[i + 1] * 0.4 + v * 0.6
          : v);
        barRef.current = smoothed;
        setBarHeights([...smoothed]);

        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn("AudioContext unavailable:", e);
    }
  }, []);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = async () => {
    if (disabled) return;
    setErrorMsg(null);
    elapsedRef.current = 0;
    setElapsedSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      startLevelMeter(stream);

      // Count up elapsed seconds
      countUpRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsedSeconds(elapsedRef.current);
      }, 1000);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setHasRecording(true);

        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          const secs = Math.ceil(audio.duration || 0);
          setDuration(secs);
          if (onAnswerChange) onAnswerChange({ audioBlob, audioUrl: url, duration: secs, recorded: true });
        };
        cleanupStream();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setHasRecording(false);

      // Auto-stop at 90s max
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 90000);
    } catch (err) {
      console.error("Microphone access denied", err);
      setErrorMsg("Microphone access is required. Please allow microphone access and try again.");
    }
  };

  // ── Stop recording ────────────────────────────────────────────────────────
  const stopRecording = () => {
    if (!canStop) return; // guard: minimum not yet reached
    if (!mediaRecorderRef.current) return;
    try {
      if (mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
    } catch (e) { console.warn("Error stopping recorder", e); }

    setIsRecording(false);
    stopCountUp();
    stopLevelMeter();
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetRecording = () => {
    setAudioUrl(null);
    setHasRecording(false);
    setDuration(0);
    setIsRecording(false);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    setErrorMsg(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    stopCountUp();
    stopLevelMeter();
    cleanupStream();
    if (onAnswerChange) onAnswerChange(null);
  };

  // ── Playback ──────────────────────────────────────────────────────────────
  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) { audioRef.current.pause(); }
    else           { audioRef.current.play();  }
    setIsPlaying((p) => !p);
  };

  useEffect(() => {
    if (!audioRef.current) return;
    const el = audioRef.current;
    el.onended = () => setIsPlaying(false);
    return () => { el.onended = null; };
  }, [audioUrl]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopCountUp();
      stopLevelMeter();
      cleanupStream();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!hasRecording || disabled || !audioUrl || isPreparingSubmit) return;
    setErrorMsg(null);
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
    setIsPreparingSubmit(true);

    try {
      const blob = await fetch(audioUrl).then((r) => r.blob());
      let payload = null;
      let s3 = null;
      try {
        s3 = await presignAndUploadToS3({ blob, contentType: blob.type || "audio/webm", purpose: "audio" });
      } catch (e) { console.warn("S3 upload unavailable, falling back:", e); }

      if (s3?.s3Key) {
        payload = { type: "record-audio", s3Key: s3.s3Key, signedGetUrl: s3.signedGetUrl, duration, mimeType: blob.type || "audio/webm" };
      } else {
        payload = { type: "record-audio", recorded: true, duration, mimeType: blob.type || "audio/webm", note: "audio-not-uploaded" };
      }

      await Promise.resolve(onSubmit?.(payload));
      setIsPreparingSubmit(false);
    } catch (err) {
      console.error("Error preparing recorded audio for submit", err);
      setErrorMsg("There was a problem preparing your recording. Please try again.");
      setIsPreparingSubmit(false);
    }
  };

  // ── Derived display values ────────────────────────────────────────────────
  const stopLabel = isRecording
    ? canStop
      ? "STOP"
      : `STOP (${remaining}s)`
    : null;

  return (
    <div
      className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-purple-700 via-pink-600 to-red-600 text-white"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <h2 className="text-6xl font-black mb-4 drop-shadow-2xl animate-pulse">
        RECORD YOUR VOICE!
      </h2>

      <p className="text-3xl text-center mb-8 max-w-4xl leading-tight">
        {task.prompt || "Record your voice so your teacher can listen later."}
      </p>

      {/* Instructions */}
      <div className="w-full max-w-4xl mb-8">
        <div className="bg-black/30 backdrop-blur-lg rounded-3xl p-6 border border-white/20 shadow-2xl">
          <div className="text-2xl font-extrabold mb-3">How to do this task</div>
          <ol className="text-lg leading-relaxed list-decimal pl-6 opacity-95">
            <li>Tap <strong>START</strong> to begin recording.</li>
            <li>EVERY team member must add to the recording. Speak clearly.{" "}
              {minSeconds > 0 && <span>Keep going until the timer reaches <strong>{minSeconds}s</strong>. </span>}
              Tap <strong>STOP</strong> when you are finished.
            </li>
            <li>Tap <strong>Play</strong> to listen. If needed, tap <strong>Re-record</strong>.</li>
            <li>When you are happy with it, tap <strong>Submit Recording</strong>.</li>
          </ol>
        </div>
      </div>

      {errorMsg && (
        <div className="w-full max-w-4xl mb-6">
          <div className="bg-red-500/20 border border-red-200/40 rounded-2xl p-4 text-xl font-bold">
            {errorMsg}
          </div>
        </div>
      )}

      {/* ── MAIN BUTTON ── */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || (isRecording && !canStop)}
        className={`
          relative w-64 h-64 rounded-full shadow-2xl transition-all transform select-none
          ${isRecording
            ? canStop
              ? "bg-red-600 ring-8 ring-red-400 scale-110 cursor-pointer"
              : "bg-red-800 ring-8 ring-red-900/60 scale-110 cursor-not-allowed opacity-80"
            : "bg-gradient-to-r from-green-500 to-teal-500 hover:scale-110 cursor-pointer"
          }
          ${disabled ? "opacity-60 cursor-not-allowed" : ""}
        `}
      >
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <span className="text-7xl">🎙️</span>
          <span className="text-3xl font-black mt-1 tracking-wide">
            {isRecording ? stopLabel : "START"}
          </span>
          {isRecording && (
            <span className="text-2xl font-bold opacity-90 tabular-nums">
              {elapsedSeconds}s
            </span>
          )}
        </div>
      </button>

      {/* ── AUDIO LEVEL METER ── shown while recording ── */}
      {isRecording && (
        <div className="mt-8 flex flex-col items-center gap-3 w-full max-w-sm">
          {/* Mic-active indicator */}
          <div className="flex items-center gap-2">
            <div
              style={{
                width: 14, height: 14, borderRadius: "50%",
                background: micActive ? "#22c55e" : "#6b7280",
                boxShadow: micActive ? "0 0 10px 3px #22c55e" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            />
            <span className="text-base font-semibold opacity-80">
              {micActive ? "Mic is picking up sound ✓" : "Speak louder — mic is not detecting sound"}
            </span>
          </div>

          {/* Bar visualizer */}
          <div
            className="flex items-end gap-1 rounded-2xl px-4 py-3"
            style={{ background: "rgba(0,0,0,0.35)", height: 72, width: "100%" }}
          >
            {barHeights.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(8, Math.round(h * 52))}px`,
                  borderRadius: 4,
                  background: h > 0.5
                    ? "#22c55e"
                    : h > 0.2
                    ? "#86efac"
                    : "#d1fae5",
                  transition: "height 0.06s ease-out, background 0.1s",
                  opacity: 0.9,
                }}
              />
            ))}
          </div>

          {/* Min-time progress bar */}
          {minSeconds > 0 && (
            <div className="w-full">
              <div className="flex justify-between text-sm opacity-70 mb-1">
                <span>Recording time</span>
                <span>{elapsedSeconds}s / {minSeconds}s minimum</span>
              </div>
              <div className="w-full rounded-full h-3" style={{ background: "rgba(255,255,255,0.2)" }}>
                <div
                  style={{
                    width: `${Math.min(100, (elapsedSeconds / minSeconds) * 100)}%`,
                    height: "100%",
                    borderRadius: 9999,
                    background: canStop ? "#22c55e" : "#facc15",
                    transition: "width 0.4s linear, background 0.3s",
                  }}
                />
              </div>
              {!canStop && (
                <div className="text-center text-sm mt-1 font-semibold text-yellow-200">
                  Keep recording — {remaining}s to go
                </div>
              )}
              {canStop && (
                <div className="text-center text-sm mt-1 font-semibold text-green-300">
                  Minimum reached — tap STOP when ready ✓
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── PLAYBACK / SUBMIT ── */}
      {hasRecording && (
        <div className="mt-10 bg-black/30 backdrop-blur-lg rounded-3xl p-8 w-full max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <span className="text-3xl">Recording ready ({duration}s)</span>
            <button
              onClick={togglePlayback}
              disabled={disabled || isPreparingSubmit}
              className="px-8 py-4 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
          </div>

          <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} />

          <div className="mt-6 flex gap-4">
            <button
              onClick={resetRecording}
              disabled={disabled || isPreparingSubmit}
              className="px-6 py-3 bg-red-600 rounded-xl text-xl font-bold hover:bg-red-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Re-record
            </button>
            <button
              onClick={handleSubmit}
              disabled={disabled || isPreparingSubmit || isPlaying}
              className="px-10 py-5 bg-gradient-to-r from-green-500 to-teal-500 rounded-2xl text-4xl font-bold hover:scale-105 transition shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPreparingSubmit ? "Submitting..." : "Submit Recording"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
