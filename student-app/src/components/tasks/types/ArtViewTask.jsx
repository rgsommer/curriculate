// student-app/src/components/tasks/types/ArtViewTask.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../../config.js";
import StepCircle from "../StepCircle";

/**
 * Art View Task — Two-phase visual observation challenge with runtime image validation.
 *
 * LOADING: Preloads the image URL. If it fails (404, CORS, timeout), calls
 *   /api/art-view/image-fallback with the stored metadata to find a replacement.
 *
 * Phase 1 (VIEWING): Full-screen image displayed for config.viewingSeconds (default 60).
 *   A countdown timer is visible. Students study the artwork.
 *
 * Phase 2 (RESPONDING): Image disappears. Students type observations one at a time.
 *   Timer counts down config.responseSeconds (default 120).
 *
 * Scoring: hybrid — base points per unique observation, AI bonus for quality/depth.
 */

const PHASE = { LOADING: "loading", VIEWING: "viewing", RESPONDING: "responding", DONE: "done" };

function preloadImage(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("No URL"));
    const img = new Image();
    const timer = setTimeout(() => { img.src = ""; reject(new Error("Timeout")); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(url); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("Load failed")); };
    img.src = url;
  });
}

async function fetchFallbackImage(config) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/art-view/image-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageTitle: config.imageTitle || "",
        imageArtist: config.imageArtist || "",
        imageYear: config.imageYear || "",
        imageDescription: config.imageDescription || "",
      }),
    });
    const data = await res.json();
    if (data?.ok && data.imageUrl) return data.imageUrl;
    return null;
  } catch {
    return null;
  }
}

export default function ArtViewTask({ task, onSubmit, disabled }) {
  const config = task?.config || {};
  const originalUrl = config.imageUrl || "";
  const viewingSec = Math.max(10, Number(config.viewingSeconds) || 60);
  const responseSec = Math.max(30, Number(config.responseSeconds) || 120);
  const minObs = Number(config.minObservations) || 5;
  const focusHints = Array.isArray(config.focusHints) ? config.focusHints : [];

  const [phase, setPhase] = useState(PHASE.LOADING);
  const [resolvedUrl, setResolvedUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(viewingSec);
  const [observations, setObservations] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [useScreen, setUseScreen] = useState(false); // default: paper mode
  const inputRef = useRef(null);

  // ── Image preload + fallback ──
  useEffect(() => {
    let cancelled = false;

    async function validateImage() {
      // Try the original URL first
      if (originalUrl) {
        try {
          const url = await preloadImage(originalUrl);
          if (!cancelled) {
            setResolvedUrl(url);
            setPhase(PHASE.VIEWING);
            return;
          }
        } catch {
          console.warn("[ArtView] Original image failed, trying fallback...", originalUrl);
        }
      }

      // Try fallback via Wikimedia Commons
      const fallbackUrl = await fetchFallbackImage(config);
      if (cancelled) return;

      if (fallbackUrl) {
        try {
          const url = await preloadImage(fallbackUrl);
          if (!cancelled) {
            console.log("[ArtView] Fallback image loaded:", url);
            setResolvedUrl(url);
            setPhase(PHASE.VIEWING);
            return;
          }
        } catch {
          console.warn("[ArtView] Fallback image also failed to load");
        }
      }

      // Both failed — show description-only mode
      if (!cancelled) {
        setLoadError("Image unavailable");
        setPhase(PHASE.VIEWING);
      }
    }

    validateImage();
    return () => { cancelled = true; };
  }, [originalUrl]);

  // ── Phase timer (only ticks during VIEWING and RESPONDING) ──
  useEffect(() => {
    if (phase !== PHASE.VIEWING && phase !== PHASE.RESPONDING) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (phase === PHASE.VIEWING) {
            setPhase(PHASE.RESPONDING);
            return responseSec;
          } else {
            setPhase(PHASE.DONE);
            return 0;
          }
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, responseSec]);

  // Auto-focus input when entering response phase
  useEffect(() => {
    if (phase === PHASE.RESPONDING && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase]);

  // Auto-submit when done
  useEffect(() => {
    if (phase === PHASE.DONE && !submitted) {
      doSubmit();
    }
  }, [phase, submitted]);

  const addObservation = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (observations.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
      setInputValue("");
      return;
    }
    setObservations((prev) => [...prev, trimmed]);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, observations]);

  const removeObservation = useCallback((idx) => {
    setObservations((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const doSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
    onSubmit?.({
      type: "art-view",
      correct: false,
      basePoints: task?.points || 10,
      observations,
      observationCount: observations.length,
      minObservations: minObs,
      viewingSeconds: viewingSec,
      responseSeconds: responseSec,
      imageUsed: resolvedUrl || originalUrl || "(description only)",
    });
  }, [submitted, observations, minObs, viewingSec, responseSec, task, onSubmit, resolvedUrl, originalUrl]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timerColor = secondsLeft <= 10 ? "#ef4444" : secondsLeft <= 30 ? "#f59e0b" : "#6b7280";
  const meetsMin = observations.length >= minObs;

  // ─── LOADING PHASE ───
  if (phase === PHASE.LOADING) {
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}>
        <div style={{
          width: 48,
          height: 48,
          border: "4px solid rgba(255,255,255,0.2)",
          borderTopColor: "#fff",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ color: "#9ca3af", fontSize: "1rem" }}>
          Loading artwork...
        </div>
      </div>
    );
  }

  // ─── VIEWING PHASE ───
  if (phase === PHASE.VIEWING) {
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {/* Timer overlay */}
        <div style={{
          position: "absolute",
          top: 16,
          right: 20,
          background: "rgba(0,0,0,0.7)",
          color: timerColor,
          padding: "8px 16px",
          borderRadius: 12,
          fontSize: "1.4rem",
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          zIndex: 10,
        }}>
          {formatTime(secondsLeft)}
        </div>

        {/* Instruction + artwork info overlay */}
        <div style={{
          position: "absolute",
          top: 16,
          left: 20,
          background: "rgba(0,0,0,0.7)",
          color: "#fff",
          padding: "10px 16px",
          borderRadius: 12,
          fontSize: "0.9rem",
          maxWidth: 350,
          zIndex: 10,
        }}>
          <div style={{ marginBottom: 6 }}>
            Study this image carefully. When the timer ends, it will disappear and you'll write your observations.
          </div>
          {(config.imageTitle || config.imageArtist) && (
            <div style={{ fontSize: "0.8rem", color: "#d1d5db", fontStyle: "italic" }}>
              {[config.imageTitle, config.imageArtist, config.imageYear].filter(Boolean).join(" — ")}
            </div>
          )}
        </div>

        {/* Focus hints */}
        {focusHints.length > 0 && (
          <div style={{
            position: "absolute",
            bottom: 16,
            left: 20,
            right: 20,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
            zIndex: 10,
          }}>
            {focusHints.map((hint, i) => (
              <span key={i} style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: "0.8rem",
                backdropFilter: "blur(4px)",
              }}>
                {hint}
              </span>
            ))}
          </div>
        )}

        {/* The image (or description fallback) */}
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt={config.imageDescription || "Study this image"}
            style={{
              maxWidth: "95vw",
              maxHeight: "90vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        ) : (
          <div style={{
            color: "#e5e7eb",
            fontSize: "1.1rem",
            textAlign: "center",
            padding: 40,
            maxWidth: 600,
            lineHeight: 1.6,
          }}>
            {config.imageDescription ? (
              <>
                <div style={{ fontSize: "0.85rem", color: "#fbbf24", marginBottom: 12, fontWeight: 700 }}>
                  📖 Read the description below and study it carefully:
                </div>
                <div style={{ color: "#d1d5db" }}>
                  {config.imageDescription}
                </div>
                {config.artTitle && (
                  <div style={{ marginTop: 12, fontStyle: "italic", color: "#9ca3af" }}>
                    {[config.artTitle, config.artist, config.year].filter(Boolean).join(" — ")}
                  </div>
                )}
                <div style={{ marginTop: 16, fontSize: "0.85rem", color: "#6b7280" }}>
                  Use the description above to form your observations.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "0.85rem", color: "#ef4444", marginBottom: 12 }}>
                  Image unavailable
                </div>
                {config.artTitle && (
                  <div style={{ marginTop: 12, fontStyle: "italic", color: "#9ca3af" }}>
                    {[config.artTitle, config.artist, config.year].filter(Boolean).join(" — ")}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── RESPONDING PHASE + DONE ───

  // Paper mode (default): show prompts on screen, students write on paper
  const paperMode = !useScreen && phase === PHASE.RESPONDING && !submitted;

  return (
    <div style={{
      padding: 20,
      maxWidth: 700,
      margin: "0 auto",
      animation: "fadeIn 0.4s ease",
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 900 }}>
            {task?.title || "Art View"}
          </h2>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            {paperMode ? "Write your observations on paper!" : "Write as many observations as you can remember!"}
          </p>
        </div>
        {phase !== PHASE.DONE && (
          <div style={{
            fontSize: "1.5rem",
            fontWeight: 900,
            color: timerColor,
            fontVariantNumeric: "tabular-nums",
          }}>
            {formatTime(secondsLeft)}
          </div>
        )}
      </div>

      {/* Paper mode: show prompts + write-on-paper message */}
      {paperMode && (
        <div style={{ marginBottom: 20 }}>
          <div style={{
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "1px solid #f59e0b",
            borderRadius: 16,
            padding: "20px 22px",
            marginBottom: 16,
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: 6 }}>✍️</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#92400e", marginBottom: 4 }}>
              Write your observations on paper
            </div>
            <div style={{ fontSize: "0.85rem", color: "#a16207" }}>
              Describe what you saw — details about colors, composition, subjects, mood, and artistic techniques.
              Write at least {minObs} observations.
            </div>
          </div>

          {focusHints.length > 0 && (
            <div style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
            }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#334155", marginBottom: 10 }}>
                Focus areas to consider:
              </div>
              {focusHints.map((hint, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <StepCircle n={i + 1} size={24} />
                  <span style={{ fontSize: "0.9rem", color: "#475569" }}>{hint}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => { doSubmit(); }}
            disabled={disabled}
            style={{
              width: "100%",
              padding: "16px 24px",
              borderRadius: 14,
              border: "none",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "#fff",
              fontSize: "1.1rem",
              fontWeight: 900,
              cursor: "pointer",
              marginBottom: 10,
            }}
          >
            DONE ✅ — I've written my observations
          </button>

          <button
            onClick={() => setUseScreen(true)}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "transparent",
              color: "#6b7280",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Type on screen instead
          </button>
        </div>
      )}

      {/* Screen mode: digital input (shown if useScreen toggled or always in done state) */}
      {(!paperMode || submitted) && (
        <>
          {/* Progress bar */}
          {useScreen && (
            <>
              <div style={{
                height: 6,
                borderRadius: 3,
                background: "#e5e7eb",
                marginBottom: 16,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  borderRadius: 3,
                  background: meetsMin ? "#22c55e" : "#3b82f6",
                  width: `${Math.min(100, (observations.length / minObs) * 100)}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: 12, textAlign: "right" }}>
                {observations.length} observation{observations.length !== 1 ? "s" : ""}
                {!meetsMin && ` (need ${minObs})`}
                {meetsMin && " — keep going!"}
              </div>
            </>
          )}

          {/* Input area */}
          {phase === PHASE.RESPONDING && !submitted && useScreen && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addObservation(); }}
                placeholder="Type an observation and press Enter..."
                disabled={disabled || submitted}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "2px solid #d1d5db",
                  fontSize: "1rem",
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; }}
                onBlur={(e) => { e.target.style.borderColor = "#d1d5db"; }}
              />
              <button
                onClick={addObservation}
                disabled={!inputValue.trim()}
                style={{
                  padding: "12px 20px",
                  borderRadius: 12,
                  border: "none",
                  background: inputValue.trim() ? "#3b82f6" : "#e5e7eb",
                  color: inputValue.trim() ? "#fff" : "#9ca3af",
                  fontWeight: 800,
                  fontSize: "1rem",
                  cursor: inputValue.trim() ? "pointer" : "default",
                }}
              >
                Add
              </button>
            </div>
          )}

          {/* Observations list */}
          {useScreen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
              {observations.map((obs, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "#f3f4f6",
                    animation: "popIn 0.2s ease",
                  }}
                >
                  <StepCircle n={i + 1} size={24} />
                  <span style={{ flex: 1, fontSize: "0.95rem" }}>{obs}</span>
                  {phase === PHASE.RESPONDING && !submitted && (
                    <button
                      onClick={() => removeObservation(i)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#9ca3af",
                        cursor: "pointer",
                        fontSize: "1.1rem",
                        padding: 4,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {observations.length === 0 && phase === PHASE.RESPONDING && (
                <div style={{ textAlign: "center", color: "#9ca3af", padding: 20, fontSize: "0.9rem" }}>
                  No observations yet. Start typing above!
                </div>
              )}
            </div>
          )}

          {/* Submit button (screen mode) */}
          {!submitted && phase === PHASE.RESPONDING && useScreen && (
            <button
              onClick={doSubmit}
              disabled={disabled || observations.length === 0}
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: 14,
                border: "none",
                background: meetsMin ? "#22c55e" : observations.length > 0 ? "#3b82f6" : "#e5e7eb",
                color: observations.length > 0 ? "#fff" : "#9ca3af",
                fontSize: "1.1rem",
                fontWeight: 900,
                cursor: observations.length > 0 ? "pointer" : "default",
                transition: "background 0.2s",
              }}
            >
              {meetsMin
                ? `Submit ${observations.length} observations`
                : observations.length > 0
                ? `Submit (${minObs - observations.length} more needed for full points)`
                : "Add observations to submit"}
            </button>
          )}

          {/* Done state */}
          {submitted && (
            <div style={{
              textAlign: "center",
              padding: 20,
              background: "#ecfdf5",
              borderRadius: 14,
              border: "1px solid #bbf7d0",
            }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>
                {useScreen && meetsMin ? "Great work!" : "Submitted!"}
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                {useScreen
                  ? <>You recorded {observations.length} observation{observations.length !== 1 ? "s" : ""}.{!meetsMin && ` (Target was ${minObs})`}</>
                  : "Your paper observations have been noted. Great work!"
                }
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
