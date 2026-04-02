// student-app/src/components/tasks/types/RecordAudioTask.jsx
import React, { useState, useRef, useEffect } from "react";

export default function RecordAudioTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isPreparingSubmit, setIsPreparingSubmit] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);


  const presignAndUploadToS3 = async ({ blob, contentType, purpose }) => {
    const roomCode = task?.roomCode || task?.config?.roomCode || null;
    const teamId = task?.teamId || task?.config?.teamId || null;

    // In normal sessions, roomCode/teamId are usually baked into task by TaskRunner.
    if (!roomCode || !teamId) {
      throw new Error("Missing roomCode/teamId for S3 upload.");
    }

    const presignResp = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode,
        teamId,
        taskType: "record-audio",
        contentType: contentType || blob.type || "application/octet-stream",
        purpose: purpose || "audio",
        fileName: `record-audio-${Date.now()}`,
      }),
    });

    const presignJson = await presignResp.json().catch(() => null);
    if (!presignResp.ok || !presignJson?.uploadUrl || !presignJson?.key) {
      throw new Error(presignJson?.error || "Presign failed.");
    }

    const putResp = await fetch(presignJson.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType || blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!putResp.ok) throw new Error("Upload to S3 failed.");

    return { s3Key: presignJson.key, signedGetUrl: presignJson.signedGetUrl || null };
  };


  // Load existing answer if draft exists (e.g., from reload)
  useEffect(() => {
    if (answerDraft?.audioUrl) {
      setAudioUrl(answerDraft.audioUrl);
      setHasRecording(true);
      if (answerDraft.duration) setDuration(answerDraft.duration);
    }
  }, [answerDraft]);

  // Clear any old error when task changes
  useEffect(() => {
    setErrorMsg(null);
    setIsPreparingSubmit(false);
  }, [task?.id, task?.taskType, task?.prompt]);

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    if (disabled) return;
    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setHasRecording(true);

        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          const secs = Math.ceil(audio.duration || 0);
          setDuration(secs);

          // Save to draft with correct duration once known
          const payload = {
            audioBlob,
            audioUrl: url,
            duration: secs,
            recorded: true,
          };
          if (onAnswerChange) onAnswerChange(payload);
        };

        cleanupStream();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setHasRecording(false);

      // Auto-stop after 90 seconds max – rely on recorder state, not React state closure
      timerRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state === "recording"
        ) {
          mediaRecorderRef.current.stop();
        }
      }, 90000);
    } catch (err) {
      console.error("Microphone access denied", err);
      setErrorMsg("Microphone access is required. Please allow microphone access and try again.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;

    try {
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    } catch (e) {
      console.warn("Error stopping recorder", e);
    }

    setIsRecording(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetRecording = () => {
    setAudioUrl(null);
    setHasRecording(false);
    setDuration(0);
    setIsRecording(false);
    setErrorMsg(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    cleanupStream();

    if (onAnswerChange) onAnswerChange(null);
  };

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying((prev) => !prev);
  };

  useEffect(() => {
    if (!audioRef.current) return;

    const audioEl = audioRef.current;
    audioEl.onended = () => setIsPlaying(false);

    return () => {
      audioEl.onended = null;
    };
  }, [audioUrl]);

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
        s3 = await presignAndUploadToS3({
          blob,
          contentType: blob.type || "audio/webm",
          purpose: "audio",
        });
      } catch (e) {
        console.warn("S3 upload unavailable, falling back to base64:", e);
      }

      if (s3?.s3Key) {
        payload = {
          type: "record-audio",
          s3Key: s3.s3Key,
          signedGetUrl: s3.signedGetUrl,
          duration,
          mimeType: blob.type || "audio/webm",
        };
      } else {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              resolve(String(reader.result || "").split(",")[1] || "");
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        payload = {
          type: "record-audio",
          base64,
          duration,
          mimeType: blob.type || "audio/webm",
        };
      }

      await Promise.resolve(onSubmit?.(payload));

      // If parent does not immediately advance, at least don't stay stuck forever.
      setIsPreparingSubmit(false);
    } catch (err) {
      console.error("Error preparing recorded audio for submit", err);
      setErrorMsg("There was a problem preparing your recording. Please try again.");
      setIsPreparingSubmit(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-purple-700 via-pink-600 to-red-600 text-white"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <h2 className="text-6xl font-black mb-4 drop-shadow-2xl animate-pulse">
        RECORD YOUR VOICE!
      </h2>

      <p className="text-xl mb-6 max-w-3xl text-center opacity-90">
        Your teacher will receive this audio recording to listen to later
        &mdash; it might be music, language practice, or a spoken answer.
      </p>

      <p className="text-3xl text-center mb-12 max-w-4xl leading-tight">
        {task.prompt ||
          "Record your voice so your teacher can listen later – this could be music, language practice, or a spoken answer to the question."}
      </p>

      {/* Clear, student-friendly instructions (Grade 7 level) */}
      <div className="w-full max-w-4xl mb-10">
        <div className="bg-black/30 backdrop-blur-lg rounded-3xl p-6 border border-white/20 shadow-2xl">
          <div className="text-2xl font-extrabold mb-3">How to do this task</div>
          <ol className="text-lg leading-relaxed list-decimal pl-6 opacity-95">
            <li>Tap <strong>START</strong> to begin recording.</li>
            <li>EVERY team member must add to the recording. Speak clearly. Tap <strong>STOP</strong> when you are finished.</li>
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

      {/* Recording Button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled}
        className={`
          relative w-64 h-64 rounded-full shadow-2xl transition-all transform
          ${
            isRecording
              ? "bg-red-600 animate-pulse ring-8 ring-red-400 scale-110"
              : "bg-gradient-to-r from-green-500 to-teal-500 hover:scale-110"
          }
          ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <div className="flex flex-col items-center justify-center h-full">
          {isRecording ? (
            <>
              <span className="text-9xl">🎙️</span>
              <span className="text-4xl font-bold mt-4">STOP</span>
            </>
          ) : (
            <>
              <span className="text-9xl">🎙️</span>
              <span className="text-4xl font-bold mt-4">START</span>
            </>
          )}
        </div>

        {/* Live waveform animation */}
        {isRecording && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-3 bg-white rounded-full"
                  style={{
                    animation: "wave 1.2s ease-in-out infinite",
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </button>

      {/* Preview & Controls */}
      {hasRecording && (
        <div className="mt-12 bg-black/30 backdrop-blur-lg rounded-3xl p-8 w-full max-w-2xl">
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

          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
          />

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

      {/* Local styles for waveform animation */}
      <style>
        {`
          @keyframes wave {
            0%, 100% { transform: scaleY(0.4); }
            50% { transform: scaleY(1); }
          }
          .animate-wave {
            animation: wave 1.2s ease-in-out infinite;
          }
        `}
      </style>
    </div>
  );
}
