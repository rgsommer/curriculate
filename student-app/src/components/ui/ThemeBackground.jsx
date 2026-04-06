import React from "react";
import { THEMES } from "../../utils/themeHelpers.js";

/**
 * Renders the animated theme background layer.
 * This is a fixed-position overlay behind all content.
 */
export default function ThemeBackground({ theme = "eager" }) {
  const t = THEMES[theme];
  if (!t) return null;

  const bgClass = `theme-bg-${theme}`;

  return (
    <>
      {/* Inject keyframe animations */}
      <style>{t.animationCSS}</style>

      {/* Main animated background */}
      <div className={bgClass} />

      {/* Extra floating shapes for depth */}
      {(t.shapes || []).map((s, i) => (
        <div
          key={`${theme}-shape-${i}`}
          style={{
            position: "fixed",
            width: s.size,
            height: s.size,
            top: s.top,
            left: s.left,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${s.color}, transparent 70%)`,
            pointerEvents: "none",
            zIndex: -1,
            animation: `eager-drift ${s.duration}s ease-in-out infinite ${i % 2 === 0 ? "" : "reverse"}`,
            filter: "blur(2px)",
          }}
        />
      ))}
    </>
  );
}
