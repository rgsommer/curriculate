// student-app/src/components/tasks/types/HistoricalDocTask.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL } from "../../../config.js";
import StepCircle from "../StepCircle";
import reportImageFailure from "../../../utils/reportImageFailure.js";
import PaperPhotoSubmit from "../PaperPhotoSubmit";
import PaperExemplar from "../PaperExemplar";

/**
 * Historical Document Task — Two-phase primary source analysis with runtime image validation.
 *
 * Variation of ArtViewTask for historical documents (treaties, letters, speeches,
 * newspaper articles, maps, political cartoons, etc.).
 *
 * LOADING: Preloads the document image. Falls back to Wikimedia Commons if broken.
 *
 * Phase 1 (READING): Full-screen document image displayed for config.viewingSeconds
 *   (default 90 — longer than ArtView because reading text takes longer).
 *   Historical context is shown as an overlay.
 *
 * Phase 2 (ANALYSIS): Document disappears. Students answer guided analysis prompts
 *   about the document's relevance and impact at the time it was created.
 *
 * Scoring: hybrid — base points for answering all prompts, AI bonus for depth/insight.
 */

const PHASE = { LOADING: "loading", READING: "reading", ANALYSIS: "analysis", DONE: "done" };

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
    const res = await fetch(`${API_BASE_URL}/api/historical-doc/image-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docTitle: config.docTitle || "",
        docAuthor: config.docAuthor || "",
        docYear: config.docYear || "",
        imageDescription: config.imageDescription || "",
        docType: config.docType || "",
      }),
    });
    const data = await res.json();
    if (data?.ok && data.imageUrl) return data.imageUrl;
    return null;
  } catch {
    return null;
  }
}

export default function HistoricalDocTask({ task, onSubmit, disabled, memberNames = [], practiceMode = false }) {
  const config = task?.config || {};
  const originalUrl = config.imageUrl || "";
  const viewingSec = Math.max(10, Number(config.viewingSeconds) || 90);
  const responseSec = Math.max(30, Number(config.responseSeconds) || 150);
  const analysisPrompts = Array.isArray(config.analysisPrompts) ? config.analysisPrompts : [
    "What is the main purpose or message of this document?",
    "Who was the intended audience?",
    "What was the historical significance of this document at the time?",
  ];
  const historicalContext = config.historicalContext || "";

  // Start in READING phase with the local default image already set,
  // so something is on screen instantly. If the AI-supplied imageUrl
  // loads in the preload effect, we swap to it; otherwise the local
  // default stays. This eliminates the "stuck on loading / no doc"
  // failure mode tester flagged.
  const LOCAL_DEFAULT_DOC = "/demo-images/emancipation-proclamation.svg";
  // Self-contained data-URI fallback — needs NO network/asset serving, so the
  // document frame can never end up as a broken "won't load" box even if the
  // bundled SVG fails to serve at this path.
  const INLINE_FALLBACK_DOC =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600' width='800' height='600'>
        <rect width='800' height='600' fill='#f5f1e6'/>
        <rect x='60' y='50' width='680' height='500' fill='#fffdf7' stroke='#caa46a' stroke-width='4'/>
        <text x='400' y='150' fill='#5b4326' font-family='Georgia,serif' font-size='32' font-weight='700' text-anchor='middle'>Historical Document</text>
        <line x1='120' y1='200' x2='680' y2='200' stroke='#d8c9a6' stroke-width='3'/>
        <line x1='120' y1='250' x2='680' y2='250' stroke='#d8c9a6' stroke-width='3'/>
        <line x1='120' y1='300' x2='680' y2='300' stroke='#d8c9a6' stroke-width='3'/>
        <line x1='120' y1='350' x2='560' y2='350' stroke='#d8c9a6' stroke-width='3'/>
        <text x='400' y='460' fill='#7a6442' font-family='Georgia,serif' font-size='18' text-anchor='middle'>Read carefully and analyze its purpose, audience, and significance.</text>
      </svg>`
    );
  const [phase, setPhase] = useState(PHASE.READING);
  // In practice/demo mode, external (http) image URLs are often stale/dead in
  // older saved demo sets (tester: "still NO historical doc image… do I have to
  // regen?"). Start from the bundled local doc so SOMETHING shows instantly;
  // the preload effect below still upgrades to the real image if it loads.
  const _isExternalUrl = /^https?:/i.test(String(originalUrl || ""));
  const [resolvedUrl, setResolvedUrl] = useState(
    (practiceMode && _isExternalUrl) || !originalUrl ? LOCAL_DEFAULT_DOC : originalUrl
  );
  const [loadError, setLoadError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(viewingSec);
  const [responses, setResponses] = useState(() =>
    analysisPrompts.map((prompt) => ({ prompt, response: "" }))
  );
  const [submitted, setSubmitted] = useState(false);
  // Paper vs screen: practice is always on-screen. In a real session, honor the
  // teacher's "prefer paper" setting (minimizeOnScreen) — paper mode shows a
  // worked example + a photo-snap submit. Default (unset) is on-screen.
  const _preferPaper = !!(task?.minimizeOnScreen || config?.minimizeOnScreen);
  const [useScreen, setUseScreen] = useState(practiceMode ? true : !_preferPaper);
  // Writing on paper + snapping a photo is always available and earns a bonus.
  const PAPER_BONUS_POINTS = 5;
  const firstInputRef = useRef(null);

  // ── Image preload + fallback ──
  useEffect(() => {
    let cancelled = false;

    async function validateImage() {
      if (originalUrl) {
        try {
          const url = await preloadImage(originalUrl);
          if (!cancelled) {
            setResolvedUrl(url);
            setPhase(PHASE.READING);
            return;
          }
        } catch {
          console.warn("[HistoricalDoc] Original image failed, trying fallback...", originalUrl);
        }
      }

      const fallbackUrl = await fetchFallbackImage(config);
      if (cancelled) return;

      if (fallbackUrl) {
        try {
          const url = await preloadImage(fallbackUrl);
          if (!cancelled) {
            console.log("[HistoricalDoc] Fallback image loaded:", url);
            setResolvedUrl(url);
            setPhase(PHASE.READING);
            return;
          }
        } catch {
          console.warn("[HistoricalDoc] Fallback image also failed to load");
        }
      }

      // Bundled local default — Emancipation Proclamation (SVG) is
      // shipped in student-app/public/demo-images/. Same fix as
      // ArtView: external Wikimedia URLs were being blocked by hotlink
      // protection or CORS in some networks. Tester (Richard, May 2026)
      // was very explicit: this task MUST MUST MUST display a document.
      const DEFAULT_DOC_URL = "/demo-images/emancipation-proclamation.svg";
      try {
        const url = await preloadImage(DEFAULT_DOC_URL);
        if (!cancelled) {
          setResolvedUrl(url);
          setPhase(PHASE.READING);
          return;
        }
      } catch {
        console.warn("[HistoricalDoc] Default fallback also failed to load");
      }

      if (!cancelled) {
        // Even the bundled default couldn't preload — use the self-contained
        // inline SVG so a document always renders (never "won't load").
        setResolvedUrl(INLINE_FALLBACK_DOC);
        setLoadError("");
        setPhase(PHASE.READING);
      }
    }

    validateImage();
    return () => { cancelled = true; };
  }, [originalUrl]);

  // ── Phase timer ──
  useEffect(() => {
    if (phase !== PHASE.READING && phase !== PHASE.ANALYSIS) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (phase === PHASE.READING) {
            setPhase(PHASE.ANALYSIS);
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

  // Auto-focus first input on analysis phase
  useEffect(() => {
    if (phase === PHASE.ANALYSIS && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [phase]);

  // Auto-submit when done
  useEffect(() => {
    if (phase === PHASE.DONE && !submitted) {
      doSubmit();
    }
  }, [phase, submitted]);

  const updateResponse = useCallback((idx, value) => {
    setResponses((prev) => prev.map((r, i) => (i === idx ? { ...r, response: value } : r)));
  }, []);

  const answeredCount = responses.filter((r) => r.response.trim().length > 0).length;
  const allAnswered = answeredCount === analysisPrompts.length;

  const doSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
    onSubmit?.({
      type: "historical-doc",
      correct: false,
      basePoints: task?.points || 10,
      responses,
      answeredCount,
      totalPrompts: analysisPrompts.length,
      viewingSeconds: viewingSec,
      responseSeconds: responseSec,
      imageUsed: resolvedUrl || originalUrl || "(description only)",
      docTitle: config.docTitle || "",
      docAuthor: config.docAuthor || "",
      docYear: config.docYear || "",
    });
  }, [submitted, responses, answeredCount, analysisPrompts.length, viewingSec, responseSec, task, onSubmit, resolvedUrl, originalUrl, config]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timerColor = secondsLeft <= 10 ? "#ef4444" : secondsLeft <= 30 ? "#f59e0b" : "#6b7280";

  // ─── LOADING PHASE ───
  // Portaled to <body>: position:fixed overlay must escape TaskRunner's
  // translateZ scroll wrapper, or `inset:0` clips to that wrapper and the
  // document never shows (the "no historical document displayed" bug).
  if (phase === PHASE.LOADING) {
    return createPortal(
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#1a1a2e",
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
          borderTopColor: "#d4a574",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ color: "#d4a574", fontSize: "1rem", fontFamily: "serif" }}>
          Loading historical document...
        </div>
      </div>,
      document.body
    );
  }

  // ─── READING PHASE ───
  if (phase === PHASE.READING) {
    return createPortal(
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#1a1a2e",
        display: "flex",
        flexDirection: "column",
      }}>
        <style>{`
          .hist-doc-scroll { overflow: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; }
          .hist-doc-scroll img { touch-action: pinch-zoom; }
        `}</style>

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

        {/* Instruction + document info overlay (collapsible on small screens) */}
        <div style={{
          padding: "12px 16px",
          background: "rgba(26,26,46,0.95)",
          color: "#f5f0e8",
          fontSize: "0.85rem",
          zIndex: 10,
          borderBottom: "1px solid rgba(212,165,116,0.3)",
          flexShrink: 0,
          paddingRight: 100,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Read this document carefully. Pinch to zoom, scroll to read.
          </div>
          {historicalContext && (
            <div style={{ fontSize: "0.8rem", color: "#d4a574", fontStyle: "italic", marginBottom: 4 }}>
              {historicalContext}
            </div>
          )}
          {(config.docTitle || config.docAuthor) && (
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {[config.docTitle, config.docAuthor, config.docYear].filter(Boolean).join(" — ")}
              {config.docType && ` (${config.docType})`}
            </div>
          )}
        </div>

        {/* Scrollable + zoomable document area */}
        <div
          className="hist-doc-scroll"
          style={{
            flex: 1,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            display: "flex",
            alignItems: resolvedUrl ? "flex-start" : "center",
            justifyContent: "center",
            padding: resolvedUrl ? "12px" : "40px 20px",
          }}
        >
          {resolvedUrl ? (
            <img
              src={resolvedUrl}
              alt={config.imageDescription || "Historical document"}
              referrerPolicy="no-referrer"
              onError={(e) => {
                const src = e.target.src || "";
                if (src.startsWith("data:")) return; // inline fallback can't fail
                reportImageFailure({ taskType: "historical-doc", url: src, source: src.indexOf(LOCAL_DEFAULT_DOC) === -1 ? "primary" : "bundled-default" });
                // AI-supplied image failed → bundled local default → inline SVG.
                if (src.indexOf(LOCAL_DEFAULT_DOC) === -1) {
                  setResolvedUrl(LOCAL_DEFAULT_DOC);
                } else {
                  // Even the bundled default failed to serve — use the
                  // self-contained inline SVG so a document ALWAYS renders.
                  setResolvedUrl(INLINE_FALLBACK_DOC);
                  setLoadError("");
                }
              }}
              style={{
                width: "100%",
                maxWidth: 900,
                objectFit: "contain",
                borderRadius: 4,
                boxShadow: "0 4px 30px rgba(0,0,0,0.5)",
                border: "1px solid rgba(212,165,116,0.2)",
              }}
            />
          ) : (
            <div style={{
              color: "#f5f0e8",
              fontSize: "1.1rem",
              textAlign: "center",
              maxWidth: 650,
              lineHeight: 1.7,
              fontFamily: "serif",
            }}>
              {config.imageDescription ? (
                <>
                  <div style={{ fontSize: "0.85rem", color: "#fbbf24", marginBottom: 12, fontFamily: "sans-serif", fontWeight: 700 }}>
                    📜 Read the document description below carefully:
                  </div>
                  <div style={{ color: "#d1d5db", marginBottom: 16 }}>
                    {config.imageDescription}
                  </div>
                  {config.docTitle && (
                    <div style={{ fontStyle: "italic", color: "#d4a574" }}>
                      {[config.docTitle, config.docAuthor, config.docYear].filter(Boolean).join(" — ")}
                    </div>
                  )}
                  <div style={{ marginTop: 16, fontSize: "0.85rem", color: "#374151", fontFamily: "sans-serif" }}>
                    Use the description above to inform your analysis.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "0.85rem", color: "#ef4444", marginBottom: 12, fontFamily: "sans-serif" }}>
                    Document image unavailable
                  </div>
                  {config.docTitle && (
                    <div style={{ fontStyle: "italic", color: "#d4a574" }}>
                      {[config.docTitle, config.docAuthor, config.docYear].filter(Boolean).join(" — ")}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  // ─── ANALYSIS PHASE + DONE ───

  // Paper mode (default): show questions on screen, students write on paper
  const paperMode = !useScreen && phase === PHASE.ANALYSIS && !submitted;

  return (
    <div style={{
      padding: 20,
      maxWidth: 700,
      margin: "0 auto",
      animation: "fadeIn 0.4s ease",
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 900 }}>
            {task?.title || "Historical Document Analysis"}
          </h2>
          <p style={{ margin: "4px 0 0", color: "#374151", fontSize: "0.9rem" }}>
            {paperMode ? "Answer these questions on paper!" : "Answer the analysis questions based on what you read."}
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

      {/* Paper mode: exemplar + per-player photo capture */}
      {paperMode && (
        <div style={{ marginBottom: 20 }}>
          <PaperExemplar
            memberNames={memberNames}
            groupMode={false}
            samplePrompts={analysisPrompts}
            taskLabel={task?.title || "Historical Document"}
          />

          <PaperPhotoSubmit
            memberNames={memberNames}
            groupMode={false}
            disabled={disabled}
            taskTitle={task?.title || "Historical Document"}
            prompts={analysisPrompts}
            promptsLabel="Questions to answer:"
            onSubmit={(photoData) => {
              setSubmitted(true);
              try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
              onSubmit?.({
                type: "historical-doc",
                correct: false,
                basePoints: task?.points || 10,
                responses,
                answeredCount,
                totalPrompts: analysisPrompts.length,
                viewingSeconds: viewingSec,
                responseSeconds: responseSec,
                imageUsed: resolvedUrl || originalUrl || "(description only)",
                docTitle: config.docTitle || "",
                docAuthor: config.docAuthor || "",
                docYear: config.docYear || "",
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
              color: "#374151",
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

      {/* Screen mode: digital input */}
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
                  background: allAnswered ? "#22c55e" : "#8b5e3c",
                  width: `${Math.min(100, (answeredCount / analysisPrompts.length) * 100)}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "#374151", marginBottom: 16, textAlign: "right" }}>
                {answeredCount}/{analysisPrompts.length} questions answered
              </div>
            </>
          )}

          {/* Analysis prompts (screen mode) */}
          {useScreen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 20 }}>
              {responses.map((item, i) => (
                <div key={i} style={{
                  background: "#faf8f5",
                  border: "1px solid #e5e0d8",
                  borderRadius: 14,
                  padding: 16,
                }}>
                  <div style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    marginBottom: 10,
                  }}>
                    <StepCircle n={i + 1} />
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#374151", lineHeight: 1.5 }}>
                      {item.prompt}
                    </div>
                  </div>
                  {phase === PHASE.ANALYSIS && !submitted ? (
                    <textarea
                      ref={i === 0 ? firstInputRef : null}
                      value={item.response}
                      onChange={(e) => updateResponse(i, e.target.value)}
                      placeholder="Write your analysis here..."
                      disabled={disabled || submitted}
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "2px solid #e5e0d8",
                        fontSize: "0.95rem",
                        resize: "vertical",
                        outline: "none",
                        fontFamily: "inherit",
                        transition: "border-color 0.2s",
                        boxSizing: "border-box",
                        // Explicit colors so the typed text isn't white-on-white
                        // when the surrounding theme is dark.
                        background: "#ffffff",
                        color: "#0f172a",
                      }}
                      onFocus={(e) => { e.target.style.borderColor = "#8b5e3c"; }}
                      onBlur={(e) => { e.target.style.borderColor = "#e5e0d8"; }}
                    />
                  ) : item.response.trim() ? (
                    <div style={{
                      padding: "10px 14px",
                      background: "#fff",
                      borderRadius: 10,
                      border: "1px solid #e5e0d8",
                      fontSize: "0.95rem",
                      color: "#374151",
                      lineHeight: 1.5,
                    }}>
                      {item.response}
                    </div>
                  ) : (
                    <div style={{
                      padding: "10px 14px",
                      color: "#6b7280",
                      fontStyle: "italic",
                      fontSize: "0.9rem",
                    }}>
                      No response
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Submit button (screen mode) */}
          {!submitted && phase === PHASE.ANALYSIS && useScreen && (
            <button
              onClick={doSubmit}
              disabled={disabled || answeredCount === 0}
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: 14,
                border: "none",
                background: allAnswered ? "#22c55e" : answeredCount > 0 ? "#8b5e3c" : "#e5e7eb",
                color: answeredCount > 0 ? "#fff" : "#9ca3af",
                fontSize: "1.1rem",
                fontWeight: 900,
                cursor: answeredCount > 0 ? "pointer" : "default",
                transition: "background 0.2s",
              }}
            >
              {allAnswered
                ? "Submit Analysis"
                : answeredCount > 0
                ? `Submit (${analysisPrompts.length - answeredCount} unanswered)`
                : "Answer at least one question to submit"}
            </button>
          )}

          {/* Always offer the paper + photo option (earns a bonus). */}
          {!submitted && phase === PHASE.ANALYSIS && useScreen && (
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
              ✍️ Prefer paper? Write your answers and snap a photo — +{PAPER_BONUS_POINTS} bonus
            </button>
          )}

          {/* Done state */}
          {submitted && (
            <div style={{
              textAlign: "center",
              padding: 20,
              background: "#faf5ee",
              borderRadius: 14,
              border: "1px solid #e5d5c0",
            }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>
                {useScreen && allAnswered ? "Excellent analysis!" : "Submitted!"}
              </div>
              <div style={{ color: "#374151", fontSize: "0.9rem" }}>
                {useScreen
                  ? <>You answered {answeredCount} of {analysisPrompts.length} analysis question{analysisPrompts.length !== 1 ? "s" : ""}.</>
                  : "Your paper analysis has been noted. Great work!"
                }
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
