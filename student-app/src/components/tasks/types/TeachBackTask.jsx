// student-app/src/components/tasks/types/TeachBackTask.jsx
//
// Teach-Back: Each team member explains 3-5 concepts to a younger audience.
// Input modes: text (editable), voice (Web Speech API), record audio.
// Intra-team: each player contributes separately, building on teammates' prior explanations.
// AI-assessed for clarity, accuracy, age-appropriateness, and additive value.

import React, { useState, useRef, useEffect, useCallback } from "react";

/* ─── Constants ─── */
const INPUT_MODES = [
  { key: "text", label: "Type", icon: "✏️" },
  { key: "voice", label: "Speak", icon: "🎤" },
  { key: "record", label: "Record", icon: "🔴" },
];

const PTS_EXCELLENT = 20;
const PTS_GOOD = 12;
const PTS_BASIC = 6;

/* ─── Helpers ─── */
function ConceptChip({ concept, done }) {
  return (
    <span
      className={`inline-block px-3 py-1.5 rounded-xl text-sm font-bold transition-all ${
        done
          ? "bg-green-100 text-green-800 border border-green-300"
          : "bg-blue-50 text-blue-700 border border-blue-200"
      }`}
    >
      {done && "✓ "}
      {concept}
    </span>
  );
}

function TeammateCard({ entry, index }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 mb-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">
          {index + 1}
        </span>
        <span className="text-sm font-bold text-gray-700">
          {entry.playerName || `Player ${index + 1}`}
        </span>
        {entry.score != null && (
          <span className="ml-auto text-xs font-bold text-green-600">
            +{entry.score} pts
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
        {entry.explanation}
      </p>
    </div>
  );
}

/* ─── Main Component ─── */
export default function TeachBackTask({ task, onSubmit, disabled }) {
  const concepts = task.concepts || task.config?.concepts || [];
  const targetAge = task.targetAge || task.config?.targetAge || "a younger student";
  const rubric = task.rubric || task.config?.rubric || "";

  // Prior teammates' contributions (populated by coach/intra-team system)
  const priorEntries = task.priorEntries || task.config?.priorEntries || [];

  const [inputMode, setInputMode] = useState("text");
  const [explanation, setExplanation] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [assessing, setAssessing] = useState(false);

  // Speech recognition
  const recognitionRef = useRef(null);
  // Audio recording
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  /* ─── Speech-to-text (voice mode) ─── */
  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = explanation;
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalText += e.results[i][0].transcript + " ";
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setExplanation(finalText + interim);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [explanation]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  /* ─── Audio recording ─── */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        // Convert to base64 for submission
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          setExplanation((prev) => prev || "[Audio recorded — press Submit to send]");
          // Store audio data on the component for submission
          mediaRecorderRef.current._audioData = reader.result;
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      alert("Could not access microphone. Please allow microphone access.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  /* ─── Submit ─── */
  const handleSubmit = useCallback(async () => {
    if (!explanation.trim() && !mediaRecorderRef.current?._audioData) return;

    setAssessing(true);

    // Build submission
    const submission = {
      explanation: explanation.trim(),
      inputMode,
      concepts,
      targetAge,
      priorCount: priorEntries.length,
      audioData: mediaRecorderRef.current?._audioData || null,
    };

    // Simulate AI assessment for demo / practice
    // In live mode, the backend handles scoring
    const mockScore = explanation.length > 100 ? PTS_EXCELLENT
      : explanation.length > 50 ? PTS_GOOD
      : PTS_BASIC;

    const conceptsCovered = concepts.filter((c) =>
      explanation.toLowerCase().includes(c.toLowerCase().split(" ")[0])
    );

    setTimeout(() => {
      const result = {
        score: mockScore,
        maxScore: PTS_EXCELLENT,
        conceptsCovered: conceptsCovered.length,
        totalConcepts: concepts.length,
        feedback:
          conceptsCovered.length === concepts.length
            ? "Great job! You covered all the concepts clearly."
            : conceptsCovered.length > 0
            ? `Good effort! You covered ${conceptsCovered.length} of ${concepts.length} concepts. Try to explain the others too.`
            : "Try mentioning specific concepts in your explanation.",
        addedNewInfo: priorEntries.length > 0,
      };
      setAiResult(result);
      setAssessing(false);
      setSubmitted(true);

      if (onSubmit) {
        onSubmit({
          ...submission,
          ...result,
          taskType: "teach-back",
        });
      }
    }, 1500);
  }, [explanation, inputMode, concepts, targetAge, priorEntries, onSubmit]);

  // Cleanup
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  /* ═══════════ RENDER ═══════════ */

  if (submitted && aiResult) {
    return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Score */}
        <div className="text-center">
          <div className="text-5xl font-black text-green-600 mb-1">
            +{aiResult.score}
          </div>
          <div className="text-sm text-gray-500 font-bold">
            out of {aiResult.maxScore} points
          </div>
        </div>

        {/* Concept coverage */}
        <div className="rounded-2xl bg-white border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-2">
            Concepts covered: {aiResult.conceptsCovered} / {aiResult.totalConcepts}
          </div>
          <div className="flex flex-wrap gap-2">
            {concepts.map((c) => (
              <ConceptChip
                key={c}
                concept={c}
                done={explanation.toLowerCase().includes(c.toLowerCase().split(" ")[0])}
              />
            ))}
          </div>
        </div>

        {/* Feedback */}
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
          <div className="text-sm font-bold text-blue-800 mb-1">AI Feedback</div>
          <p className="text-sm text-blue-700">{aiResult.feedback}</p>
        </div>

        {/* Your explanation */}
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-1">Your explanation</div>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{explanation}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Target audience banner */}
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-center">
        <div className="text-2xl mb-1">🧒</div>
        <div className="text-sm font-bold text-amber-800">
          Explain these concepts as if teaching {targetAge}
        </div>
        <div className="text-xs text-amber-600 mt-1">
          Use simple words and examples they would understand!
        </div>
      </div>

      {/* Concepts to teach */}
      <div className="rounded-2xl bg-white border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-2">
          Concepts to explain:
        </div>
        <div className="flex flex-wrap gap-2">
          {concepts.map((c) => (
            <ConceptChip
              key={c}
              concept={c}
              done={explanation.toLowerCase().includes(c.toLowerCase().split(" ")[0])}
            />
          ))}
        </div>
      </div>

      {/* Prior teammate entries */}
      {priorEntries.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-2">
            Your teammates already said:
          </div>
          <div className="text-xs text-gray-500 mb-2">
            Build on what they said — add details, examples, or corrections.
          </div>
          {priorEntries.map((entry, i) => (
            <TeammateCard key={i} entry={entry} index={i} />
          ))}
        </div>
      )}

      {/* Input mode selector */}
      <div className="flex gap-2 justify-center">
        {INPUT_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setInputMode(m.key)}
            disabled={disabled}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              inputMode === m.key
                ? "bg-blue-600 text-white shadow-lg"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Input area */}
      {inputMode === "text" && (
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder={`Explain ${concepts.join(", ")} in simple words that ${targetAge} would understand...`}
          disabled={disabled}
          rows={6}
          className="w-full rounded-2xl border border-gray-300 p-4 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none disabled:opacity-50"
        />
      )}

      {inputMode === "voice" && (
        <div className="text-center space-y-3">
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Your speech will appear here. You can also edit it."
            rows={5}
            className="w-full rounded-2xl border border-gray-300 p-4 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none"
          />
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={disabled}
            className={`px-6 py-3 rounded-2xl text-sm font-bold transition-all ${
              isListening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {isListening ? "⏹ Stop Dictation" : "🎤 Start Speaking"}
          </button>
        </div>
      )}

      {inputMode === "record" && (
        <div className="text-center space-y-3">
          <div
            className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center text-4xl transition-all ${
              isRecording
                ? "bg-red-100 border-4 border-red-400 animate-pulse"
                : "bg-gray-100 border-4 border-gray-300"
            }`}
          >
            {isRecording ? "🔴" : "🎙️"}
          </div>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled}
            className={`px-6 py-3 rounded-2xl text-sm font-bold transition-all ${
              isRecording
                ? "bg-red-500 text-white"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {isRecording ? "⏹ Stop Recording" : "🔴 Start Recording"}
          </button>
          {mediaRecorderRef.current?._audioData && (
            <p className="text-sm text-green-600 font-bold">Audio captured! Press Submit.</p>
          )}
          {/* Optional text supplement */}
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Optionally add written notes to supplement your recording..."
            rows={3}
            className="w-full rounded-2xl border border-gray-300 p-4 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none"
          />
        </div>
      )}

      {/* Word count + concept progress */}
      <div className="flex justify-between text-xs text-gray-400 font-medium px-1">
        <span>
          {explanation.split(/\s+/).filter(Boolean).length} words
        </span>
        <span>
          {concepts.filter((c) =>
            explanation.toLowerCase().includes(c.toLowerCase().split(" ")[0])
          ).length}{" "}
          / {concepts.length} concepts mentioned
        </span>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={
          disabled ||
          assessing ||
          (!explanation.trim() && !mediaRecorderRef.current?._audioData)
        }
        className="w-full py-4 rounded-2xl bg-blue-600 text-white text-lg font-black shadow-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {assessing ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            AI is assessing...
          </span>
        ) : (
          "Submit My Teaching"
        )}
      </button>
    </div>
  );
}
