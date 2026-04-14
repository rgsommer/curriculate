// teacher-app/src/components/SpotlightTour.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * SpotlightTour — A lightweight, reusable first-time guided overlay.
 *
 * Usage:
 *   <SpotlightTour
 *     tourId="generator-v1"        // unique key for localStorage (fires once per tourId)
 *     steps={[
 *       { target: "#subject-field", title: "Pick a subject", body: "Start here..." },
 *       { target: "#task-types",    title: "Choose task types", body: "Or let AI pick..." },
 *     ]}
 *     onComplete={() => {}}         // optional callback
 *     forceShow={false}             // override localStorage and always show
 *   />
 *
 * Each step highlights a DOM element matching `target` (CSS selector) with a spotlight
 * cutout and positions a tooltip next to it. Steps advance with Next / Back / Skip.
 *
 * First-time detection: Fires automatically once per tourId. After completion or skip,
 * stores `tour-seen-{tourId}` in localStorage so it doesn't show again.
 * Users can re-trigger via a "?" help button rendered by the parent.
 */

const STORAGE_PREFIX = "curriculate-tour-seen-";

function hasSeenTour(tourId) {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${tourId}`) === "true";
  } catch {
    return false;
  }
}

function markTourSeen(tourId) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${tourId}`, "true");
  } catch {}
}

export function resetTour(tourId) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${tourId}`);
  } catch {}
}

export default function SpotlightTour({
  tourId,
  steps = [],
  onComplete,
  forceShow = false,
}) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const overlayRef = useRef(null);

  // Auto-show on mount if first time
  useEffect(() => {
    if (steps.length === 0) return;
    if (forceShow || !hasSeenTour(tourId)) {
      // Small delay so the page has time to render targets
      const timer = setTimeout(() => {
        setVisible(true);
        setStepIndex(0);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [tourId, forceShow, steps.length]);

  // Position the spotlight and tooltip when step changes
  useEffect(() => {
    if (!visible || !steps[stepIndex]) return;

    const target = steps[stepIndex].target;
    if (!target) {
      setSpotlightRect(null);
      return;
    }

    const el = document.querySelector(target);
    if (!el) {
      // Target not found — skip to next step or show centered
      setSpotlightRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    const pad = 8;
    setSpotlightRect({
      top: rect.top - pad + window.scrollY,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });

    // Position tooltip below or above the target
    const viewH = window.innerHeight;
    const spaceBelow = viewH - rect.bottom;
    const tooltipW = 320;

    let top, left;
    if (spaceBelow > 180) {
      // Below
      top = rect.bottom + 12 + window.scrollY;
    } else {
      // Above
      top = rect.top - 12 + window.scrollY - 140;
    }
    left = Math.max(16, Math.min(rect.left, window.innerWidth - tooltipW - 16));

    setTooltipPos({ top, left });

    // Scroll target into view if needed
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visible, stepIndex, steps]);

  const finish = useCallback(() => {
    setVisible(false);
    markTourSeen(tourId);
    onComplete?.();
  }, [tourId, onComplete]);

  const next = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  }, [stepIndex, steps.length, finish]);

  const back = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  if (!visible || steps.length === 0) return null;

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        pointerEvents: "auto",
      }}
    >
      {/* Semi-transparent overlay with spotlight cutout */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        onClick={finish}
      >
        <defs>
          <mask id={`spotlight-mask-${tourId}`}>
            <rect width="100%" height="100%" fill="white" />
            {spotlightRect && (
              <rect
                x={spotlightRect.left}
                y={spotlightRect.top}
                width={spotlightRect.width}
                height={spotlightRect.height}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15,23,42,0.6)"
          mask={`url(#spotlight-mask-${tourId})`}
        />
      </svg>

      {/* Spotlight ring */}
      {spotlightRect && (
        <div
          style={{
            position: "absolute",
            top: spotlightRect.top - 2,
            left: spotlightRect.left - 2,
            width: spotlightRect.width + 4,
            height: spotlightRect.height + 4,
            borderRadius: 12,
            border: "2px solid rgba(99,102,241,0.6)",
            boxShadow: "0 0 0 4px rgba(99,102,241,0.15)",
            pointerEvents: "none",
            transition: "all 0.3s ease",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{
          position: "absolute",
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: 320,
          background: "#ffffff",
          borderRadius: 14,
          boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
          padding: 16,
          animation: "spotlightFadeIn 0.25s ease",
          zIndex: 10001,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes spotlightFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Step counter */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}>
          <div style={{ display: "flex", gap: 4 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === stepIndex ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === stepIndex ? "#6366f1" : i < stepIndex ? "#a5b4fc" : "#e5e7eb",
                  transition: "all 0.2s",
                }}
              />
            ))}
          </div>
          <button
            onClick={finish}
            style={{
              border: "none",
              background: "transparent",
              color: "#9ca3af",
              cursor: "pointer",
              fontSize: "0.75rem",
            }}
          >
            Skip tour
          </button>
        </div>

        {/* Content */}
        {step.title && (
          <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 4, color: "#111827" }}>
            {step.title}
          </div>
        )}
        {step.body && (
          <div style={{ fontSize: "0.85rem", color: "#4b5563", lineHeight: 1.5, marginBottom: 14 }}>
            {step.body}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {!isFirst && (
              <button
                onClick={back}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#374151",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            )}
          </div>
          <button
            onClick={next}
            style={{
              padding: "5px 16px",
              borderRadius: 8,
              border: "none",
              background: "#6366f1",
              color: "#fff",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isLast ? "Got it!" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Small "?" button that re-triggers a tour. Place in a page header.
 */
export function TourHelpButton({ tourId, onClick }) {
  return (
    <button
      type="button"
      title="Show guided tour"
      onClick={() => {
        resetTour(tourId);
        onClick?.();
      }}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        border: "1px solid #d1d5db",
        background: "#f9fafb",
        color: "#6b7280",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      ?
    </button>
  );
}
