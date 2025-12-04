import React, { useEffect, useRef, useState } from "react";
import Lottie from "lottie-react";

/**
 * VictoryScreen
 *
 * - Shows a full-screen celebratory animation.
 * - Randomly selects from multiple animations & sounds.
 * - Plays a matching victory sound (best-effort; may be blocked
 *   by browser until user has interacted with the page).
 *
 * Props:
 *   onClose?: () => void     // called when overlay is clicked
 *   variant?: "random" | "celebration" | "fireworks" | "confetti"
 */

const VARIANTS = [
  {
    key: "celebration",
    animationPath: "/animations/celebration.json",
    soundPath: "/sounds/victory1.mp3",
  },
  {
    key: "fireworks",
    animationPath: "/animations/fireworks.json",
    soundPath: "/sounds/victory2.mp3",
  },
  {
    key: "confetti",
    animationPath: "/animations/confetti.json",
    soundPath: "/sounds/victory3.mp3",
  },
];

function pickVariant(preferredKey) {
  if (preferredKey && preferredKey !== "random") {
    const match = VARIANTS.find((v) => v.key === preferredKey);
    if (match) return match;
  }
  // default: random
  const idx = Math.floor(Math.random() * VARIANTS.length);
  return VARIANTS[idx];
}

function VictoryScreen({ onClose, variant = "random" }) {
  const [animationData, setAnimationData] = useState(null);
  const [variantKey, setVariantKey] = useState(null);
  const audioRef = useRef(null);

  // Load animation JSON from /public/animations via fetch
  useEffect(() => {
    const chosen = pickVariant(variant);
    setVariantKey(chosen.key);

    let cancelled = false;

    async function loadAnimation() {
      try {
        const res = await fetch(chosen.animationPath);
        if (!res.ok) throw new Error("Failed to load animation");
        const json = await res.json();
        if (!cancelled) {
          setAnimationData(json);
        }
      } catch (err) {
        console.error("VictoryScreen: animation load error:", err);
      }
    }

    loadAnimation();

    // Prepare and play sound (best-effort)
    try {
      const audio = new Audio(chosen.soundPath);
      audioRef.current = audio;
      // Try to play; may fail if user hasn't interacted with the page yet
      audio
        .play()
        .catch(() => {
          // Silently ignore autoplay block
        });
    } catch (err) {
      console.error("VictoryScreen: audio init error:", err);
    }

    return () => {
      cancelled = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
    };
  }, [variant]);

  const handleClose = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (onClose) onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        color: "white",
        textAlign: "center",
        padding: 20,
      }}
      onClick={handleClose}
    >
      {animationData ? (
        <Lottie
          animationData={animationData}
          style={{ width: "80%", maxWidth: 400 }}
          loop={false}
        />
      ) : (
        <div
          style={{
            width: "80%",
            maxWidth: 400,
            height: 200,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.9rem",
            opacity: 0.9,
          }}
        >
          Loading celebration…
        </div>
      )}

      <h1 style={{ fontSize: "2.2rem", margin: "20px 0 8px" }}>
        Victory!
      </h1>
      <p style={{ fontSize: "1.1rem", margin: 0 }}>
        {variantKey === "fireworks"
          ? "You lit up the sky. Tap to continue."
          : variantKey === "confetti"
          ? "Showers of confetti! Tap to continue."
          : "Great job! Tap to continue."}
      </p>
    </div>
  );
}

export default VictoryScreen;
