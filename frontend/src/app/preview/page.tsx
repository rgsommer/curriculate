"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./preview.css";

type Station = {
  key: string;
  label: string;
  src: string;
  className: string; // positioning class (s1..s8)
};

const DEFAULT_SECONDS_PER_STATION = 8; // tweak to taste

export default function PreviewPage() {
  const stations: Station[] = useMemo(
    () => [
      { key: "s1", label: "Scan", src: "/preview/station-01-scan.mp4", className: "s1" },
      { key: "s2", label: "MCQ", src: "/preview/station-02-mcq.mp4", className: "s2" },
      { key: "s3", label: "Make & Snap", src: "/preview/station-03-make-snap.mp4", className: "s3" },
      { key: "s4", label: "MadDash", src: "/preview/station-04-maddash.mp4", className: "s4" },
      { key: "s5", label: "Word/Brain", src: "/preview/station-05-word-brain.mp4", className: "s5" },
      { key: "s6", label: "Venn/Sort", src: "/preview/station-06-venn-sort.mp4", className: "s6" },
      { key: "s7", label: "Physical", src: "/preview/station-07-physical-choice.mp4", className: "s7" },
      { key: "s8", label: "Feedback", src: "/preview/station-08-feedback.mp4", className: "s8" },
    ],
    []
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const goNext = () => setActiveIdx((i) => (i + 1) % stations.length);
  const goPrev = () => setActiveIdx((i) => (i - 1 + stations.length) % stations.length);

  // Keyboard stepping (optional but handy)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === " ") setIsPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevIdxRef = useRef<number>(-1);

  useEffect(() => {
    const stage = document.querySelector(".stage");
    if (!stage) return;

    const videos = stage.querySelectorAll<HTMLVideoElement>("video.station");

    videos.forEach((video, idx) => {
      video.muted = true;
      video.playsInline = true;

      const isActive = idx === activeIdx;

      if (isActive && !isPaused) {
        // Only restart when the station actually changes
        if (prevIdxRef.current !== activeIdx) {
          try { video.currentTime = 0; } catch {}
        }
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    prevIdxRef.current = activeIdx;
  }, [activeIdx, isPaused]);

  // Auto-advance 1→8→1 continuously
  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (isPaused) return;

    timerRef.current = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % stations.length);
    }, DEFAULT_SECONDS_PER_STATION * 1000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isPaused, stations.length]);

  return (
    <main className="preview-root">
      <div className="stage">
        <img
          src="/preview/stage.jpg"
          alt="Curriculate classroom preview stage"
          className="preview-stage"
        />

        {stations.map((st, idx) => {
          const isActive = idx === activeIdx;
          return (
            <video
              key={st.key}
              className={`station ${st.className} ${isActive ? "active" : "inactive"}`}
              src={st.src}
              muted
              playsInline
              preload="auto"
              onClick={() => setActiveIdx(idx)}
            />
          );
        })}

        {/* ON-STAGE ARROWS */}
        <button className="navArrow left" onClick={goPrev} aria-label="Previous station">
          <img src="/preview/ui/arrow.png" alt="Back" />
        </button>

        <button className="navArrow right" onClick={goNext} aria-label="Next station">
          <img src="/preview/ui/arrow.png" alt="Next" />
        </button>
      </div>
    </main>
  );
}
