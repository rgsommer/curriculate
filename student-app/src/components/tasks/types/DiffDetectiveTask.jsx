// student-app/src/components/tasks/types/DiffDetectiveTask.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";

export default function DiffDetectiveTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  isMultiplayer = false, // Race mode banner only – logic comes from TaskRunner
  raceStatus, // { leader, timeLeft, players }
}) {
  const [answer, setAnswer] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef(null);

  const differences = task?.differences || [];
  const numExpected = differences.length;

  // Image (visual) comparison mode — tester ask: "Could this be between two art
  // pics, two documents, two historical figures, two specimens, two scenes, two
  // pieces of equipment…". When the task supplies two images we show them
  // side-by-side instead of text passages; students still describe the
  // differences they spot. Inline highlighting isn't possible on an image, so
  // the answer key is revealed as a list after submitting.
  const cfg = task?.config || {};
  const imageA = task?.imageA || cfg.imageA || task?.originalImage || cfg.originalImage || "";
  const imageB = task?.imageB || cfg.imageB || task?.modifiedImage || cfg.modifiedImage || "";
  const isImageMode =
    String(task?.mode || cfg.mode || "").toLowerCase() === "image" || (!!imageA && !!imageB);
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

  // --- Clean up speech recognition on unmount ---
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  // --- Voice Dictation (Web Speech API) ---
  const startDictation = () => {
    if (typeof window === "undefined") return;

    const hasWebkit = "webkitSpeechRecognition" in window;
    const hasStandard = "SpeechRecognition" in window;

    if (!hasWebkit && !hasStandard) {
      alert("Sorry, voice dictation is not supported on this browser.");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join("");
      setAnswer((prev) => (prev + " " + transcript).trimStart());
    };

    recognition.onerror = () => setIsDictating(false);
    recognition.onend = () => setIsDictating(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsDictating(true);
  };

  const stopDictation = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsDictating(false);
  };

  const handleSubmit = () => {
    if (!answer.trim() || disabled || isSubmitted) return;
    setAttempts((a) => a + 1);
    setIsSubmitted(true);
    onSubmit?.(answer.trim());
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
    <TaskCardFrame badge="🕵️ Diff Detective" title={prompt} subtitle={`Find ${numExpected} difference${numExpected === 1 ? "" : "s"} between the two ${isImageMode ? "images" : "passages"}.`} right={right}>
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
          {isImageMode ? (
            <img src={imageA} alt={labelA} style={{ width: "100%", height: "auto", borderRadius: 12, display: "block" }} />
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
          {isImageMode ? (
            <img src={imageB} alt={labelB} style={{ width: "100%", height: "auto", borderRadius: 12, display: "block" }} />
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
          disabled={disabled || isSubmitted}
          style={{
            borderRadius: 999,
            padding: "10px 12px",
            background: isDictating ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
            border: `1px solid ${isDictating ? "rgba(239,68,68,0.35)" : "rgba(16,185,129,0.30)"}`,
          }}
        >
          {isDictating ? "Stop Talking" : "Speak Answer"} 🎙️
        </GhostButton>
      </div>

      <div style={{ marginBottom: 8, fontWeight: 850, color: "rgba(15,23,42,0.80)" }}>
        {isImageMode
          ? `List the differences you spot between the two ${"images"} (one per line).`
          : `Write the changes in words (example: "206 changed to 208", "jumps changed to jumped").`}
      </div>

      <TextArea
       
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={disabled || isSubmitted}
        rows={6}
        placeholder='Speak or type: "jumps was changed to jumped", "206 to 208"…'
      />

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

      {isSubmitted && (
        <div style={{ textAlign: "center", marginTop: 12, fontSize: "0.95rem", color: "rgba(22,163,74,1)", fontWeight: 900 }}>
          {isImageMode ? "Answer locked! Here are the differences:" : "Answer locked! Highlights shown above."}
        </div>
      )}

      {/* Image mode can't highlight in place, so reveal the answer key as a list. */}
      {isSubmitted && isImageMode && differences.length > 0 && (
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
          {differences.map((d, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              ✓ {typeof d === "string" ? d : d?.expected || d?.text || d?.description || JSON.stringify(d)}
            </div>
          ))}
        </div>
      )}
    </TaskCardFrame>
  );
}
