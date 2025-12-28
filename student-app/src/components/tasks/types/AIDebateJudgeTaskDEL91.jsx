// student-app/src/components/tasks/types/AIDebateJudgeTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * AI Debate Judge (AI_DEBATE_JUDGE)
 * - One device per side (recommended).
 * - Students pick Side + Position, then record a timed speech.
 * - Timer counts down from 2:00 to -0:30 (30s overtime grace).
 * - Audio cues:
 *   - 1:45 elapsed (encourages minimum length)
 *   - last 5 seconds to 2:00 (beep each second)
 *   - 2:15 elapsed (penalty zone warning)
 *   - auto stop at 2:30 elapsed
 * - Submits recording + metadata for AI scoring.
 * - Can also “Summon AI Judge” for a final verdict (if debate was recorded elsewhere).
 *
 * Notes:
 * - We support BOTH submission paths:
 *   1) onSubmit(payload) (standard Curriculate task pipeline)
 *   2) socket emit ("ai-judge:submit") for live rooms
 */
export default function AIDebateJudgeTask({
  task,
  socket,
  roomCode,
  onSubmit,
  disabled = false,
  playerTeam,
}) {
  const [verdict, setVerdict] = useState(null);
  const [showFullFeedback, setShowFullFeedback] = useState(false);

  // Recording UI state
  const [side, setSide] = useState("affirmative"); // affirmative | negative
  const [position, setPosition] = useState("introduction"); // intro/first/rebuttal/conclusion
  const [isRecording, setIsRecording] = useState(false);
  const [isJudging, setIsJudging] = useState(false);
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioMime, setAudioMime] = useState("");
  const [meter, setMeter] = useState(0); // 0..1

  // Limits (can be overridden by task/config)
  const mainSeconds = Number(task?.config?.mainSeconds ?? task?.mainSeconds ?? 120) || 120; // 2:00
  const overtimeSeconds = Number(task?.config?.overtimeSeconds ?? task?.overtimeSeconds ?? 30) || 30; // -0:30
  const warnMinSeconds = Number(task?.config?.minSeconds ?? task?.minSeconds ?? 105) || 105; // 1:45 elapsed
  const penaltyMaxSeconds = Number(task?.config?.penaltyMaxSeconds ?? task?.penaltyMaxSeconds ?? 135) || 135; // 2:15 elapsed
  const hardStopSeconds = Number(task?.config?.hardStopSeconds ?? task?.hardStopSeconds ?? 150) || 150; // 2:30 elapsed

  const canRecord = !disabled && !isJudging;

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);

  const rafRef = useRef(0);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const meterDataRef = useRef(null);
  const meterTickRef = useRef(null);

  // Socket verdict listener (existing behaviour preserved)
  useEffect(() => {
    if (!socket) return;

    const handleVerdict = (data) => {
      setVerdict(data);
      setIsJudging(false);
    };

    socket.on("ai-judge:verdict", handleVerdict);
    return () => socket.off("ai-judge:verdict", handleVerdict);
  }, [socket]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      } catch {}
      try {
        if (meterTickRef.current) clearInterval(meterTickRef.current);
      } catch {}
      try {
        if (audioCtxRef.current) audioCtxRef.current.close();
      } catch {}
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (seconds) => {
    const s = Math.abs(seconds);
    const mm = String(Math.floor(s / 60)).padStart(1, "0");
    const ss = String(Math.floor(s % 60)).padStart(2, "0");
    const sign = seconds < 0 ? "-" : "";
    return `${sign}${mm}:${ss}`;
  };

  const countdown = useMemo(() => {
    const elapsedSec = Math.floor(elapsedMs / 1000);
    return mainSeconds - elapsedSec; // can go negative
  }, [elapsedMs, mainSeconds]);

  const bigCountdownText = useMemo(() => fmt(countdown), [countdown]);

  const playBeep = (kind = "tick") => {
    // kind: tick | warn | end
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new AudioContext();
      audioCtxRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // tasteful, not harsh
      const freq = kind === "end" ? 660 : kind === "warn" ? 520 : 440;
      const dur = kind === "end" ? 0.22 : kind === "warn" ? 0.16 : 0.08;

      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0.08;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      // ignore
    }
  };

  const startMeter = async (stream) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      meterDataRef.current = data;

      // Update meter at ~20fps
      if (meterTickRef.current) clearInterval(meterTickRef.current);
      meterTickRef.current = setInterval(() => {
        try {
          const a = analyserRef.current;
          const d = meterDataRef.current;
          if (!a || !d) return;
          a.getByteTimeDomainData(d);
          // RMS
          let sum = 0;
          for (let i = 0; i < d.length; i++) {
            const v = (d[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / d.length);
          // gentle scale
          const scaled = Math.min(1, Math.max(0, rms * 2.2));
          setMeter(scaled);
        } catch {}
      }, 50);
    } catch {
      // ignore
    }
  };

  const stopMeter = () => {
    try {
      if (meterTickRef.current) clearInterval(meterTickRef.current);
    } catch {}
    meterTickRef.current = null;
    analyserRef.current = null;
    meterDataRef.current = null;
    setMeter(0);
  };

  const stopTracks = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    } catch {}
  };

  const stopRecordingInternal = async () => {
    const mr = recorderRef.current;
    if (!mr) return;

    try {
      mr.stop();
    } catch {}

    setIsRecording(false);
  };

  const startRecording = async () => {
    if (!canRecord) return;
    setError("");
    setVerdict(null);
    setShowFullFeedback(false);

    // reset any prior preview
    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    } catch {}
    setAudioUrl("");
    setAudioMime("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      await startMeter(stream);

      // pick best supported mime
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      let chosen = "";
      for (const c of candidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(c)) {
          chosen = c;
          break;
        }
      }
      const rec = new MediaRecorder(stream, chosen ? { mimeType: chosen } : undefined);
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || chosen || "audio/webm",
          });
          setAudioMime(blob.type || rec.mimeType || chosen || "");
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        } catch (err) {
          console.error("Failed creating audio blob:", err);
        } finally {
          stopMeter();
          stopTracks();
        }
      };

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setIsRecording(true);

      rec.start(250);

      // timer loop + cues
      const tick = () => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);

        const sec = Math.floor(elapsed / 1000);

        // cue at 1:45 elapsed
        if (sec === warnMinSeconds) playBeep("warn");

        // last 5 seconds before 2:00
        if (sec >= mainSeconds - 5 && sec < mainSeconds) playBeep("tick");

        // cue at 2:15 elapsed
        if (sec === penaltyMaxSeconds) playBeep("warn");

        // hard stop at 2:30
        if (sec >= hardStopSeconds) {
          playBeep("end");
          stopRecordingInternal();
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      setError("Could not start recording. Please allow microphone access.");
      stopMeter();
      stopTracks();
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch {}
    rafRef.current = 0;

    await stopRecordingInternal();
  };

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

  const submitForJudging = async () => {
    if (!audioUrl || disabled) return;

    setIsJudging(true);
    setError("");

    try {
      // Fetch blob back from object URL
      const resp = await fetch(audioUrl);
      const blob = await resp.blob();
      const dataUrl = await blobToDataUrl(blob);

      const elapsedSec = Math.round(elapsedMs / 1000);

      const payload = {
        type: "ai-debate-judge",
        side,
        position,
        roomCode: roomCode || null,
        teamId:
          task?.teamId ||
          playerTeam?.id ||
          playerTeam?.teamId ||
          playerTeam?.teamID ||
          null,
        startedAt: startedAtRef.current || null,
        elapsedSeconds: elapsedSec,
        minSeconds: warnMinSeconds,
        maxSeconds: mainSeconds,
        penaltyMaxSeconds,
        hardStopSeconds,
        // scoring hints (backend can apply penalties)
        penalties: {
          tooShort: elapsedSec < warnMinSeconds,
          tooLong: elapsedSec > penaltyMaxSeconds,
        },
        audio: {
          mimeType: blob.type || audioMime || "",
          dataUrl, // base64; backend can store/extract
        },
      };

      // Standard task pipeline
      if (typeof onSubmit === "function") {
        onSubmit(payload);
      }

      // Live socket pipeline (optional)
      if (socket) {
        socket.emit("ai-judge:submit", payload);
      }

      // Optionally request verdict right away
      if (socket && roomCode) {
        socket.emit("ai-judge:request", { roomCode });
      }
    } catch (err) {
      console.error(err);
      setError("Could not submit audio for judging.");
      setIsJudging(false);
    }
  };

  const triggerVerdictOnly = () => {
    setIsJudging(true);
    if (socket) socket.emit("ai-judge:request", { roomCode });
  };

  // Verdict view (existing big graphic view preserved)
  if (verdict) {
    return (
      <div
        style={{
          padding: 32,
          fontFamily: "system-ui",
          maxWidth: 1000,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <h1 className="text-6xl font-bold mb-8 text-indigo-800">
          AI DEBATE JUDGE VERDICT
        </h1>

        <div className="text-7xl mb-8" style={{ fontWeight: 900 }}>
          {verdict.winner === "affirmative" ? "Affirmative" : "Negative"}
        </div>

        <div className="text-7xl font-bold mb-10 text-green-600">
          {String(verdict.winner || "").toUpperCase()} WINS!
        </div>

        <div className="grid grid-cols-2 gap-10 text-4xl mb-12">
          <div className="bg-green-100 p-10 rounded-3xl">
            <strong>AFFIRMATIVE</strong>
            <br />
            {verdict?.scores?.affirmative ?? "—"}/100
          </div>
          <div className="bg-red-100 p-10 rounded-3xl">
            <strong>NEGATIVE</strong>
            <br />
            {verdict?.scores?.negative ?? "—"}/100
          </div>
        </div>

        <button
          onClick={() => setShowFullFeedback((v) => !v)}
          className="px-12 py-6 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-3xl rounded-full shadow-2xl hover:shadow-3xl transition"
        >
          {showFullFeedback ? "Hide Full Feedback" : "Read Full Judge’s Feedback"}
        </button>

        {showFullFeedback && (
          <div className="mt-12 bg-white p-10 rounded-3xl shadow-2xl text-left text-xl leading-relaxed">
            <h2 className="text-3xl font-bold mb-6 text-center">
              Judge’s Written Decision
            </h2>
            <div className="whitespace-pre-wrap">{verdict.feedback}</div>
          </div>
        )}
      </div>
    );
  }

  // Main recording UI
  return (
    <div style={{ padding: 26, textAlign: "center" }}>
      <h1 className="text-5xl font-extrabold mb-6 text-indigo-800">
        AI Debate Judge
      </h1>

      <p className="text-2xl mb-8 text-gray-700" style={{ lineHeight: 1.25 }}>
        Pick your side &amp; position, then press <strong>1‑2‑3 Go!</strong> to record.
        <br />
        Aim for <strong>1:45–2:15</strong>. Auto-stops at <strong>2:30</strong>.
      </p>

      {error && (
        <div
          style={{
            margin: "0 auto 12px",
            maxWidth: 860,
            padding: "10px 12px",
            borderRadius: 14,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            textAlign: "left",
            fontSize: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Side + Position */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 14,
          maxWidth: 860,
          margin: "0 auto 12px",
        }}
      >
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(99,102,241,0.25)",
            background: "rgba(99,102,241,0.06)",
            padding: 14,
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 18 }}>
            Side
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { k: "affirmative", label: "Affirmative" },
              { k: "negative", label: "Negative" },
            ].map((opt) => {
              const active = side === opt.k;
              return (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setSide(opt.k)}
                  disabled={!canRecord || isRecording}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: active ? "2px solid #4f46e5" : "1px solid #d1d5db",
                    background: active ? "#eef2ff" : "#ffffff",
                    fontWeight: 900,
                    cursor: !canRecord || isRecording ? "not-allowed" : "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(16,185,129,0.25)",
            background: "rgba(16,185,129,0.06)",
            padding: 14,
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 18 }}>
            Position
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { k: "introduction", label: "Introduction" },
              { k: "first", label: "First" },
              { k: "rebuttal", label: "Rebuttal" },
              { k: "conclusion", label: "Conclusion" },
            ].map((opt) => {
              const active = position === opt.k;
              return (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setPosition(opt.k)}
                  disabled={!canRecord || isRecording}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: active ? "2px solid #16a34a" : "1px solid #d1d5db",
                    background: active ? "#dcfce7" : "#ffffff",
                    fontWeight: 900,
                    cursor: !canRecord || isRecording ? "not-allowed" : "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Big timer + meter */}
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto 14px",
          borderRadius: 22,
          border: "1px solid rgba(15,23,42,0.15)",
          background:
            countdown < 0
              ? "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(99,102,241,0.06))"
              : "linear-gradient(135deg, rgba(99,102,241,0.10), rgba(16,185,129,0.06))",
          padding: 16,
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 950, letterSpacing: 1 }}>
          {bigCountdownText}
        </div>
        <div style={{ marginTop: 8, color: "#334155", fontWeight: 700 }}>
          Target window: <span style={{ fontWeight: 950 }}>1:45–2:15</span> (penalty outside)
        </div>

        <div
          style={{
            marginTop: 12,
            height: 16,
            borderRadius: 999,
            background: "rgba(15,23,42,0.08)",
            overflow: "hidden",
          }}
          aria-label="Microphone level"
          title="Microphone level"
        >
          <div
            style={{
              height: "100%",
              width: `${Math.round(meter * 100)}%`,
              background:
                meter > 0.65
                  ? "linear-gradient(90deg, #22c55e, #16a34a)"
                  : meter > 0.25
                  ? "linear-gradient(90deg, #38bdf8, #0ea5e9)"
                  : "linear-gradient(90deg, #a78bfa, #6366f1)",
              transition: "width 60ms linear",
            }}
          />
        </div>

        <div style={{ marginTop: 8, fontSize: 14, color: "#64748b" }}>
          {isRecording ? "Listening…" : "Press 1‑2‑3 Go to start listening."}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={!canRecord}
            className="px-14 py-10 bg-gradient-to-r from-indigo-700 to-purple-700 text-white text-4xl font-extrabold rounded-full shadow-2xl hover:shadow-3xl transition disabled:opacity-50"
            style={{ letterSpacing: 1 }}
          >
            1‑2‑3 GO!
          </button>
        ) : (
          <button
            onClick={stopRecording}
            disabled={!canRecord}
            className="px-10 py-8 bg-gradient-to-r from-red-600 to-rose-700 text-white text-3xl font-extrabold rounded-full shadow-2xl hover:shadow-3xl transition disabled:opacity-50"
          >
            Stop
          </button>
        )}

        <button
          onClick={triggerVerdictOnly}
          disabled={!socket || isJudging || isRecording || disabled}
          className="px-10 py-8 bg-gradient-to-r from-purple-700 to-pink-700 text-white text-3xl font-extrabold rounded-full shadow-2xl hover:shadow-3xl transition disabled:opacity-50"
          title="Use this if your debate audio was already captured elsewhere."
        >
          {isJudging ? "AI IS JUDGING…" : "SUMMON AI JUDGE"}
        </button>
      </div>

      {/* Playback + Submit */}
      {audioUrl && (
        <div
          style={{
            maxWidth: 860,
            margin: "16px auto 0",
            padding: 14,
            borderRadius: 18,
            border: "1px solid rgba(15,23,42,0.12)",
            background: "#ffffff",
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 8, fontSize: 18 }}>
            Recording Preview
          </div>

          <audio controls src={audioUrl} style={{ width: "100%" }} />

          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ color: "#334155", fontWeight: 700 }}>
              Length: <span style={{ fontWeight: 950 }}>{fmt(Math.floor(elapsedMs / 1000) - 0)}</span>{" "}
              <span style={{ color: "#64748b", fontWeight: 600 }}>
                (Aim 1:45–2:15)
              </span>
            </div>

            <button
              type="button"
              onClick={submitForJudging}
              disabled={isJudging || disabled}
              style={{
                padding: "12px 14px",
                borderRadius: 999,
                border: "none",
                background: isJudging ? "#9ca3af" : "#16a34a",
                color: "#ffffff",
                fontWeight: 950,
                fontSize: 18,
                cursor: isJudging || disabled ? "not-allowed" : "pointer",
              }}
              title="Send your recorded speech to the AI judge for scoring + feedback."
            >
              {isJudging ? "Submitting…" : "Submit for AI Judging ✅"}
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
            Penalty rules: under <strong>1:45</strong> or over <strong>2:15</strong>.
            Recording auto-stops at <strong>2:30</strong>.
          </div>
        </div>
      )}

      {isJudging && (
        <div className="mt-10 text-3xl text-purple-600 animate-pulse">
          AI is analyzing speeches, logic, delivery, and rebuttals…
        </div>
      )}
    </div>
  );
}
