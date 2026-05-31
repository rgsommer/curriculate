// student-app/src/components/tasks/types/DiffDetectiveTask.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";
import SpeechQualityMeter from "../SpeechQualityMeter";
import reportImageFailure from "../../../utils/reportImageFailure.js";
import { API_BASE_URL } from "../../../config.js";

export default function DiffDetectiveTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  isMultiplayer = false, // Race mode banner only – logic comes from TaskRunner
  raceStatus, // { leader, timeLeft, players }
  memberNames = [],
}) {
  const [answer, setAnswer] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDictating, setIsDictating] = useState(false);   // recording in progress
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [dictationError, setDictationError] = useState("");
  const [imgError, setImgError] = useState(false); // a side image failed to load (S3/AI URL dead)
  // AI coach feedback (parallels art-view / historical-doc). After submit
  // we score locally, then fetch a short coach note from /api/text-feedback,
  // then show a panel with a nominated reader (in team mode) and a
  // Continue button that fires the real onSubmit.
  const [feedbackPhase, setFeedbackPhase] = useState("idle"); // idle | scoring | feedback
  const [aiFeedback, setAiFeedback] = useState("");
  const pendingSubmitRef = useRef(null);
  // Record-then-transcribe via Whisper (the Web Speech API was unreliable in the
  // practice iframe — tester: "speak answer does not work … should listen, then
  // add text to input box"). MediaRecorder + /api/speech/transcribe is robust.
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const differences = task?.differences || [];
  const numExpected = differences.length;

  // ── Objective scoring (fuzzy match the student's free-text answer against
  // each item in differences[]). For each expected difference, extract its
  // content tokens (4+ letter non-stopwords), check how many appear in the
  // student's normalized text. A 50% overlap counts as a hit. This is a
  // lenient classroom heuristic — students who DID spot the difference
  // typically use one of the key nouns from the answer key. ──
  const STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "this", "that", "into", "have", "has",
    "was", "were", "are", "but", "any", "one", "two", "three", "now", "then",
    "they", "them", "their", "there", "here", "what", "when", "where", "which",
    "been", "being", "your", "you", "had", "did", "does", "all", "some",
    "more", "less", "than", "also", "just", "very", "much", "many", "could",
    "would", "should", "will", "shall", "may", "might", "must", "image",
    "scene", "picture", "version", "different", "changed", "change",
  ]);
  function _tokens(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  }
  const objectiveScore = useMemo(() => {
    if (!isSubmitted || numExpected === 0) return null;
    const studentTokens = new Set(_tokens(answer));
    if (studentTokens.size === 0) return { correct: 0, total: numExpected, perDiff: [] };
    const perDiff = differences.map((d) => {
      const text = String(d?.text || d?.expected || d?.diff || d?.label || "");
      const diffTokens = _tokens(text);
      if (diffTokens.length === 0) return { text, isHit: false, hitTokens: [] };
      const hits = diffTokens.filter((t) => studentTokens.has(t));
      const ratio = hits.length / diffTokens.length;
      // Hit if at least 50% of the content tokens overlap, OR ≥2 distinct
      // content words match (works for short 1-word diffs like "1812").
      const isHit = ratio >= 0.5 || hits.length >= 2;
      return { text, isHit, hitTokens: hits };
    });
    return { correct: perDiff.filter((p) => p.isHit).length, total: numExpected, perDiff };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitted, answer, numExpected]);

  // Nominated reader for the coach feedback panel (team mode only — mirror
  // of historical-doc / art-view). Picked once when the feedback text
  // arrives so the name stays stable through re-renders.
  const nominatedReader = useMemo(() => {
    if (!Array.isArray(memberNames) || memberNames.length < 2) return null;
    const clean = memberNames.map((n) => String(n || "").trim()).filter(Boolean);
    if (clean.length < 2) return null;
    return clean[Math.floor(Math.random() * clean.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFeedback]);

  // Image (visual) comparison mode — tester ask: "Could this be between two art
  // pics, two documents, two historical figures, two specimens, two scenes, two
  // pieces of equipment…". When the task supplies two images we show them
  // side-by-side instead of text passages; students still describe the
  // differences they spot. Inline highlighting isn't possible on an image, so
  // the answer key is revealed as a list after submitting.
  const cfg = task?.config || {};
  const imageA = task?.imageA || cfg.imageA || task?.originalImage || cfg.originalImage || "";
  const imageB = task?.imageB || cfg.imageB || task?.modifiedImage || cfg.modifiedImage || "";
  const modeStr = String(task?.mode || cfg.mode || "").toLowerCase();
  const isImageMode = modeStr === "image" || (!!imageA && !!imageB);
  // If a generated / S3 image URL is dead, we still treat it as image mode for
  // labels/answer-key, but render a graceful fallback instead of broken images.
  const imagesUsable = isImageMode && !imgError;
  // "compare" = two genuinely different things (definitions, processes,
  // figures, specimens…), not an edited passage. Differences are conceptual,
  // so we reveal them as a list rather than highlighting word swaps.
  const isCompareMode = modeStr === "compare";
  const showDiffList = isImageMode || isCompareMode;
  const labelA = task?.labelA || cfg.labelA || (isImageMode ? "Image A" : "Original");
  const labelB = task?.labelB || cfg.labelB || (isImageMode ? "Image B" : "Modified");

  // --- Load draft from parent (when task changes / saved draft exists) ---
  useEffect(() => {
    if (typeof answerDraft === "string") {
      setAnswer(answerDraft);
    } else if (answerDraft == null) {
      setAnswer("");
    }
  }, [answerDraft, task?.id]);

  // --- Push draft back up so TaskRunner can persist between re-renders ---
  useEffect(() => {
    if (onAnswerChange && answer !== answerDraft) {
      onAnswerChange(answer);
    }
  }, [answer, answerDraft, onAnswerChange]);

  // --- Clean up recording on unmount ---
  useEffect(() => {
    return () => {
      try { mediaRecorderRef.current?.stop(); } catch {}
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    };
  }, []);

  // --- Voice: record audio, then transcribe via Whisper and append to the box ---
  const startDictation = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setDictationError("Voice input is not supported on this browser — please type your answer.");
      return;
    }
    setDictationError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
        streamRef.current = null;
        if (chunksRef.current.length === 0) { setIsTranscribing(false); return; }
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "diff-detective.webm");
          form.append("language", "en");
          const res = await fetch(`${API_BASE_URL}/api/speech/transcribe`, { method: "POST", body: form });
          const json = res.ok ? await res.json().catch(() => null) : null;
          const text = json?.transcript ? String(json.transcript).trim() : "";
          if (text) {
            setAnswer((prev) => (prev && !prev.endsWith(" ") ? prev + " " : prev || "") + text);
          } else {
            setDictationError("Couldn't hear that clearly — try again or type your answer.");
          }
        } catch {
          setDictationError("Transcription failed — you can type your answer instead.");
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsDictating(true);
    } catch {
      setDictationError("Microphone access is blocked. Allow mic access, or type your answer.");
      setIsDictating(false);
    }
  };

  const stopDictation = () => {
    setIsDictating(false);
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop(); // → onstop transcribes + appends
      }
    } catch {}
  };

  const handleSubmit = async () => {
    if (!answer.trim() || disabled || isSubmitted) return;
    setAttempts((a) => a + 1);
    setIsSubmitted(true);

    // Stash the eventual onSubmit payload — fire it from the Continue button
    // in the coach-feedback panel below. Mirror of art-view / historical-doc.
    pendingSubmitRef.current = {
      answer: answer.trim(),
      // Objective score is computed by the same useMemo above; recompute
      // inline here so the persisted payload reflects what the student sees.
      // (useMemo result isn't available synchronously inside this handler.)
    };

    setFeedbackPhase("scoring");

    let coach = "";
    try {
      const diffList = differences
        .map((d, i) => `${i + 1}. ${String(d?.text || d?.expected || d?.diff || d?.label || "")}`)
        .filter((s) => s.length > 3)
        .join("\n");
      const r = await fetch(`${API_BASE_URL}/api/text-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "diff-detective",
          prompt:
            "A student played spot-the-difference and wrote which changes they noticed between two scenes/passages. " +
            "Praise one difference they got RIGHT (or describe one they came close to), then point out ONE specific change " +
            "from the expected list that they missed and EXPLAIN it concretely in one sentence. Keep it under 70 words.",
          context: `Expected differences:\n${diffList}`,
          response: answer.trim(),
        }),
      });
      const j = await r.json().catch(() => null);
      if (j?.feedback) coach = String(j.feedback);
    } catch { /* fall through to default */ }
    if (!coach) {
      coach =
        objectiveScore && objectiveScore.correct === objectiveScore.total
          ? "Sharp eye — you spotted them all! Strong difference-spotting means looking at each part of the scene methodically; you did."
          : "Good effort. Next time, scan one section at a time (top-left → top-right → bottom-left → bottom-right) — most spotters find more by sweeping deliberately than by glancing.";
    }
    setAiFeedback(coach);
    setFeedbackPhase("feedback");
  };

  const handleFeedbackContinue = () => {
    const p = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    // Include the objective score breakdown + the coach note on the
    // payload so the teacher transcript renderer can show both.
    const payload = {
      answer: p?.answer ?? answer.trim(),
      correct: objectiveScore?.correct ?? null,
      total: objectiveScore?.total ?? numExpected,
      perDiff: objectiveScore?.perDiff ?? [],
      aiFeedback,
    };
    onSubmit?.(payload);
  };

  // --- Highlight helpers ---
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightText = (text = "", isModified = false) => {
    if (!isSubmitted || !differences.length || !text) {
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>;
    }

    let highlighted = text;

    differences.forEach((diff) => {
      if (!diff || !diff.expected) return;

      const parts = String(diff.expected).split("→");
      if (parts.length < 2) return;

      const original = parts[0].trim();
      const changed = parts[1].trim();

      try {
        if (isModified && changed && text.includes(changed)) {
          const pattern = new RegExp(escapeRegExp(changed), "gi");
          highlighted = highlighted.replace(
            pattern,
            `<mark style="background:#fecaca; padding:0 4px; border-radius:4px;">${changed}</mark>`
          );
        } else if (!isModified && original && text.includes(original)) {
          const pattern = new RegExp(escapeRegExp(original), "gi");
          highlighted = highlighted.replace(
            pattern,
            `<mark style="background:#bbf7d0; padding:0 4px; border-radius:4px;">${original}</mark>`
          );
        }
      } catch {}
    });

    return (
      <pre style={{ whiteSpace: "pre-wrap", margin: 0 }} dangerouslySetInnerHTML={{ __html: highlighted }} />
    );
  };

  const prompt = task?.prompt || `Find the ${numExpected} difference${numExpected === 1 ? "" : "s"}!`;

  const imgFallbackNote = {
    fontSize: "0.9rem",
    color: "rgba(15,23,42,0.72)",
    lineHeight: 1.45,
    padding: "10px 0",
  };

  const hasHints = differences.some((d) => d?.hint) && !isSubmitted;

  const right = (
    <>
      {isMultiplayer && raceStatus ? (
        <Pill>🏁 Race • {raceStatus.timeLeft ?? "–"}s • Leader: {raceStatus.leader || "—"}</Pill>
      ) : null}
      <Pill>🧠 Attempts {attempts}</Pill>
      {isSubmitted ? <Pill>✅ Locked</Pill> : null}
    </>
  );

  return (
    <TaskCardFrame badge="🕵️ Diff Detective" title={prompt} subtitle={`Find ${numExpected} difference${numExpected === 1 ? "" : "s"} between the two ${isImageMode ? "images" : isCompareMode ? "items" : "passages"}.`} right={right}>
      {/* Passages — auto-fit so the two panels stack on narrow (phone)
          screens instead of squishing to ~150px wide and looking broken.
          Tester reported this as "not available yet on student devices." */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            background: "rgba(248,250,252,1)",
            padding: 16,
            borderRadius: 18,
            border: "2px solid rgba(226,232,240,1)",
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 8, color: "rgba(22,163,74,1)" }}>{labelA}</div>
          {imagesUsable ? (
            <img src={imageA} alt={labelA} onError={() => { reportImageFailure({ taskType: "diff-detective", url: imageA, source: "imageA" }); setImgError(true); }} referrerPolicy="no-referrer" style={{ width: "100%", height: "auto", borderRadius: 12, display: "block" }} />
          ) : isImageMode ? (
            task?.original ? highlightText(task?.original, false)
              : <div style={imgFallbackNote}>🖼️ This image couldn't load. Compare using the descriptions and list the differences you spot.</div>
          ) : (
            highlightText(task?.original, false)
          )}
        </div>

        <div
          style={{
            background: "rgba(254,242,242,1)",
            padding: 16,
            borderRadius: 18,
            border: "2px solid rgba(252,165,165,1)",
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 8, color: "rgba(220,38,38,1)" }}>{labelB}</div>
          {imagesUsable ? (
            <img src={imageB} alt={labelB} onError={() => { reportImageFailure({ taskType: "diff-detective", url: imageB, source: "imageB" }); setImgError(true); }} referrerPolicy="no-referrer" style={{ width: "100%", height: "auto", borderRadius: 12, display: "block" }} />
          ) : isImageMode ? (
            task?.modified ? highlightText(task?.modified, true)
              : <div style={imgFallbackNote}>🖼️ This image couldn't load. Compare using the descriptions and list the differences you spot.</div>
          ) : (
            highlightText(task?.modified, true)
          )}
        </div>
      </div>

      {/* Answer input + dictation */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontWeight: 950, color: "rgba(15,23,42,0.92)" }}>Your Answer</div>
        <GhostButton
          onClick={isDictating ? stopDictation : startDictation}
          disabled={disabled || isSubmitted || isTranscribing}
          style={{
            borderRadius: 999,
            padding: "10px 12px",
            background: isDictating ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
            border: `1px solid ${isDictating ? "rgba(239,68,68,0.35)" : "rgba(16,185,129,0.30)"}`,
          }}
        >
          {isTranscribing ? "Transcribing…" : isDictating ? "Stop & add text" : "Speak Answer"} 🎙️
        </GhostButton>
      </div>

      {dictationError && (
        <div style={{ marginBottom: 8, fontWeight: 800, fontSize: "0.85rem", color: "#b91c1c", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "8px 12px" }}>
          ⚠️ {dictationError}
        </div>
      )}

      <div style={{ marginBottom: 8, fontWeight: 850, color: "rgba(15,23,42,0.80)" }}>
        {showDiffList
          ? `List the differences you spot between the two ${isImageMode ? "images" : "items"} (one per line).`
          : `Write the changes in words (example: "206 changed to 208", "jumps changed to jumped").`}
      </div>

      <TextArea
       
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={disabled || isSubmitted}
        rows={6}
        placeholder='Speak or type: "jumps was changed to jumped", "206 to 208"…'
      />

      {/* Live answer-quality speedometer (typed or dictated). */}
      {!isSubmitted && (
        <div style={{ marginTop: 8 }}>
          <SpeechQualityMeter text={answer} />
        </div>
      )}

      {/* Hint */}
      {hasHints ? (
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <GhostButton
           
            onClick={() => setShowHint(true)}
            disabled={disabled || showHint}
            style={{
              borderRadius: 999,
              padding: "10px 12px",
              background: showHint ? "rgba(148,163,184,0.18)" : "rgba(245,158,11,0.14)",
              border: `1px solid ${showHint ? "rgba(148,163,184,0.35)" : "rgba(245,158,11,0.35)"}`,
            }}
          >
            Hint (-2 pts)
          </GhostButton>

          {showHint ? <Pill>Hints revealed</Pill> : <Pill subtle>Use only if stuck.</Pill>}
        </div>
      ) : null}

      {showHint && (
        <div
          style={{
            marginTop: 10,
            background: "rgba(255,251,235,1)",
            padding: 12,
            borderRadius: 16,
            border: "1px solid rgba(251,191,36,1)",
            fontSize: "0.95rem",
          }}
        >
          {differences.map((d, i) => (d?.hint ? <div key={i}>• Hint {i + 1}: {d.hint}</div> : null))}
        </div>
      )}

      {/* Submit */}
      <div style={{ marginTop: 12 }}>
        <PrimaryButton
          onClick={handleSubmit}
          disabled={disabled || !answer.trim() || isSubmitted}
          style={{
            width: "100%",
            borderRadius: 999,
            padding: "14px 16px",
            background: isSubmitted
              ? "linear-gradient(135deg, rgba(16,185,129,0.96), rgba(34,197,94,0.76))"
              : !answer.trim()
              ? "linear-gradient(135deg, rgba(148,163,184,0.96), rgba(148,163,184,0.76))"
              : "linear-gradient(135deg, rgba(14,165,233,0.96), rgba(56,189,248,0.76))",
          }}
        >
          {isSubmitted ? "Submitted – Waiting for others…" : "Submit Answer"}
        </PrimaryButton>
      </div>

      {isSubmitted && objectiveScore && (
        <div style={{ textAlign: "center", marginTop: 12, fontSize: "1.05rem", color: "rgba(22,163,74,1)", fontWeight: 900 }}>
          🔍 Spotted {objectiveScore.correct}/{objectiveScore.total} difference{objectiveScore.total === 1 ? "" : "s"}
        </div>
      )}

      {/* Image/compare modes can't highlight in place, so reveal the answer
          key as a list — colour each row green (hit) or red (missed) based
          on the fuzzy match against the student's answer. */}
      {isSubmitted && showDiffList && differences.length > 0 && (
        <div
          style={{
            marginTop: 10,
            background: "rgba(248,250,252,1)",
            padding: 14,
            borderRadius: 16,
            border: "1px solid rgba(226,232,240,1)",
            fontSize: "0.95rem",
            color: "rgba(15,23,42,0.92)",
          }}
        >
          {differences.map((d, i) => {
            const text = typeof d === "string" ? d : d?.expected || d?.text || d?.description || JSON.stringify(d);
            const isHit = objectiveScore?.perDiff?.[i]?.isHit ?? false;
            return (
              <div key={i} style={{ marginBottom: 4, color: isHit ? "#15803d" : "#b91c1c" }}>
                {isHit ? "✓" : "✗"} {text}
              </div>
            );
          })}
        </div>
      )}

      {/* AI coach feedback panel (mirror of art-view / historical-doc).
          Scoring while fetching, then the coach note + nominated-reader
          pill (team mode) + Continue button that fires the real onSubmit. */}
      {feedbackPhase === "scoring" && (
        <div style={{ marginTop: 14, color: "#0e7490", fontWeight: 700, textAlign: "center" }}>
          🤖 Coach is reading your answers…
        </div>
      )}
      {feedbackPhase === "feedback" && (
        <>
          <div style={{
            marginTop: 14,
            textAlign: "left",
            background: "#fff",
            border: "1px solid #99f6e4",
            borderRadius: 12,
            padding: 14,
            color: "#0f172a",
          }}>
            <div style={{ fontWeight: 900, fontSize: "0.85rem", color: "#0e7490", marginBottom: 6 }}>
              🤖 Coach feedback
            </div>
            {nominatedReader && (
              <div style={{
                marginBottom: 10,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(14,116,144,0.08)",
                border: "1px solid rgba(14,116,144,0.25)",
                color: "#0e7490",
                fontWeight: 800,
                fontSize: "0.85rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}>
                🎤 <strong>{nominatedReader}</strong>, read this to the team.
              </div>
            )}
            <div style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{aiFeedback}</div>
          </div>
          <PrimaryButton onClick={handleFeedbackContinue} style={{ marginTop: 14, width: "100%" }}>
            {nominatedReader ? "Done reading — Continue ▶" : "Continue ▶"}
          </PrimaryButton>
        </>
      )}
    </TaskCardFrame>
  );
}
