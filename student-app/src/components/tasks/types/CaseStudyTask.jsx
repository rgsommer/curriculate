// student-app/src/components/tasks/types/CaseStudyTask.jsx
import React, { useState, useMemo, useEffect, useRef } from "react";
import { API_BASE_URL } from "../../../config.js";
import DesignatedWriter from "../DesignatedWriter";
import HandwritingCapture, { HANDWRITING_BONUS_POINTS } from "../HandwritingCapture";

export default function CaseStudyTask({
  task,
  onSubmit,
  disabled,
  answered,
  onAnswerChange,
  answerDraft,
  roomCode,
  teamId,
  memberNames = [],
}) {
  const isDisabled = disabled || answered;

  const cfg = task?.config || {};
  const scenario = cfg.scenario || "";
  const expertRole = cfg.expertRole || "Subject Expert";
  const expertDesc = cfg.expertDescription || "";
  const relevantConcepts = Array.isArray(cfg.relevantConcepts) ? cfg.relevantConcepts : [];

  const gradeLevel = parseInt(task?.gradeLevel || task?.config?.gradeLevel || task?.settings?.gradeLevel || "7", 10);
  // Tester (Harnoor): "shorten the word count to 100 words".
  // Lowered the per-grade multiplier and capped at 100 — grade 7 used
  // to require 140 words which felt too long for a quick demo.
  const minWords = Math.min(100, gradeLevel * 12);

  const [value, setValue] = useState(answerDraft?.response || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const [conceptsFound, setConceptsFound] = useState([]);
  const [handwritingUsed, setHandwritingUsed] = useState(false);
  const [handwritingPhoto, setHandwritingPhoto] = useState(null);

  // Undo history for accidental deletions
  const [undoStack, setUndoStack] = useState([]);
  const lastSnapshotRef = useRef({ text: answerDraft?.response || "", ts: Date.now() });

  const wordCount = useMemo(() => {
    const trimmed = String(value || "").trim();
    return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  }, [value]);

  const meetsMin = wordCount >= minWords;

  const matchedConcepts = useMemo(() => {
    const lower = String(value || "").toLowerCase();
    return relevantConcepts.filter((c) =>
      lower.includes(String(c).toLowerCase())
    );
  }, [value, relevantConcepts]);

  useEffect(() => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false,
      response: value,
      wordCount,
      minWords,
      conceptsUsed: matchedConcepts.length,
      totalConcepts: relevantConcepts.length,
    });
  }, [value, wordCount]);

  const basePoints = task?.points || 10;

  const handleSubmit = async () => {
    if (isDisabled || !meetsMin) return;
    setIsSubmitting(true);

    try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}

    setConceptsFound(matchedConcepts);

    const payload = {
      type: "case-study",
      correct: false,
      basePoints,
      response: value,
      wordCount,
      minWords,
      conceptsUsed: matchedConcepts.length,
      totalConcepts: relevantConcepts.length,
      expertRole,
      ...(handwritingUsed && {
        handwritingBonus: true,
        handwritingBonusPoints: HANDWRITING_BONUS_POINTS,
        handwritingPhotoUrl: handwritingPhoto || undefined,
      }),
    };
    onSubmit?.(payload);

    setLoadingFeedback(true);
    setFeedbackError(false);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(`${API_BASE_URL}/api/evaluate/case-study-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          studentResponse: value,
          scenario,
          expertRole,
          expertDescription: expertDesc,
          gradeLevel,
          relevantConcepts,
        }),
      });
      clearTimeout(timeout);
      const data = await res.json();
      setAiFeedback(data.feedback || "Good work on your analysis!");
    } catch {
      setFeedbackError(true);
      setAiFeedback(
        `Good effort analyzing this case! You raised some interesting points about ${scenario.slice(0, 60)}... ` +
        `Keep thinking critically about these kinds of problems.\n\n— ${expertRole}`
      );
    } finally {
      setLoadingFeedback(false);
    }
  };

  // ── FEEDBACK VIEW (after submission) ──
  if (aiFeedback || loadingFeedback) {
    return (
      <div style={{ padding: 4 }}>
        {/* Student's response (collapsed) */}
        <div style={{
          padding: "10px 14px",
          background: "#f1f5f9",
          borderRadius: 12,
          fontSize: 13,
          color: "#475569",
          marginBottom: 14,
          maxHeight: 120,
          overflow: "auto",
        }}>
          <strong>Your analysis:</strong>
          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{value}</div>
        </div>

        {/* Concepts found badge */}
        {conceptsFound.length > 0 && (
          <div style={{
            padding: "8px 12px",
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 600,
          }}>
            ⭐ You used {conceptsFound.length}/{relevantConcepts.length} key concepts:{" "}
            {conceptsFound.join(", ")}
          </div>
        )}

        {/* AI feedback */}
        {loadingFeedback ? (
          <div style={{
            textAlign: "center",
            padding: "32px 16px",
            background: "rgba(255,255,255,0.9)",
            borderRadius: 16,
            border: "1px solid #e2e8f0",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, animation: "pulse 1.5s infinite" }}>🔍</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
              {expertRole} is reviewing your solution...
            </div>
            <style>{`@keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.6; transform:scale(1.1); } }`}</style>
          </div>
        ) : (
          <div style={{
            padding: "16px 18px",
            background: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)",
            borderRadius: 16,
            border: "1px solid #c4b5fd",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#5b21b6",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              🎓 Expert Feedback — {expertRole}
            </div>
            <div style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: "#1e293b",
              whiteSpace: "pre-wrap",
            }}>
              {aiFeedback}
            </div>
            {feedbackError && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
                (Auto-generated feedback — live AI was unavailable)
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── WRITING VIEW ──
  return (
    <div style={{ padding: 4 }}>
      {/* Case scenario card */}
      <div style={{
        padding: "14px 16px",
        background: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)",
        borderRadius: 14,
        border: "1px solid #c4b5fd",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#5b21b6", marginBottom: 6 }}>
          📋 Case Study
        </div>
        <div style={{ fontSize: 14, color: "#1e293b", lineHeight: 1.6 }}>
          {scenario}
        </div>
      </div>

      {/* Expert who will evaluate */}
      <div style={{
        fontSize: 13,
        color: "#475569",
        marginBottom: 10,
        padding: "8px 12px",
        background: "#f8fafc",
        borderRadius: 8,
        borderLeft: "3px solid #8b5cf6",
      }}>
        🎓 <strong>{expertRole}</strong> will evaluate your solution.
        {expertDesc && <span> {expertDesc}</span>}
      </div>

      {/* Relevant concepts hint */}
      {relevantConcepts.length > 0 && (
        <div style={{
          fontSize: 12,
          color: "#64748b",
          marginBottom: 10,
          padding: "6px 10px",
          background: "#fffbeb",
          borderRadius: 8,
          border: "1px solid #fde68a",
        }}>
          <strong>Bonus points</strong> for using these concepts:{" "}
          {relevantConcepts.map((c, i) => (
            <span key={i} style={{
              fontWeight: matchedConcepts.includes(c) ? 700 : 400,
              color: matchedConcepts.includes(c) ? "#16a34a" : "#64748b",
            }}>
              {c}{i < relevantConcepts.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}

      {/* Handwriting capture — write on paper for bonus points */}
      {!isDisabled && (
        <HandwritingCapture
          onTextExtracted={(text, photoUrl, allPlayerPhotos) => {
            setValue((prev) => prev ? prev + "\n\n" + text : text);
            setHandwritingUsed(true);
            setHandwritingPhoto(allPlayerPhotos || photoUrl);
          }}
          disabled={isDisabled}
          bonusPoints={HANDWRITING_BONUS_POINTS}
          roomCode={roomCode}
          teamId={teamId}
          memberNames={memberNames}
        />
      )}

      <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} taskIndex={task?._taskIndex} />

      {/* Undo button */}
      {undoStack.length > 0 && !isDisabled && (
        <div style={{ marginBottom: 6, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => {
              if (undoStack.length === 0) return;
              const prev = undoStack[undoStack.length - 1];
              setUndoStack((s) => s.slice(0, -1));
              setValue(prev);
              lastSnapshotRef.current = { text: prev, ts: Date.now() };
            }}
            style={{
              padding: "4px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#f1f5f9",
              color: "#475569",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            ↩ Undo
          </button>
        </div>
      )}

      {/* Text area */}
      <textarea
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          const now = Date.now();
          const charDiff = prev.length - next.length;
          const shouldSnapshot =
            charDiff > 10 ||
            (now - lastSnapshotRef.current.ts > 2000 && prev !== lastSnapshotRef.current.text);
          if (shouldSnapshot && prev.trim()) {
            setUndoStack((stack) => [...stack.slice(-19), prev]);
            lastSnapshotRef.current = { text: next, ts: now };
          }
          setValue(next);
        }}
        disabled={isDisabled}
        placeholder="Describe your approach to solving this case..."
        rows={8}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #d1d5db",
          fontSize: 15,
          lineHeight: 1.6,
          fontFamily: "system-ui, sans-serif",
          resize: "vertical",
          color: "#1e293b",
          background: "#fff",
          minHeight: 180,
        }}
      />

      {/* Word count + concept count */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8,
        fontSize: 13,
      }}>
        <span style={{
          color: meetsMin ? "#16a34a" : wordCount > 0 ? "#d97706" : "#94a3b8",
          fontWeight: 600,
        }}>
          {wordCount}/{minWords} words {meetsMin ? "✓" : ""}
        </span>
        {matchedConcepts.length > 0 && (
          <span style={{ color: "#16a34a", fontWeight: 600 }}>
            ⭐ {matchedConcepts.length}/{relevantConcepts.length} concepts
          </span>
        )}
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={isDisabled || !meetsMin || isSubmitting}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "12px 0",
          borderRadius: 12,
          border: "none",
          background: !meetsMin ? "#94a3b8" : isSubmitting ? "#a78bfa" : "#7c3aed",
          color: "#fff",
          fontSize: 16,
          fontWeight: 700,
          cursor: !meetsMin || isDisabled ? "default" : "pointer",
          opacity: isSubmitting ? 0.7 : 1,
          transition: "all 0.2s",
        }}
      >
        {isSubmitting ? "Submitting your analysis..." : !meetsMin ? `Write at least ${minWords} words` : "Submit Solution 🔍"}
      </button>
    </div>
  );
}
