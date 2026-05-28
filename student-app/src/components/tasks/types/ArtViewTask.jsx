// student-app/src/components/tasks/types/ArtViewTask.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL } from "../../../config.js";
import StepCircle from "../StepCircle";
import PaperPhotoSubmit from "../PaperPhotoSubmit";
import PaperExemplar from "../PaperExemplar";
import reportImageFailure from "../../../utils/reportImageFailure.js";

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

export default function ArtViewTask({ task, onSubmit, disabled, memberNames = [], practiceMode = false }) {
  const config = task?.config || {};
  const originalUrl = config.imageUrl || "";
  const viewingSec = Math.max(10, Number(config.viewingSeconds) || 60);
  const responseSec = Math.max(30, Number(config.responseSeconds) || 120);
  const minObs = Number(config.minObservations) || 5;
  const focusHints = Array.isArray(config.focusHints) ? config.focusHints : [];

  // Bundled local default — guaranteed to load, no CORS / hotlink
  // issues. Tester (Richard, May 2026): "Still no art! What is going
  // on?? this task MUST MUST MUST display an image of a piece of
  // historically relevant art." The previous external Wikimedia thumb
  // was being blocked by hotlink protection in some networks.
  // /demo-images/great-wave.svg is bundled in student-app/public/.
  // (great-wave.jpg shipped as a 0-byte placeholder and never rendered —
  // that was the root cause of "no art ever shows". Use the valid SVG.)
  const DEFAULT_ART_URL = "/demo-images/great-wave.svg";

  // Absolute last-resort fallback: a self-contained data-URI SVG that needs NO
  // network request and NO bundled asset to render. If even the bundled
  // /demo-images default somehow fails to serve, this guarantees the viewing
  // frame still shows an image instead of a broken "won't load" box.
  const INLINE_FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 560' width='800' height='560'>
        <rect width='800' height='560' fill='#1e293b'/>
        <rect x='40' y='40' width='720' height='480' fill='none' stroke='#64748b' stroke-width='6' rx='12'/>
        <text x='400' y='270' fill='#e2e8f0' font-family='system-ui,sans-serif' font-size='34' font-weight='700' text-anchor='middle'>Artwork</text>
        <text x='400' y='320' fill='#94a3b8' font-family='system-ui,sans-serif' font-size='20' text-anchor='middle'>Study the details and describe what you observe.</text>
      </svg>`
    );

  // Skip the LOADING preload-validation step entirely — it was sticking
  // the practicer on a black spinner whenever the preload promise hung
  // (e.g. CORS quirks, slow image hosts).  Render the image directly
  // and use <img onError> to swap to the default if it fails to load.
  // The practicer always sees *some* artwork right away. In practice/demo mode,
  // external (http) URLs in older saved demo sets are often stale, so start
  // from the bundled local artwork; the <img onError> still upgrades/falls back.
  const _isExternalUrl = /^https?:/i.test(String(originalUrl || ""));
  const _startUrl = (practiceMode && _isExternalUrl) || !originalUrl ? DEFAULT_ART_URL : originalUrl;
  const [phase, setPhase] = useState(PHASE.VIEWING);
  const [resolvedUrl, setResolvedUrl] = useState(_startUrl);
  const [loadError, setLoadError] = useState("");
  const [usedDefaultFallback, setUsedDefaultFallback] = useState(_startUrl === DEFAULT_ART_URL);
  const [secondsLeft, setSecondsLeft] = useState(viewingSec);
  const [observations, setObservations] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // AI feedback on the student's observations (tester ask). After submit we
  // fetch a short coach note BEFORE advancing; onSubmit is deferred until the
  // student taps Continue. Falls back to a friendly rubric note on any failure.
  const [feedbackPhase, setFeedbackPhase] = useState("idle"); // idle | scoring | feedback
  const [aiFeedback, setAiFeedback] = useState("");
  const pendingSubmitRef = useRef(null);
  // Paper vs screen: practice is always on-screen. In a real session, honor the
  // teacher's "prefer paper" setting (minimizeOnScreen) — paper mode shows a
  // worked example + a photo-snap submit. Default (unset) is on-screen.
  const _preferPaper = !!(task?.minimizeOnScreen || config?.minimizeOnScreen);
  const [useScreen, setUseScreen] = useState(practiceMode ? true : !_preferPaper);
  // Writing on paper + snapping a photo is always available and earns a bonus.
  const PAPER_BONUS_POINTS = 5;
  const inputRef = useRef(null);

  // (Preload + LOADING-phase validation removed — see state init above.
  //  The viewing phase now starts immediately with the original URL,
  //  and <img onError> swaps to DEFAULT_ART_URL if the network request
  //  fails.  Server-side fetch fallback is still available but
  //  triggered lazily on image error, not as a blocking preload.)
  const handleImageError = useCallback(() => {
    if (resolvedUrl === INLINE_FALLBACK) return; // can't fail further
    // Tell the backend so the failure shows in the feedback report and a fix
    // (e.g. a dead S3/external URL) can be initiated — not just silently masked.
    reportImageFailure({ taskType: "art-view", url: resolvedUrl, source: usedDefaultFallback ? "bundled-default" : "primary" });
    if (usedDefaultFallback) {
      // Bundled default ALSO failed (e.g. assets not served at this path).
      // Swap to the self-contained inline SVG so the frame always shows an
      // image — never a broken "won't load" box.
      setLoadError("");
      setResolvedUrl(INLINE_FALLBACK);
      return;
    }
    // Try server-side replacement first; if that fails, snap to the
    // hard-coded default.
    (async () => {
      const fb = await fetchFallbackImage(config);
      if (fb && fb !== resolvedUrl) {
        setResolvedUrl(fb);
        return;
      }
      setResolvedUrl(DEFAULT_ART_URL);
      setUsedDefaultFallback(true);
    })();
  }, [config, resolvedUrl, usedDefaultFallback, DEFAULT_ART_URL]);

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

  // Let viewers move on when they're done studying the artwork instead of
  // waiting out the timer (tester: "there should be a done button"). Timer
  // stays as a fallback.
  const finishViewingEarly = useCallback(() => {
    if (phase !== PHASE.VIEWING) return;
    setPhase(PHASE.RESPONDING);
    setSecondsLeft(responseSec);
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

    // Stash the submission; fire it only after the student reads the feedback.
    pendingSubmitRef.current = {
      type: "art-view",
      correct: false,
      basePoints: task?.points || 10,
      observations,
      observationCount: observations.length,
      minObservations: minObs,
      viewingSeconds: viewingSec,
      responseSeconds: responseSec,
      imageUsed: resolvedUrl || originalUrl || "(description only)",
    };

    // No observations to coach (e.g. paper mode) → skip straight to ship.
    if (!observations.length) {
      const p = pendingSubmitRef.current; pendingSubmitRef.current = null;
      onSubmit?.(p);
      return;
    }

    setFeedbackPhase("scoring");
    (async () => {
      let coach = "";
      try {
        const subject = config?.imageTitle || config?.docTitle || task?.title || "this artwork";
        const r = await fetch(`${API_BASE_URL}/api/text-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "art-view",
            prompt: `Student observations about ${subject}. Coach their observation skill AND teach: praise one strong observation, then point out one specific thing to notice next and EXPLAIN it concretely. If you suggest a connection (e.g. to a style, period, or technique), NAME the actual connection and say what to look for — don't just tell them to "make connections."`,
            context: config?.imageDescription || "",
            response: observations.map((o, i) => `${i + 1}. ${o}`).join("\n"),
          }),
        });
        const j = await r.json().catch(() => null);
        if (j?.feedback) coach = String(j.feedback);
      } catch { /* fall through to default */ }
      if (!coach) {
        coach =
          "Nice observing! Strong observations name specific details (color, line, shape, mood) and what they make you wonder. Next time, try connecting one detail to why the artist might have chosen it.";
      }
      setAiFeedback(coach);
      setFeedbackPhase("feedback");
    })();
  }, [submitted, observations, minObs, viewingSec, responseSec, task, onSubmit, resolvedUrl, originalUrl, config]);

  const handleFeedbackContinue = useCallback(() => {
    const p = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    if (p) onSubmit?.(p);
  }, [onSubmit]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timerColor = secondsLeft <= 10 ? "#ef4444" : secondsLeft <= 30 ? "#f59e0b" : "#6b7280";
  // High-contrast palette for the DARK viewing overlay (gray was nearly invisible
  // on the black backdrop — tester: "countdown timer not visible").
  const darkTimerColor = secondsLeft <= 10 ? "#fca5a5" : secondsLeft <= 30 ? "#fcd34d" : "#67e8f9";
  const meetsMin = observations.length >= minObs;

  // ─── LOADING PHASE ───
  // Portaled to <body>: this is a position:fixed full-screen overlay, and an
  // ancestor `transform` (TaskRunner's translateZ scroll wrapper) would
  // otherwise make `inset:0` resolve against that wrapper — clipping the
  // overlay to ~nothing. That was the real "no art / no document displayed"
  // bug for art-view & historical-doc (the only fixed-overlay tasks).
  if (phase === PHASE.LOADING) {
    return createPortal(
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
      </div>,
      document.body
    );
  }

  // ─── VIEWING PHASE ───
  if (phase === PHASE.VIEWING) {
    return createPortal(
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}>
        <style>{`
          .art-view-scroll { overflow: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; }
          .art-view-scroll img { touch-action: pinch-zoom; }
        `}</style>

        {/* Vertical countdown bar — full at the top, depletes downward as time
            elapses (tester ask). Wide + bright so it's impossible to miss. */}
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 18, background: "rgba(255,255,255,0.22)", zIndex: 11 }}>
          <div style={{
            width: "100%",
            height: `${Math.max(0, Math.min(100, (secondsLeft / Math.max(1, viewingSec)) * 100))}%`,
            background: darkTimerColor,
            boxShadow: `0 0 12px ${darkTimerColor}`,
            transition: "height 1s linear",
          }} />
        </div>

        {/* Timer overlay — top-center, bright, large (avoids notch/cutoff at the
            corners and stays legible on the dark image). */}
        <div style={{
          position: "absolute",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.85)",
          color: darkTimerColor,
          padding: "8px 20px",
          borderRadius: 999,
          fontSize: "1.7rem",
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          border: `2px solid ${darkTimerColor}`,
          zIndex: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          ⏳ {formatTime(secondsLeft)}
        </div>

        {/* Done-viewing button — move on when finished studying instead of
            waiting out the timer (tester: "there should be a done button"). */}
        <button
          type="button"
          onClick={finishViewingEarly}
          style={{
            position: "absolute", top: 14, right: 16, zIndex: 12,
            padding: "10px 16px", borderRadius: 999, border: "none",
            background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: "0.85rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)", cursor: "pointer",
          }}
        >
          ✓ Done — continue
        </button>

        {/* Instruction + artwork info bar */}
        <div style={{
          padding: "10px 16px",
          paddingRight: 100,
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          fontSize: "0.85rem",
          zIndex: 10,
          flexShrink: 0,
        }}>
          <div style={{ marginBottom: 4 }}>
            Study this image carefully. Pinch to zoom, scroll to explore.
          </div>
          {(config.imageTitle || config.imageArtist) && (
            <div style={{ fontSize: "0.78rem", color: "#d1d5db", fontStyle: "italic" }}>
              {[config.imageTitle, config.imageArtist, config.imageYear].filter(Boolean).join(" — ")}
            </div>
          )}
        </div>

        {/* Scrollable + zoomable image area */}
        <div
          className="art-view-scroll"
          style={{
            flex: 1,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            display: "flex",
            alignItems: resolvedUrl ? "flex-start" : "center",
            justifyContent: "center",
            padding: resolvedUrl ? "12px" : "40px 20px",
            position: "relative",
          }}
        >
          {resolvedUrl ? (
            <img
              src={resolvedUrl}
              alt={config.imageDescription || "Study this image"}
              onError={handleImageError}
              referrerPolicy="no-referrer"
              style={{
                width: "100%",
                maxWidth: 900,
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
          ) : (
            <div style={{
              color: "#e5e7eb",
              fontSize: "1.1rem",
              textAlign: "center",
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

          {/* Focus hints at bottom of scroll area */}
          {focusHints.length > 0 && (
            <div style={{
              position: "fixed",
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
        </div>
      </div>,
      document.body
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
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "1.4rem",
            fontWeight: 900,
            color: "#fff",
            background: timerColor === "#6b7280" ? "#0ea5e9" : timerColor,
            padding: "6px 14px",
            borderRadius: 999,
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}>
            ⏳ {formatTime(secondsLeft)}
          </div>
        )}
      </div>

      {/* Paper mode: exemplar + per-player photo capture */}
      {paperMode && (
        <div style={{ marginBottom: 20 }}>
          <PaperExemplar
            memberNames={memberNames}
            groupMode={false}
            samplePrompts={focusHints.length > 0 ? focusHints : [`Write at least ${minObs} observations about the artwork`]}
            taskLabel={task?.title || "Art View"}
          />

          <PaperPhotoSubmit
            memberNames={memberNames}
            groupMode={false}
            disabled={disabled}
            taskTitle={task?.title || "Art View"}
            prompts={focusHints}
            promptsLabel={focusHints.length > 0 ? "Focus areas to consider:" : ""}
            onSubmit={(photoData) => {
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
                paperMode: true,
                handwritingBonus: true,
                handwritingBonusPoints: PAPER_BONUS_POINTS,
                ...photoData,
              });
            }}
          />

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
              marginTop: 6,
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
                  // Explicit colors: the input inherited the (dark) theme text
                  // color on a white field → invisible "white on white" text.
                  background: "#ffffff",
                  color: "#0f172a",
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
                  <span style={{ flex: 1, fontSize: "0.95rem", color: "#0f172a" }}>{obs}</span>
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

          {/* Always offer the paper + photo option (earns a bonus). */}
          {!submitted && phase === PHASE.RESPONDING && useScreen && (
            <button
              onClick={() => setUseScreen(false)}
              disabled={disabled}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 16px",
                borderRadius: 12,
                border: "1px dashed #b45309",
                background: "rgba(245,158,11,0.10)",
                color: "#92400e",
                fontSize: "0.9rem",
                fontWeight: 800,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              ✍️ Prefer paper? Write your observations and snap a photo — +{PAPER_BONUS_POINTS} bonus
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

              {/* AI coach feedback */}
              {feedbackPhase === "scoring" && (
                <div style={{ marginTop: 14, color: "#0e7490", fontWeight: 700 }}>
                  🤖 Coach is reading your observations…
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
                    <div style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{aiFeedback}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleFeedbackContinue}
                    style={{
                      marginTop: 14,
                      width: "100%",
                      padding: "12px 20px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: "1rem",
                      cursor: "pointer",
                    }}
                  >
                    Continue ▶
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
