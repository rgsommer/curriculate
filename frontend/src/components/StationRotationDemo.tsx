"use client";

import { useEffect, useState } from "react";

type Props = {
  className?: string;
  /** Optional override labels */
  labelSingle?: string;
  labelMulti?: string;
};

/**
 * Marketing demo: one video frame that crossfades between single-room and multi-room rotation.
 * - Hover swaps on desktop
 * - Tap swaps on touch devices
 */
export default function StationRotationDemo({
  className = "",
  labelSingle = "Single-classroom stations",
  labelMulti = "Multi-room & hallway mode",
}: Props) {
  const [showMulti, setShowMulti] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // Basic touch detection so mobile users can tap to toggle.
    setIsTouch(typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0));
  }, []);

  return (
    <div
      className={`relative w-full max-w-4xl mx-auto rounded-3xl overflow-hidden shadow-2xl border border-gray-200 bg-black ${className}`}
      onMouseEnter={() => !isTouch && setShowMulti(true)}
      onMouseLeave={() => !isTouch && setShowMulti(false)}
      onClick={() => isTouch && setShowMulti((v) => !v)}
      role={isTouch ? "button" : undefined}
      aria-label={isTouch ? "Toggle multi-room demo" : undefined}
    >
      {/* Single-room */}
      <video
        src="/videos/station-rotation-single-room.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          showMulti ? "opacity-0" : "opacity-100"
        }`}
      />

      {/* Multi-room */}
      <video
        src="/videos/station-rotation-multi-room.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          showMulti ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Aspect ratio wrapper (16:9-ish). Keeps layout stable before video paints. */}
      <div className="pt-[56.25%]" />

      {/* Caption pill */}
      <div className="absolute bottom-3 left-3 bg-black/60 text-white text-sm px-3 py-1 rounded-full backdrop-blur">
        {showMulti ? labelMulti : labelSingle}
      </div>

      {/* Hint */}
      <div className="absolute bottom-3 right-3 bg-white/80 text-gray-900 text-xs px-3 py-1 rounded-full backdrop-blur border border-white/60">
        {isTouch ? "Tap to switch" : "Hover to switch"}
      </div>
    </div>
  );
}
