// student-app/src/components/tasks/SpeechQualityMeter.jsx
//
// A reusable "speedometer" quality gauge for free-text / dictated answers.
//
// One text-based meter serves BOTH typed and spoken input: dictation (Web
// Speech API) already writes recognized words into the same answer box, so
// fillers like "um / uh / like / you know" show up in the text and the meter
// reacts the same whether the student typed or spoke.
//
// Score (0-100) rises with sustained length + vocabulary variety and FALLS
// with filler-word density and heavy repetition. It's a live coaching nudge —
// it does NOT change grading.

import React, { useMemo } from "react";
import { computeTextQuality } from "@shared/textQuality.js";

// Re-export so existing imports of computeTextQuality from this module keep
// working; the scoring itself now lives in shared/textQuality.js (shared with
// the backend session reports).
export { computeTextQuality };

/**
 * Speedometer gauge. Pass the live answer `text`; it recomputes on each change.
 * `dark` flips label colors for dark task surfaces.
 */
export default function SpeechQualityMeter({ text, dark = false, compact = false, style = {} }) {
  const q = useMemo(() => computeTextQuality(text), [text]);

  // Semicircle gauge geometry.
  const W = 132, H = compact ? 74 : 84, cx = W / 2, cy = H - 10, r = 52;
  // Map score 0..100 → angle 180°..0° (left→right across the top arc).
  const angleDeg = 180 - (q.score / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const needleLen = r - 8;
  const nx = cx + needleLen * Math.cos(angleRad);
  const ny = cy - needleLen * Math.sin(angleRad);

  // Colored arc segments (red → amber → green) as a backdrop.
  const arcPath = (startPct, endPct) => {
    const a0 = ((180 - startPct * 180) * Math.PI) / 180;
    const a1 = ((180 - endPct * 180) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

  const labelColor = dark ? "#e2e8f0" : "#334155";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <path d={arcPath(0, 0.33)} stroke="#ef4444" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.55" />
        <path d={arcPath(0.33, 0.66)} stroke="#eab308" strokeWidth="8" fill="none" opacity="0.55" />
        <path d={arcPath(0.66, 1)} stroke="#22c55e" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.55" />
        {/* needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={q.color} strokeWidth="3" strokeLinecap="round" style={{ transition: "all 0.35s cubic-bezier(0.34,1.56,0.64,1)" }} />
        <circle cx={cx} cy={cy} r="4.5" fill={q.color} />
        <text x={cx} y={cy - r - 1} textAnchor="middle" fontSize="15" fontWeight="900" fill={q.color}>{q.score}</text>
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: dark ? "#94a3b8" : "#64748b" }}>
          Answer quality
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: q.score > 0 ? q.color : labelColor, lineHeight: 1.25 }}>
          {q.label}
        </div>
        {q.fillers > 0 && q.fillerExamples.length > 0 && (
          <div style={{ fontSize: 11, color: dark ? "#cbd5e1" : "#94a3b8", marginTop: 1 }}>
            Trim fillers: {q.fillerExamples.slice(0, 3).map((f) => `“${f}”`).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
