// student-app/src/components/tasks/types/PeerEditingTask.jsx
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";

/* ------------------------------------------------------------------ */
/*  CSS keyframe animations (injected once)                           */
/* ------------------------------------------------------------------ */
const STYLE_ID = "peer-editing-anims";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes pe-popIn {
      0%   { transform: scale(0.85); opacity: 0; }
      60%  { transform: scale(1.05); opacity: 1; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes pe-shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes pe-glow {
      0%, 100% { box-shadow: 0 0 6px rgba(99,102,241,0.35); }
      50%      { box-shadow: 0 0 18px rgba(99,102,241,0.65); }
    }
    @keyframes pe-timerPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.6; }
    }
    @keyframes pe-slideUp {
      0%   { transform: translateY(12px); opacity: 0; }
      100% { transform: translateY(0);    opacity: 1; }
    }
  `;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */
const TIMED_DURATION = 180; // 3 minutes in seconds

const ACTION_META = {
  fix:     { label: "Fix Spelling", color: "#f59e0b", icon: "✏️" },
  replace: { label: "Replace",      color: "#8b5cf6", icon: "🔄" },
  delete:  { label: "Delete",       color: "#ef4444", icon: "🗑️" },
};

/* ------------------------------------------------------------------ */
/*  Timer hook                                                        */
/* ------------------------------------------------------------------ */
function useCountdown(startSeconds, active) {
  const [remaining, setRemaining] = useState(startSeconds);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    setRemaining(startSeconds);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [active, startSeconds]);

  return remaining;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ================================================================== */
/*  PeerEditingTask                                                   */
/* ================================================================== */
export default function PeerEditingTask({ task, onSubmit, disabled }) {
  injectStyles();

  const mode = task?.mode || "on-screen";
  const passage = task?.passage || "";
  const words = useMemo(() => passage.split(/\s+/).filter(Boolean), [passage]);

  // --- state ---
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [edits, setEdits] = useState(new Map());           // wordIndex -> { action, replacement }
  const [actionChoice, setActionChoice] = useState(null);   // "fix" | "replace" | "delete"
  const [inputText, setInputText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [photoData, setPhotoData] = useState(null);
  const fileRef = useRef(null);
  const actionPanelRef = useRef(null);

  const timerActive = mode === "timed" && !submitted;
  const timeRemaining = useCountdown(TIMED_DURATION, timerActive);

  // Auto-submit when timer expires
  useEffect(() => {
    if (mode === "timed" && timeRemaining === 0 && !submitted) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining]);

  // Scroll action panel into view when a word is selected
  useEffect(() => {
    if (selectedIdx !== null && actionPanelRef.current) {
      actionPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedIdx]);

  /* ---------- helpers ---------- */

  const selectWord = useCallback((idx) => {
    if (disabled || submitted) return;
    if (edits.has(idx)) {
      // Toggle off existing edit
      setEdits((prev) => {
        const next = new Map(prev);
        next.delete(idx);
        return next;
      });
      setSelectedIdx(null);
      setActionChoice(null);
      setInputText("");
      return;
    }
    if (selectedIdx === idx) {
      setSelectedIdx(null);
      setActionChoice(null);
      setInputText("");
      return;
    }
    setSelectedIdx(idx);
    setActionChoice(null);
    setInputText("");
  }, [disabled, submitted, edits, selectedIdx]);

  const addEdit = useCallback(() => {
    if (selectedIdx === null || !actionChoice) return;
    const edit = { action: actionChoice, replacement: actionChoice === "delete" ? undefined : inputText.trim() };
    if (actionChoice !== "delete" && !edit.replacement) return;
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(selectedIdx, edit);
      return next;
    });
    setSelectedIdx(null);
    setActionChoice(null);
    setInputText("");
  }, [selectedIdx, actionChoice, inputText]);

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    const editsArr = [];
    edits.forEach((val, key) => {
      editsArr.push({ wordIndex: key, action: val.action, replacement: val.replacement });
    });
    onSubmit({
      edits: editsArr,
      mode,
      photoData: mode === "paper" ? photoData : null,
      timeRemaining: mode === "timed" ? timeRemaining : null,
    });
  }, [submitted, edits, mode, photoData, timeRemaining, onSubmit]);

  const handlePhoto = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoData(reader.result);
    reader.readAsDataURL(file);
  }, []);

  /* ---------- word chip style ---------- */

  const wordStyle = useCallback((idx) => {
    const isSelected = selectedIdx === idx;
    const edit = edits.get(idx);
    const base = {
      display: "inline-flex",
      alignItems: "baseline",
      gap: 2,
      padding: "5px 8px",
      margin: "3px 2px",
      borderRadius: 10,
      cursor: disabled || submitted ? "default" : "pointer",
      transition: "all 0.18s ease",
      position: "relative",
      userSelect: "none",
      fontSize: 15,
      fontWeight: 700,
      lineHeight: 1.55,
    };

    if (edit) {
      return {
        ...base,
        background: "rgba(239,68,68,0.12)",
        border: `2px solid ${ACTION_META[edit.action]?.color || "#ef4444"}`,
        animation: "pe-popIn 0.3s ease",
      };
    }
    if (isSelected) {
      return {
        ...base,
        background: "rgba(99,102,241,0.18)",
        border: "2px solid rgba(99,102,241,0.7)",
        animation: "pe-glow 1.4s ease infinite",
      };
    }
    return {
      ...base,
      background: "rgba(255,255,255,0.07)",
      border: "2px solid rgba(255,255,255,0.08)",
    };
  }, [selectedIdx, edits, disabled, submitted]);

  /* ---------- render ---------- */

  const isPaper = mode === "paper";
  const editCount = edits.size;

  return (
    <TaskCardFrame
      title={task?.title || "Peer Editing"}
      badge="PEER EDIT"
      subtitle={mode === "timed" ? "Timed Challenge" : mode === "paper" ? "Paper Mode" : null}
      right={
        mode === "timed" ? (
          <Pill
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 16,
              fontWeight: 1000,
              color: timeRemaining <= 30 ? "#ef4444" : undefined,
              animation: timeRemaining <= 30 ? "pe-timerPulse 0.8s ease infinite" : undefined,
            }}
          >
            {fmtTime(timeRemaining)}
          </Pill>
        ) : null
      }
    >
      {/* --- Prompt --- */}
      {task?.prompt && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.55,
            color: "rgba(226,232,240,0.85)",
            marginBottom: 16,
          }}
        >
          {task.prompt}
        </div>
      )}

      {/* --- Passage word grid --- */}
      <div
        style={{
          maxHeight: 360,
          overflowY: "auto",
          padding: 12,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.18)",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
          {words.map((word, idx) => {
            const edit = edits.get(idx);
            return (
              <span
                key={idx}
                onClick={() => !isPaper && selectWord(idx)}
                style={wordStyle(idx)}
                title={edit ? `${ACTION_META[edit.action]?.label}: ${edit.replacement || "(delete)"}` : `Word #${idx + 1}`}
              >
                {/* Edited annotation */}
                {edit && (
                  <span
                    style={{
                      position: "absolute",
                      top: -14,
                      left: 4,
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#4ade80",
                      whiteSpace: "nowrap",
                      animation: "pe-slideUp 0.25s ease",
                    }}
                  >
                    {edit.action === "delete" ? "✖" : edit.replacement}
                  </span>
                )}

                {/* The word text */}
                <span
                  style={{
                    textDecoration: edit ? "line-through" : "none",
                    textDecorationColor: edit ? "#ef4444" : undefined,
                    textDecorationThickness: edit ? 2 : undefined,
                    color: edit ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.92)",
                  }}
                >
                  {word}
                </span>

                {/* Subscript number */}
                <sub
                  style={{
                    fontSize: 9,
                    color: "#94a3b8",
                    marginLeft: 1,
                    fontWeight: 600,
                  }}
                >
                  {idx + 1}
                </sub>
              </span>
            );
          })}
        </div>
      </div>

      {/* --- Action panel (on-screen / timed) --- */}
      {!isPaper && selectedIdx !== null && !submitted && (
        <div
          ref={actionPanelRef}
          style={{
            padding: 16,
            borderRadius: 18,
            border: "1px solid rgba(99,102,241,0.3)",
            background: "rgba(99,102,241,0.08)",
            marginBottom: 16,
            animation: "pe-slideUp 0.25s ease",
          }}
        >
          {/* Selected word header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <Pill style={{ fontSize: 14, fontWeight: 900 }}>
              {words[selectedIdx]}
              <sub style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>
                {selectedIdx + 1}
              </sub>
            </Pill>
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(226,232,240,0.6)" }}>
              Choose an action
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: actionChoice ? 14 : 0 }}>
            {Object.entries(ACTION_META).map(([key, meta]) => (
              <GhostButton
                key={key}
                onClick={() => {
                  setActionChoice(key);
                  setInputText("");
                }}
                style={{
                  fontSize: 13,
                  padding: "10px 14px",
                  borderColor: actionChoice === key ? meta.color : undefined,
                  background: actionChoice === key ? `${meta.color}22` : undefined,
                  color: actionChoice === key ? meta.color : undefined,
                }}
              >
                {meta.icon} {meta.label}
              </GhostButton>
            ))}
          </div>

          {/* Input for fix / replace */}
          {actionChoice && actionChoice !== "delete" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, animation: "pe-slideUp 0.2s ease" }}>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEdit()}
                placeholder={actionChoice === "fix" ? "Correct spelling..." : "Replacement word/phrase..."}
                autoFocus
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 14,
                  padding: "0 14px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(2,6,23,0.55)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Confirm */}
          {actionChoice && (
            <PrimaryButton
              onClick={addEdit}
              disabled={actionChoice !== "delete" && !inputText.trim()}
              style={{ fontSize: 13, padding: "10px 20px" }}
            >
              Add Edit
            </PrimaryButton>
          )}
        </div>
      )}

      {/* --- Paper mode: photo upload --- */}
      {isPaper && !submitted && (
        <div style={{ marginBottom: 16 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            style={{ display: "none" }}
          />
          <GhostButton
            onClick={() => fileRef.current?.click()}
            style={{ fontSize: 14, padding: "14px 20px", width: "100%" }}
          >
            {photoData ? "✅ Photo Captured — Tap to Retake" : "📷 Take Photo of Edits"}
          </GhostButton>
          {photoData && (
            <div style={{ marginTop: 12, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <img
                src={photoData}
                alt="Captured edits"
                style={{ width: "100%", display: "block" }}
              />
            </div>
          )}
        </div>
      )}

      {/* --- Summary + submit --- */}
      {!submitted && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Pill style={{ fontSize: 13, fontWeight: 900 }}>
            {isPaper
              ? photoData
                ? "✅ Photo ready"
                : "📷 Snap your edits"
              : `${editCount} edit${editCount !== 1 ? "s" : ""} found`}
          </Pill>

          <PrimaryButton
            onClick={handleSubmit}
            disabled={disabled || (isPaper ? !photoData : editCount === 0)}
            style={{ fontSize: 14, padding: "14px 28px" }}
          >
            Submit Edits
          </PrimaryButton>
        </div>
      )}

      {/* --- Post-submit confirmation --- */}
      {submitted && (
        <div
          style={{
            textAlign: "center",
            padding: 24,
            animation: "pe-popIn 0.4s ease",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>{"✅"}</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Edits Submitted!</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(226,232,240,0.6)", marginTop: 6 }}>
            {isPaper
              ? "Your photo has been sent for review."
              : `You marked ${editCount} edit${editCount !== 1 ? "s" : ""} in the passage.`}
            {mode === "timed" && timeRemaining > 0 && (
              <span> Time remaining: {fmtTime(timeRemaining)}</span>
            )}
          </div>
        </div>
      )}
    </TaskCardFrame>
  );
}
