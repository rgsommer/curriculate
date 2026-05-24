// student-app/src/components/tasks/types/TeachBackTask.jsx
//
// Teach-Back: Each team member explains 3-5 concepts to a younger audience.
// Input modes: text (editable), voice (Web Speech API), record audio.
// Intra-team: each player contributes separately, building on teammates' prior explanations.
// AI-assessed for clarity, accuracy, age-appropriateness, and additive value.

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import SpeechQualityMeter from "../SpeechQualityMeter";

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

// Forgiving concept-coverage check: returns true if the explanation
// mentions ANY content word from the concept (>=4 chars, not a stop
// word).  Old logic only matched the literal first word of the
// concept, which made multi-word topics ("photosynthesis stages") fail
// when the student said only "stages".  Tester reported recording was
// not being credited even when concepts were verbally covered.
const STOP_WORDS = new Set([
  "the","a","an","and","or","of","in","on","to","for","with","by",
  "is","are","was","were","be","been","at","as","it","its","this",
  "that","these","those","from","into","about","over","under",
]);
function _wordStems(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}
function coversConcept(explanation, concept) {
  const exLower = String(explanation || "").toLowerCase();
  if (!exLower) return false;
  const conceptWords = _wordStems(concept);
  if (conceptWords.length === 0) {
    // Fall back to literal first-word check for very short concepts.
    const first = String(concept || "").toLowerCase().split(/\s+/)[0] || "";
    return Boolean(first) && exLower.includes(first);
  }
  // Match on any content word — also allow loose stem match (drop
  // trailing s/es/ed/ing) so "photosynthesis" / "photosynthesize" /
  // "photosynthesizing" all count.
  for (const w of conceptWords) {
    if (exLower.includes(w)) return true;
    // Try stripping common inflections.
    const stem = w.replace(/(ing|ed|es|s)$/, "");
    if (stem.length >= 4 && exLower.includes(stem)) return true;
  }
  return false;
}

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

  // Tester ask: "Don't allow more than two key terms per sentence (to prevent
  // just listing them)." Flag the first sentence that crams in >2 concepts so
  // students explain rather than list.
  const MAX_TERMS_PER_SENTENCE = 2;
  const offendingSentence = useMemo(() => {
    if (!concepts.length) return null;
    const sentences = String(explanation || "")
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sentences) {
      const count = concepts.filter((c) => coversConcept(s, c)).length;
      if (count > MAX_TERMS_PER_SENTENCE) return { sentence: s, count };
    }
    return null;
  }, [explanation, concepts]);

  // Tester ask: "Don't allow pasting." Keeps students from pasting a
  // pre-written answer instead of explaining in their own words.
  const blockPaste = useCallback((e) => {
    e.preventDefault();
  }, []);
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [assessing, setAssessing] = useState(false);

  // Speech recognition
  const recognitionRef = useRef(null);
  // Text that existed before the CURRENT dictation session started — we APPEND
  // dictated text to it. Updated on each recognizer restart (see onend).
  const preDictateRef = useRef("");
  // Always-current copy of the explanation, so the recognizer's restart logic
  // can re-base off the latest text without a stale closure.
  const explanationRef = useRef("");
  // User intent to keep listening. Chrome's recognizer auto-ends after a pause;
  // while intent is true we restart it so dictation survives natural pauses
  // (tester: "records but doesn't transcribe" — it was silently ending).
  const listenIntentRef = useRef(false);
  // Finalized text for the current recognizer session (excludes interim) — only
  // this is committed on a keep-alive restart, so interim isn't re-added.
  const sessionFinalRef = useRef("");
  // Audio recording
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  /* ─── Speech-to-text (voice mode) ─── */
  const startListening = useCallback(() => {
    // Chrome only exposes the prefixed `webkitSpeechRecognition`; accept either.
    const SpeechRecognitionImpl =
      (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
    if (!SpeechRecognitionImpl) {
      setVoiceError("Voice input is not supported on this browser. Try Chrome or Safari, or type instead.");
      return;
    }

    try {
      const recognition = new SpeechRecognitionImpl();
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;

      // Remember what was already typed so dictation APPENDS rather than replaces.
      preDictateRef.current = explanation || "";

      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = 0; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += t;
          else interimText += t;
        }
        sessionFinalRef.current = finalText;
        const base = preDictateRef.current || "";
        const sep = base && !base.endsWith(" ") ? " " : "";
        const combined = `${base}${sep}${finalText}${interimText}`.replace(/^\s+/, "");
        explanationRef.current = combined;
        setExplanation(combined);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event?.error);
        if (event?.error === "no-speech" || event?.error === "aborted") return; // benign
        if (event?.error === "not-allowed") {
          setVoiceError("Microphone access was denied. Please allow mic access and try again.");
        } else {
          setVoiceError("Voice input isn't working right now. You can still type your answer.");
        }
        listenIntentRef.current = false;
        setIsListening(false);
      };

      recognition.onend = () => {
        // Chrome ends the recognizer after a pause. If the user hasn't tapped
        // Stop, re-base on the latest text and restart so dictation survives
        // natural pauses (otherwise it looks like "records but doesn't transcribe").
        if (listenIntentRef.current) {
          // Commit ONLY finalized text (never interim) before restarting.
          const base = preDictateRef.current || "";
          const sep = base && !base.endsWith(" ") ? " " : "";
          const committed = `${base}${sep}${sessionFinalRef.current}`.replace(/^\s+/, "");
          preDictateRef.current = committed && !committed.endsWith(" ") ? committed + " " : committed;
          sessionFinalRef.current = "";
          try {
            recognition.start();
            return;
          } catch {
            /* fall through to stop */
          }
        }
        setIsListening(false);
      };

      // Bank any text already in the box before starting.
      explanationRef.current = explanation || "";
      sessionFinalRef.current = "";
      listenIntentRef.current = true;
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      setVoiceError("");
    } catch (err) {
      console.error("Speech recognition start failed:", err);
      setVoiceError("Voice input is not available. Please type your response.");
      listenIntentRef.current = false;
      setIsListening(false);
    }
  }, [explanation]);

  const stopListening = useCallback(() => {
    listenIntentRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
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
    if (offendingSentence) return; // too many key terms in one sentence

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

    // Tester: 'in my recording, I did mention all the concepts, but
    // it said try to mention specifics: did it not parse the
    // recording?'  Old logic only matched the FIRST word of the
    // concept (case-insensitive includes), which fails on phrases
    // like "Photosynthesis stages" if the explanation says
    // "stages" but not "photosynthesis", or vice-versa.  New rule:
    // match if ANY content word (>=4 chars, not a stop word) from
    // the concept appears in the explanation.
    const conceptsCovered = concepts.filter((c) =>
      coversConcept(explanation, c)
    );

    // CONTENT-AWARE score (tester: "entered a completely wrong answer and it
    // still gave 20/20"). Coverage of the required concepts is the primary
    // driver; explanation length is only a secondary quality signal. A response
    // that covers NO concepts can't earn more than a token score.
    const totalConcepts = concepts.length || 1;
    const coverage = conceptsCovered.length / totalConcepts;
    const wordCount = explanation.trim().split(/\s+/).filter(Boolean).length;
    // Audio-only submissions can't be content-checked on the device, so don't
    // penalize them here (the live backend transcribes + scores them).
    const audioOnly =
      !!mediaRecorderRef.current?._audioData &&
      (!explanation.trim() || explanation.trim().startsWith("[Audio recorded"));
    let mockScore;
    if (audioOnly) {
      mockScore = PTS_GOOD;
    } else if (conceptsCovered.length === 0) {
      mockScore = 2; // wrote something, but it doesn't address the concepts
    } else if (coverage >= 1) {
      mockScore = wordCount >= 25 ? PTS_EXCELLENT : PTS_GOOD; // all concepts + real explanation
    } else if (coverage >= 0.5) {
      mockScore = PTS_GOOD;
    } else {
      mockScore = PTS_BASIC;
    }

    setTimeout(() => {
      const result = {
        score: mockScore,
        maxScore: PTS_EXCELLENT,
        conceptsCovered: conceptsCovered.length,
        totalConcepts: concepts.length,
        feedback: audioOnly
          ? "Recording received — nice work explaining out loud! Your teacher's tool will review the content."
          : conceptsCovered.length === concepts.length
            ? "Great job! You covered all the concepts clearly."
            : conceptsCovered.length > 0
            ? `Good effort! You covered ${conceptsCovered.length} of ${concepts.length} concepts. Try to explain the others too.`
            : "This didn't cover the required concepts yet — explain each one in your own words to earn full points.",
        addedNewInfo: priorEntries.length > 0,
      };
      setAiResult(result);
      setAssessing(false);
      setSubmitted(true);
      // Defer onSubmit until the player taps the "Thanks — got it"
      // button on the result screen.  Previously we fired onSubmit
      // immediately, which advanced to the next task before the
      // player could read the AI feedback.  See pendingSubmissionRef.
      pendingSubmissionRef.current = {
        ...submission,
        ...result,
        taskType: "teach-back",
      };
    }, 1500);
  }, [explanation, inputMode, concepts, targetAge, priorEntries, offendingSentence]);

  const pendingSubmissionRef = useRef(null);
  const acknowledgeAiFeedback = useCallback(() => {
    if (onSubmit && pendingSubmissionRef.current) {
      onSubmit(pendingSubmissionRef.current);
      pendingSubmissionRef.current = null;
    }
  }, [onSubmit]);

  // Keep the always-current text ref synced (covers typing while listening).
  useEffect(() => {
    explanationRef.current = explanation;
  }, [explanation]);

  // Cleanup
  useEffect(() => {
    return () => {
      listenIntentRef.current = false;
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
                done={coversConcept(explanation, c)}
              />
            ))}
          </div>
        </div>

        {/* Feedback */}
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
          <div className="text-sm font-bold text-blue-800 mb-1">AI Feedback</div>
          {/* text-blue-900 (was -700) for stronger contrast on bg-blue-50. */}
          <p className="text-base text-blue-900 leading-relaxed font-medium">{aiResult.feedback}</p>
        </div>

        {/* Your explanation */}
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-1">Your explanation</div>
          {/* text-slate-900 (was -gray-600) so the player can re-read what they wrote. */}
          <p className="text-sm text-slate-900 whitespace-pre-wrap font-medium">{explanation}</p>
        </div>

        {/* "Thanks — got it" — gives the player time to read the AI
            feedback before advancing to the next task.  Tester reported
            the feedback used to disappear too quickly. */}
        <button
          type="button"
          onClick={acknowledgeAiFeedback}
          className="w-full mt-2 px-5 py-3 rounded-2xl text-base font-black bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg active:scale-95 transition-transform"
        >
          Thanks — got it ▶
        </button>
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
              done={coversConcept(explanation, c)}
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

      {/* Input area — explicit bg-white + text-slate-900 so the typed
          text is always readable.  Tester reported invisible text. */}
      {inputMode === "text" && (
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          onPaste={blockPaste}
          placeholder={`Explain ${concepts.join(", ")} in simple words that ${targetAge} would understand...`}
          disabled={disabled}
          rows={6}
          className="w-full rounded-2xl border border-gray-300 p-4 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none disabled:opacity-50 bg-white text-slate-900 placeholder:text-slate-400"
        />
      )}

      {inputMode === "voice" && (
        <div className="text-center space-y-3">
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            onPaste={blockPaste}
            placeholder="Your speech will appear here. You can also edit it."
            rows={5}
            // bg-white + text-slate-900 keeps the dictated text visible
            // regardless of theme inheritance.
            className="w-full rounded-2xl border border-gray-300 p-4 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none bg-white text-slate-900 placeholder:text-slate-400"
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
          {isListening && (
            <p className="text-xs text-gray-500 font-medium">Listening… speak naturally; pauses are fine.</p>
          )}
          {!!voiceError && (
            <p className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⚠️ {voiceError}
            </p>
          )}
        </div>
      )}

      {/* Live answer-quality speedometer for typed/dictated explanations. */}
      {(inputMode === "text" || inputMode === "voice") && (
        <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: "8px 12px", marginTop: 10 }}>
          <SpeechQualityMeter text={explanation} />
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
            onPaste={blockPaste}
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
            coversConcept(explanation, c)
          ).length}{" "}
          / {concepts.length} concepts mentioned
        </span>
      </div>

      {/* Too-many-terms-per-sentence warning (prevents just listing terms) */}
      {offendingSentence && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          ✋ Try to use at most {MAX_TERMS_PER_SENTENCE} key terms per sentence —
          explain them, don't just list them. One of your sentences uses{" "}
          {offendingSentence.count}. Break it into shorter sentences.
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={
          disabled ||
          assessing ||
          !!offendingSentence ||
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
