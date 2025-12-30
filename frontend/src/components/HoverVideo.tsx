"use client";

import React, { useEffect, useMemo, useState } from "react";

type HoverVideoProps = {
  primarySrc: string; // e.g. "/videos/station-rotation-single-room.mp4"
  hoverSrc: string;   // e.g. "/videos/station-rotation-multi-room.mp4"

  // Poster images (recommended): e.g. "/images/posters/station-single.png"
  primaryPoster?: string;
  hoverPoster?: string;

  label?: string;

  // Optional: start on hover video (rare)
  defaultToHover?: boolean;

  className?: string; // wrapper className if you want
};

function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setPrefers(!!mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return prefers;
}

export default function HoverVideo({
  primarySrc,
  hoverSrc,
  primaryPoster,
  hoverPoster,
  label,
  defaultToHover = false,
  className = "",
}: HoverVideoProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // "toggled" = mobile tap state
  const [toggled, setToggled] = useState(defaultToHover);

  // "hovered" = desktop hover state
  const [hovered, setHovered] = useState(false);

  // If reduced motion, don’t animate; show primary poster only.
  const isAltActive = useMemo(() => {
    if (prefersReducedMotion) return false;
    return hovered || toggled;
  }, [hovered, toggled, prefersReducedMotion]);

  // For accessibility: allow keyboard toggle
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setToggled((v) => !v);
    }
  };

  return (
    <div
      className={[
        "relative overflow-hidden rounded-3xl border border-gray-200 shadow-2xl bg-white",
        "select-none",
        className,
      ].join(" ")}
      role="button"
      tabIndex={0}
      aria-label="Preview video (tap to toggle)"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setToggled((v) => !v)} // ✅ mobile tap-to-toggle (also works on desktop)
    >
      {/* Primary video */}
      <video
        src={primarySrc}
        poster={primaryPoster}
        autoPlay={!prefersReducedMotion}
        loop
        muted
        playsInline
        preload="metadata"
        className={[
          "w-full h-auto block transition-opacity duration-300",
          isAltActive ? "opacity-0" : "opacity-100",
        ].join(" ")}
      />

      {/* Hover/toggled video */}
      <video
        src={hoverSrc}
        poster={hoverPoster || primaryPoster}
        autoPlay={!prefersReducedMotion}
        loop
        muted
        playsInline
        preload="metadata"
        className={[
          "absolute inset-0 w-full h-auto block transition-opacity duration-300",
          isAltActive ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      {/* Label (optional) */}
      {label && (
        <div className="pointer-events-none absolute top-4 left-4 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
          {label} <span className="opacity-80">(tap)</span>
        </div>
      )}

      {/* Subtle hint bottom-right */}
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/45 px-3 py-1 text-[11px] font-extrabold text-white">
        Tap to switch
      </div>
    </div>
  );
}
