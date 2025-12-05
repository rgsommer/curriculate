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

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  // Load existing answer if draft exists (e.g. from reload
  useEffect(() => {
    if (answerDraft?.audioUrl) {
      setAudioUrl(answerDraft.audioUrl);
      setHasRecording(true);
      if (answerDraft.duration) setDuration(answerDraft.duration);
    }
  }, [answerDraft]);

  const startRecording = async () => {
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
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setHasRecording(true);

        // Estimate duration
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          setDuration(Math.ceil(audio.duration));
        };

        // Save to draft
        const payload = {
          audioBlob,
          audioUrl: url,
          duration: Math.ceil(audio.duration || 0),
          recorded: true,
        };
        if (onAnswerChange) onAnswerChange(payload);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setHasRecording(false);

      // Auto-stop after 90 seconds max
      timerRef.current = setTimeout(() => {
        if (isRecording) stopRecording();
      }, 90000);
    } catch (err) {
      console.error("Microphone access denied", err);
      alert("Microphone access is required for this task.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      clearTimeout(timerRef.current);
    }
  };

  const resetRecording = () => {
    setAudioUrl(null);
    setHasRecording(false);
    setDuration(0);
    setIsRecording(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (onAnswerChange) onAnswerChange(null);
  };

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setIsPlaying(false);
    }
  }, [audioUrl]);

  const handleSubmit = () => {
    if (!hasRecording || disabled) return;

    // Submit base64 for backend storage (or upload separately)
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(",")[1];
      onSubmit({
        type: "audio",
        base64,
        duration,
        mimeType: "audio/webm",
      });
    };

    fetch(audioUrl)
      .then((res) => res.blob())
      .then((blob) => reader.readAsDataURL(blob));
  };

  return (
    <div
      className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-purple-700 via-pink-600 to-red-600 text-white"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <h2 className="text-6xl font-black mb-8 drop-shadow-2xl animate-pulse">
        RECORD YOUR VOICE!
      </h2>

      <p className="text-3xl text-center mb-12 max-w-4xl leading-tight">
        {task.prompt || "Speak clearly and tell us your answer!"}
      </p>

      {/* Recording Button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled}
        className={`
          relative w-64 h-64 rounded-full shadow-2xl transition-all transform
          ${isRecording 
            ? "bg-red-600 animate-pulse ring-8 ring-red-400 scale-110" 
            : "bg-gradient-to-r from-green-500 to-teal-500 hover:scale-110"
          }
          ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <div className="flex flex-col items-center justify-center h-full">
          {isRecording ? (
            <>
              <span className="text-9xl">Microphone</span>
              <span className="text-4xl font-bold mt-4">STOP</span>
            </>
          ) : (
            <>
              <span className="text-9xl">Microphone</span>
              <span className="text-4xl font-bold mt-4">START</span>
            </>
          )}
        </div>

        {/* Live waveform animation */}
        {isRecording && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex gap-2">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="w-3 bg-white rounded-full animate-wave"
                  style={{
                    height: `${20 + Math.sin(i + Date.now() / 100) * 30}px`,
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
              className="px-8 py-4 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 transition"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
          </div>

          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
          />

          <button
            onClick={resetRecording}
            className="mr-4 px-6 py-3 bg-red-600 rounded-xl text-xl font-bold hover:bg-red-700 transition"
          >
            Re-record
          </button>

          <button
            onClick={handleSubmit}
            disabled={disabled}
            className="px-10 py-5 bg-gradient-to-r from-green-500 to-teal-500 rounded-2xl text-4xl font-bold hover:scale-105 transition shadow-2xl"
          >
            Submit Recording
          </button>
        </div>
      )}

      {/* Hidden audio element */}
      <audio ref={audioRef} />

      <style jsx>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}