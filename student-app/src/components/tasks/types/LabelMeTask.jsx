// student-app/src/components/tasks/types/LabelMeTask.jsx
//
// "Label Me" — image labeling. Mirrors the Matching task (tap-to-connect,
// objective scoring via a marker→term map, green/red review overlay) but the
// left column is markers A-E positioned on a diagram instead of text terms.
//
// Schema: { imageUrl, labels:[{id,correct,x,y}], options:[string], explanation }
// Interaction (V1): tap a marker, then tap a term to assign it (or tap a term
// then a marker). Tap an assigned marker to clear it.

import React, { useMemo, useState, useEffect } from "react";

function strToSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

const FALLBACK_IMG = "/demo-images/mystery-portrait.svg";

export default function LabelMeTask({ task, onSubmit, disabled, mode = "play", review = null }) {
  const cfg = (task && task.config) || {};
  const isReview = mode === "review";

  // ── Normalize labels + options ──
  const labels = useMemo(() => {
    const raw = Array.isArray(task?.labels) ? task.labels : Array.isArray(cfg.labels) ? cfg.labels : [];
    return raw
      .map((l, i) => ({
        id: String(l?.id || ["A", "B", "C", "D", "E"][i] || `M${i + 1}`).toUpperCase(),
        correct: String(l?.correct || l?.term || l?.answer || "").trim(),
        x: Math.max(0, Math.min(100, Number(l?.x))) || 50,
        y: Math.max(0, Math.min(100, Number(l?.y))) || 50,
      }))
      .filter((l) => l.correct);
  }, [task?.labels, cfg.labels]);

  const options = useMemo(() => {
    const provided = Array.isArray(task?.options) ? task.options : Array.isArray(cfg.options) ? cfg.options : [];
    const all = [...provided.map((o) => String(o || "").trim()), ...labels.map((l) => l.correct)];
    const seen = new Set();
    const uniq = [];
    for (const o of all) { const k = norm(o); if (o && !seen.has(k)) { seen.add(k); uniq.push(o); } }
    return seededShuffle(uniq, strToSeed(uniq.join("|")));
  }, [task?.options, cfg.options, labels]);

  const correctByMarker = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l.correct])),
    [labels]
  );

  const imageUrl = task?.imageUrl || cfg.imageUrl || "";
  const explanation = task?.explanation || cfg.explanation || "";

  // ── State ──
  const [assignments, setAssignments] = useState({}); // { markerId: optionText }
  const [activeMarker, setActiveMarker] = useState(null);
  const [activeOption, setActiveOption] = useState(null);
  const [localReview, setLocalReview] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setAssignments({}); setActiveMarker(null); setActiveOption(null); setLocalReview(false); setImgFailed(false);
  }, [task?.id, task?._id]);

  const inReview = isReview || localReview;
  const isComplete = labels.length > 0 && labels.every((l) => assignments[l.id]);
  const usedOptions = new Set(Object.values(assignments).map(norm));

  const assign = (markerId, optionText) => {
    if (disabled || inReview) return;
    setAssignments((prev) => {
      const next = { ...prev };
      // remove this option from any other marker (one option per marker)
      for (const k of Object.keys(next)) if (norm(next[k]) === norm(optionText)) delete next[k];
      next[markerId] = optionText;
      return next;
    });
    setActiveMarker(null);
    setActiveOption(null);
  };

  const onMarkerTap = (markerId) => {
    if (disabled || inReview) return;
    if (assignments[markerId]) {
      // tap an assigned marker → clear it
      setAssignments((prev) => { const n = { ...prev }; delete n[markerId]; return n; });
      setActiveMarker(null);
      return;
    }
    if (activeOption) { assign(markerId, activeOption); return; }
    setActiveMarker((m) => (m === markerId ? null : markerId));
  };

  const onOptionTap = (optionText) => {
    if (disabled || inReview) return;
    if (activeMarker) { assign(activeMarker, optionText); return; }
    setActiveOption((o) => (o === optionText ? null : optionText));
  };

  const score = useMemo(() => {
    let correct = 0;
    for (const l of labels) if (norm(assignments[l.id]) === norm(l.correct)) correct += 1;
    return { correct, total: labels.length };
  }, [assignments, labels]);

  const hasAnswerKey = Object.keys(correctByMarker).length > 0;

  const handleSubmit = () => {
    // External review mode is read-only; otherwise this handler drives both the
    // "Submit Labels" → review step AND the "Continue →" final submit. (Bug:
    // previously guarded on `inReview`, which is true once localReview flips on,
    // so the Continue button silently did nothing.)
    if (disabled || isReview) return;
    if (!isComplete) return;
    if (hasAnswerKey && !localReview) { setLocalReview(true); return; }
    onSubmit?.({
      type: "labelme",
      assignments,
      correct: score.correct,
      total: score.total,
      pointsEarned: score.correct,
      isCorrect: score.correct === score.total,
    });
  };

  if (!labels.length) {
    return <div style={{ padding: 24, textAlign: "center", color: "#b91c1c", fontWeight: 800 }}>This Label Me task has no markers yet.</div>;
  }

  // ── Marker badge color in review ──
  const markerColor = (l) => {
    if (!inReview) return assignments[l.id] ? "#6366f1" : "#0f172a";
    return norm(assignments[l.id]) === norm(l.correct) ? "#16a34a" : "#dc2626";
  };

  return (
    // Light surface so the dark title/prompt/legend text is always legible —
    // the practice theme is dark and these used to render near-invisible.
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16, background: "#f8fafc", color: "#0f172a", borderRadius: 18, boxShadow: "0 12px 40px rgba(15,23,42,0.18)" }}>
      <div style={{ fontWeight: 1000, fontSize: "1.15rem", marginBottom: 2, color: "#0f172a" }}>{task?.title || "Label Me"}</div>
      <div style={{ fontSize: "0.9rem", color: "#475569", marginBottom: 10 }}>
        {task?.prompt || "Match each marker A-E to the correct term."}
      </div>

      {/* Image + markers */}
      {imageUrl && !imgFailed ? (
        <div style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(15,23,42,0.12)", background: "#fff" }}>
          <img
            src={imageUrl}
            alt={task?.title || "Diagram to label"}
            onError={() => setImgFailed(true)}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
          {labels.map((l) => {
            const a = assignments[l.id];
            const active = activeMarker === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onMarkerTap(l.id)}
                disabled={disabled || inReview}
                aria-label={`Marker ${l.id}${a ? `: ${a}` : ""}`}
                style={{
                  position: "absolute",
                  left: `${l.x}%`,
                  top: `${l.y}%`,
                  transform: "translate(-50%, -50%)",
                  minWidth: 34,
                  height: 34,
                  padding: a ? "0 8px" : 0,
                  borderRadius: 999,
                  border: `3px solid ${active ? "#f59e0b" : "#fff"}`,
                  background: markerColor(l),
                  color: "#fff",
                  fontWeight: 1000,
                  fontSize: 14,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                  cursor: disabled || inReview ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                {l.id}{a ? <span style={{ fontSize: 11, fontWeight: 800 }}>· {a}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)", color: "#92400e", fontSize: "0.9rem", marginBottom: 6 }}>
          🖼️ The diagram couldn't load — match each marker below using its position description.
        </div>
      )}

      {/* Marker legend / assignment rows (also the fallback when no image) */}
      <div style={{ display: "grid", gap: 6, margin: "12px 0" }}>
        {labels.map((l) => {
          const a = assignments[l.id];
          const ok = inReview && norm(a) === norm(l.correct);
          const bad = inReview && a && !ok;
          return (
            <div
              key={l.id}
              onClick={() => onMarkerTap(l.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 12,
                border: `2px solid ${activeMarker === l.id ? "#f59e0b" : ok ? "#86efac" : bad ? "#fca5a5" : "rgba(15,23,42,0.12)"}`,
                background: ok ? "rgba(34,197,94,0.10)" : bad ? "rgba(239,68,68,0.08)" : "#fff",
                cursor: disabled || inReview ? "default" : "pointer",
              }}
            >
              <span style={{ width: 28, height: 28, borderRadius: 999, background: markerColor(l), color: "#fff", fontWeight: 1000, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{l.id}</span>
              <span style={{ fontWeight: 700, color: a ? "#0f172a" : "#94a3b8" }}>{a || "— tap, then choose a term"}</span>
              {inReview && !ok ? <span style={{ marginLeft: "auto", fontSize: "0.82rem", color: "#16a34a", fontWeight: 800 }}>✓ {l.correct}</span> : null}
            </div>
          );
        })}
      </div>

      {/* Options */}
      {!inReview && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {options.map((o) => {
            const used = usedOptions.has(norm(o));
            const sel = activeOption === o;
            return (
              <button
                key={o}
                type="button"
                onClick={() => onOptionTap(o)}
                disabled={disabled || (used && !sel)}
                style={{
                  padding: "10px 14px", borderRadius: 999,
                  border: `2px solid ${sel ? "#f59e0b" : used ? "rgba(15,23,42,0.12)" : "rgba(99,102,241,0.4)"}`,
                  background: used ? "rgba(15,23,42,0.05)" : sel ? "rgba(245,158,11,0.12)" : "#fff",
                  color: used ? "#94a3b8" : "#0f172a", fontWeight: 800, fontSize: "0.92rem",
                  cursor: disabled || (used && !sel) ? "default" : "pointer",
                }}
              >
                {o}{used ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Review banner + explanation */}
      {inReview && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <div style={{ fontWeight: 900 }}>{score.correct} / {score.total} correct</div>
          {explanation ? <div style={{ marginTop: 4, fontSize: "0.88rem", color: "#475569" }}>{explanation}</div> : null}
        </div>
      )}

      {!isReview && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isComplete || disabled}
          style={{
            width: "100%", padding: "14px 16px", borderRadius: 14, border: "none",
            background: !isComplete ? "#cbd5e1" : localReview ? "#16a34a" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "#fff", fontWeight: 1000, fontSize: "1rem",
            cursor: isComplete && !disabled ? "pointer" : "default",
          }}
        >
          {localReview ? "Continue →" : isComplete ? "Submit Labels" : `Assign all ${labels.length} markers`}
        </button>
      )}
    </div>
  );
}
