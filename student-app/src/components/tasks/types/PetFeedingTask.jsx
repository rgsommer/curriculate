import React, { useState, useEffect, useRef, useMemo } from "react";

/**
 * AnimatedPet — SVG-based pet character with state-driven animations.
 * Replaces the giant-emoji placeholder.  Same component renders for
 * every animal type; we just tint it and swap a couple of accent
 * shapes (ear style, tail shape) so dogs feel different from cats
 * and dragons.
 *
 * State-driven animations (CSS keyframes injected once below):
 *   idle          → gentle body bob + tail sway + slow blink
 *   eatingGood    → chew jaw + tail wag fast + body bounce
 *   eatingBad     → frown + body slump shake + ears droop
 *   celebrating   → big bounce + spin tail
 *   sick          → green tint + slumped posture
 */
const PET_PALETTES = {
  // [body, ears, tummy, accent]
  dog:        ["#c98549", "#a0683a", "#f4d8b3", "#3b1f0e"],
  cat:        ["#9aa3ac", "#6b757d", "#dde2e7", "#1f2937"],
  bunny:      ["#fafafa", "#f4f4f5", "#fde2e4", "#1f2937"],
  cow:        ["#f8fafc", "#0f172a", "#fde2e4", "#0f172a"],
  pig:        ["#f9a8d4", "#ec4899", "#fde2e4", "#9d174d"],
  chicken:    ["#fde68a", "#fbbf24", "#fff7d6", "#7c2d12"],
  dolphin:    ["#7dd3fc", "#0ea5e9", "#bae6fd", "#0c4a6e"],
  octopus:    ["#c084fc", "#9333ea", "#e9d5ff", "#3b0764"],
  shark:      ["#94a3b8", "#475569", "#cbd5e1", "#0f172a"],
  trex:       ["#84cc16", "#4d7c0f", "#bef264", "#365314"],
  triceratops:["#34d399", "#059669", "#a7f3d0", "#064e3b"],
  raptor:     ["#f59e0b", "#b45309", "#fde68a", "#451a03"],
  dragon:     ["#a855f7", "#6b21a8", "#e9d5ff", "#1e1b4b"],
  unicorn:    ["#fef3c7", "#f9a8d4", "#fce7f3", "#581c87"],
  phoenix:    ["#fb923c", "#dc2626", "#fed7aa", "#7c2d12"],
};
function paletteFor(type) {
  return PET_PALETTES[type] || PET_PALETTES.dog;
}

/**
 * Asset paths for higher-fidelity pet animations.  If a file exists at
 * one of these URLs we'll prefer it over the inline SVG fallback:
 *
 *   /pets/{type}/{mood}.mp4   — short looping video (3–5s, mp4/webm)
 *   /pets/{type}/{mood}.json  — Lottie animation
 *
 * type:  dog | cat | bunny | dragon | unicorn | … (whatever animal.type is)
 * mood:  idle | eatingGood | eatingBad | celebrating | sick
 *
 * Drop new files into frontend/public/pets/<type>/ and they take effect
 * automatically — no code changes needed.  Until those assets exist the
 * inline SVG keeps the task playable.
 */
const PET_ASSET_PROBE_CACHE = new Map();
function probeAsset(url) {
  if (PET_ASSET_PROBE_CACHE.has(url)) return PET_ASSET_PROBE_CACHE.get(url);
  const p = fetch(url, { method: "HEAD" })
    .then((r) => (r.ok ? url : null))
    .catch(() => null);
  PET_ASSET_PROBE_CACHE.set(url, p);
  return p;
}

function PetVideo({ src }) {
  return (
    <video
      key={src}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        borderRadius: 12,
      }}
    />
  );
}

/**
 * PetVideoSegment — plays a single all.mp4 file but only loops the
 * segment matching the current mood.  Lets you ship ONE video per pet
 * (15 files) instead of five (75 files).
 *
 * Default segment map assumes the user's all.mp4 has 5 moods at
 * 5-second intervals (25s total — matches the new combined-clip
 * Runway prompt):
 *
 *    0–5s   idle
 *    5–10s  eatingBad
 *   10–15s  eatingGood
 *   15–20s  celebrating
 *   20–25s  sick
 *
 * If /pets/<type>/all.json exists with a custom map, that overrides
 * the defaults — drop one in next to a 10s-per-mood (50s total) clip,
 * a 2s-per-mood (10s) clip, or any other layout.  Shape:
 *   { "idle": [0, 5], "eatingBad": [5, 10], … }
 */
const DEFAULT_MOOD_SEGMENTS = {
  idle:        [0,   5],
  eatingBad:   [5,  10],
  eatingGood:  [10, 15],
  celebrating: [15, 20],
  sick:        [20, 25],
};
function PetVideoSegment({ src, mood, segments }) {
  const videoRef = useRef(null);
  const seg = (segments && segments[mood]) || DEFAULT_MOOD_SEGMENTS[mood] || [0, 2];
  const [start, end] = seg;

  // On mood change → seek to segment start and play.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      try {
        v.currentTime = Math.max(0, start);
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    return () => v.removeEventListener("loadedmetadata", seek);
  }, [start, mood, src]);

  // While playing → if we cross the segment end, seek back to start.
  // This is what makes the video "loop just the relevant mood".
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= end - 0.05) {
      try { v.currentTime = start; } catch {}
    }
  };

  return (
    <video
      ref={videoRef}
      src={src}
      // We DON'T set `loop` — we manage looping ourselves via the
      // timeupdate seek above.
      autoPlay
      muted
      playsInline
      preload="auto"
      onTimeUpdate={onTimeUpdate}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        borderRadius: 12,
      }}
    />
  );
}

// Lottie-react is loaded lazily so the bundle stays small until a
// Lottie .json is actually present for some pet+mood combo.
let _LottiePromise = null;
function getLottie() {
  if (!_LottiePromise) {
    _LottiePromise = import("lottie-react").catch(() => null);
  }
  return _LottiePromise;
}
function PetLottie({ src }) {
  const [data, setData] = useState(null);
  const [Lottie, setLottie] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j); })
      .catch(() => {});
    getLottie().then((mod) => {
      if (!cancelled) setLottie(() => mod?.default || null);
    });
    return () => { cancelled = true; };
  }, [src]);
  if (!data || !Lottie) return null;
  return <Lottie animationData={data} loop style={{ width: "100%", height: "100%" }} />;
}

function AnimatedPet({ type, mood, scale = 1 }) {
  // Resolution order (first file that 200s wins):
  //   /pets/<type>/all.mp4         — single 10s video; loop just the
  //                                   segment for the current mood
  //   /pets/<type>/all.json        — segment override map for all.mp4
  //   /pets/<type>/<mood>.mp4      — per-mood looping clip
  //   /pets/<type>/<mood>.json     — per-mood Lottie animation
  //   inline SVG                   — final fallback
  //
  // The all.mp4 path is preferred because shipping ONE 10s clip per
  // pet (15 total) is dramatically less work than shipping five
  // 3s clips per pet (75 total).
  const t = encodeURIComponent(type || "dog");
  const m = encodeURIComponent(mood || "idle");
  const [resolved, setResolved] = useState(null);

  // Probe once per type — independent of mood — so all.mp4 stays put
  // and just the segment range changes when mood changes.
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const allMp4 = await probeAsset(`/pets/${t}/all.mp4`);
      if (cancelled) return;
      if (allMp4) {
        // Optional segment override.
        let segments = null;
        try {
          const allJson = await probeAsset(`/pets/${t}/all.json`);
          if (allJson) {
            const r = await fetch(allJson);
            if (r.ok) segments = await r.json();
          }
        } catch {}
        if (cancelled) return;
        setBundle({ kind: "all-mp4", src: allMp4, segments });
        return;
      }
      setBundle({ kind: "per-mood" });
    })();
    return () => { cancelled = true; };
  }, [t]);

  // For per-mood mode: probe the specific mood file each time mood changes.
  useEffect(() => {
    if (!bundle || bundle.kind !== "per-mood") {
      setResolved(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const mp4 = await probeAsset(`/pets/${t}/${m}.mp4`);
      if (cancelled) return;
      if (mp4) { setResolved({ kind: "video", src: mp4 }); return; }
      const lottie = await probeAsset(`/pets/${t}/${m}.json`);
      if (cancelled) return;
      if (lottie) { setResolved({ kind: "lottie", src: lottie }); return; }
      setResolved({ kind: "svg" });
    })();
    return () => { cancelled = true; };
  }, [bundle, t, m]);

  if (bundle?.kind === "all-mp4") {
    return (
      <div style={{ width: 220 * scale, height: 220 * scale }}>
        <PetVideoSegment src={bundle.src} mood={mood} segments={bundle.segments} />
      </div>
    );
  }
  if (resolved?.kind === "video") {
    return (
      <div style={{ width: 220 * scale, height: 220 * scale }}>
        <PetVideo src={resolved.src} />
      </div>
    );
  }
  if (resolved?.kind === "lottie") {
    return (
      <div style={{ width: 220 * scale, height: 220 * scale }}>
        <PetLottie src={resolved.src} />
      </div>
    );
  }
  return <PetSvg type={type} mood={mood} scale={scale} />;
}

function PetSvg({ type, mood, scale = 1 }) {
  const [body, ears, tummy, accent] = paletteFor(type);
  // Ear / tail / horn variants by type — keeps generic shape but
  // visually distinguishes the families.
  const isFloppy = ["dog", "bunny", "pig"].includes(type);
  const isPointy = ["cat", "shark", "raptor", "dragon"].includes(type);
  const hasHorn  = ["unicorn"].includes(type);
  const hasFin   = ["dolphin", "shark"].includes(type);
  const hasSpike = ["dragon", "trex", "triceratops"].includes(type);

  // Map mood → CSS animation name on the whole body group.
  const bodyAnim = ({
    idle:        "petIdle 3.2s ease-in-out infinite",
    eatingGood:  "petBounce 0.9s cubic-bezier(.2,.7,.2,1.6) infinite",
    eatingBad:   "petGag 0.55s ease",
    celebrating: "petDance 0.7s ease infinite",
    sick:        "petSlump 1.6s ease-in-out infinite",
  }[mood]) || "petIdle 3.2s ease-in-out infinite";

  // Mouth state
  const isChewing = mood === "eatingGood" || mood === "celebrating";
  const isFrowning = mood === "eatingBad" || mood === "sick";

  // Eye state — sad eyes when sick, sparkle eyes when celebrating,
  // happy crescents when eating good.
  const eyeShape =
    mood === "celebrating" ? "sparkle" :
    mood === "eatingGood"  ? "happy" :
    mood === "eatingBad" || mood === "sick" ? "sad" :
    "open";

  return (
    <div
      style={{
        width: 220 * scale,
        height: 220 * scale,
        position: "relative",
        filter: mood === "sick" ? "saturate(0.45) hue-rotate(40deg)" : "none",
        transition: "filter 0.4s ease",
      }}
      aria-label="Animated pet"
    >
      <svg viewBox="0 0 220 220" width="100%" height="100%">
        {/* Ground shadow */}
        <ellipse cx="110" cy="200" rx="58" ry="8" fill="rgba(0,0,0,0.18)">
          <animate
            attributeName="rx"
            values="58;48;58"
            dur="3.2s"
            repeatCount="indefinite"
          />
        </ellipse>

        {/* Whole pet — animated as a unit */}
        <g style={{ animation: bodyAnim, transformOrigin: "110px 180px" }}>
          {/* Tail */}
          <g style={{ transformOrigin: "70px 130px" }}>
            <g
              style={{
                animation:
                  mood === "eatingGood" || mood === "celebrating"
                    ? "tailWag 0.18s ease-in-out infinite"
                    : "tailSway 2.4s ease-in-out infinite",
                transformOrigin: "70px 130px",
              }}
            >
              {isFloppy ? (
                // Round wagging tail
                <path
                  d="M62 130 Q 38 100, 50 80"
                  stroke={ears}
                  strokeWidth="14"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : isPointy ? (
                // Long pointy tail
                <path
                  d="M62 130 Q 30 120, 22 90"
                  stroke={body}
                  strokeWidth="11"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : (
                <ellipse cx="58" cy="120" rx="14" ry="8" fill={ears} />
              )}
            </g>
          </g>

          {/* Body */}
          <ellipse cx="110" cy="155" rx="60" ry="42" fill={body} />
          {/* Tummy */}
          <ellipse cx="110" cy="170" rx="38" ry="22" fill={tummy} />

          {/* Spikes (dragons / dinos) along the back */}
          {hasSpike && (
            <g fill={accent}>
              <polygon points="80,118 86,108 92,118" />
              <polygon points="98,113 104,101 110,113" />
              <polygon points="116,113 122,101 128,113" />
              <polygon points="134,118 140,108 146,118" />
            </g>
          )}

          {/* Fin (dolphin / shark) */}
          {hasFin && (
            <polygon points="104,115 116,80 128,115" fill={ears} />
          )}

          {/* Front legs */}
          <ellipse cx="92"  cy="192" rx="10" ry="8" fill={ears} />
          <ellipse cx="128" cy="192" rx="10" ry="8" fill={ears} />

          {/* Head */}
          <circle cx="110" cy="100" r="42" fill={body} />
          <ellipse cx="110" cy="115" rx="22" ry="14" fill={tummy} />

          {/* Ears */}
          {isFloppy && (
            <g>
              <ellipse cx="80" cy="80"
                rx="14" ry="22" fill={ears}
                style={{
                  transformOrigin: "80px 70px",
                  animation: mood === "eatingBad" || mood === "sick"
                    ? "earDroop 0.4s ease forwards"
                    : "earSway 2.6s ease-in-out infinite",
                }}
              />
              <ellipse cx="140" cy="80"
                rx="14" ry="22" fill={ears}
                style={{
                  transformOrigin: "140px 70px",
                  animation: mood === "eatingBad" || mood === "sick"
                    ? "earDroop 0.4s ease forwards"
                    : "earSwayR 2.6s ease-in-out infinite",
                }}
              />
            </g>
          )}
          {isPointy && (
            <g fill={ears}>
              <polygon points="78,72 90,40 96,76" />
              <polygon points="142,72 130,40 124,76" />
            </g>
          )}
          {hasHorn && (
            // Unicorn horn
            <polygon points="106,52 110,18 114,52" fill="#fcd34d" stroke="#a16207" strokeWidth="1" />
          )}

          {/* Eyes */}
          {eyeShape === "open" && (
            <g fill={accent}>
              <circle cx="95"  cy="98" r="5">
                <animate attributeName="ry" values="5;5;0.5;5;5" dur="4.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="125" cy="98" r="5">
                <animate attributeName="ry" values="5;5;0.5;5;5" dur="4.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="96"  cy="96" r="1.5" fill="#fff" />
              <circle cx="126" cy="96" r="1.5" fill="#fff" />
            </g>
          )}
          {eyeShape === "happy" && (
            <g stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round">
              <path d="M88 100 Q 95 90, 102 100" />
              <path d="M118 100 Q 125 90, 132 100" />
            </g>
          )}
          {eyeShape === "sad" && (
            <g stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round">
              <path d="M88 96 Q 95 104, 102 96" />
              <path d="M118 96 Q 125 104, 132 96" />
            </g>
          )}
          {eyeShape === "sparkle" && (
            <g>
              <text x="88" y="105" fontSize="18">✨</text>
              <text x="118" y="105" fontSize="18">✨</text>
            </g>
          )}

          {/* Cheeks (only when happy) */}
          {(mood === "eatingGood" || mood === "celebrating") && (
            <g fill="rgba(244,63,94,0.45)">
              <circle cx="82"  cy="115" r="6" />
              <circle cx="138" cy="115" r="6" />
            </g>
          )}

          {/* Mouth */}
          {isFrowning ? (
            <path
              d="M96 128 Q 110 116, 124 128"
              stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round"
            />
          ) : isChewing ? (
            <ellipse cx="110" cy="124" rx="11" ry="7" fill={accent}>
              <animate attributeName="ry" values="3;9;3" dur="0.34s" repeatCount="indefinite" />
              <animate attributeName="rx" values="13;9;13" dur="0.34s" repeatCount="indefinite" />
            </ellipse>
          ) : (
            <path
              d="M96 124 Q 110 134, 124 124"
              stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round"
            />
          )}

          {/* Tongue (shows during good chew) */}
          {isChewing && (
            <ellipse cx="110" cy="130" rx="6" ry="3" fill="#f87171">
              <animate attributeName="cy" values="129;132;129" dur="0.34s" repeatCount="indefinite" />
            </ellipse>
          )}
        </g>
      </svg>
    </div>
  );
}

/**
 * PetFeedingTask — showstopper edition.
 *
 * Students tap food cards to feed their pet. Good foods grow the pet and
 * score points; bad foods make the pet sick and shake the screen. The pet
 * visually reacts to every feed, grows bigger with each success, and a
 * full celebration explodes when the goal is reached.
 *
 * Mobile-first (tap), drag also works on desktop.
 */

const ANIMAL_PACKS = {
  classic: {
    name: "Classic Pets",
    animals: [
      { type: "dog", emoji: "🐶", name: "Buddy the Dog" },
      { type: "cat", emoji: "🐱", name: "Whiskers" },
      { type: "bunny", emoji: "🐰", name: "Flopsy" },
    ],
  },
  farm: {
    name: "Farm Friends",
    animals: [
      { type: "cow", emoji: "🐮", name: "Daisy" },
      { type: "pig", emoji: "🐷", name: "Hamlet" },
      { type: "chicken", emoji: "🐔", name: "Nugget" },
    ],
  },
  ocean: {
    name: "Sea Creatures",
    animals: [
      { type: "dolphin", emoji: "🐬", name: "Splash" },
      { type: "octopus", emoji: "🐙", name: "Inky" },
      { type: "shark", emoji: "🦈", name: "Finn" },
    ],
  },
  dino: {
    name: "DINOSAURS!",
    animals: [
      { type: "trex", emoji: "🦖", name: "Rex" },
      { type: "triceratops", emoji: "🦕", name: "Trixie" },
      { type: "raptor", emoji: "🦤", name: "Veloci" },
    ],
  },
  fantasy: {
    name: "Mythical Beasts",
    animals: [
      { type: "dragon", emoji: "🐉", name: "Ember" },
      { type: "unicorn", emoji: "🦄", name: "Sparkle" },
      { type: "phoenix", emoji: "🦅", name: "Blaze" },
    ],
  },
};

const FOOD_EMOJIS = ["🍖", "🥕", "🍪", "🍗", "🐟", "🍎", "🥦", "🍩", "🧀", "🍕", "🥩", "🍌", "🥚", "🍯", "🌽", "🍓"];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function PetFeedingTask({ task, onSubmit, disabled }) {
  const safeTask = task || {};
  const packKey = safeTask.pack || safeTask?.config?.pack || "classic";
  const pack = ANIMAL_PACKS[packKey] || ANIMAL_PACKS.classic;

  const [animal] = useState(() => pickRandom(pack.animals));
  const [fedCount, setFedCount] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [lastResult, setLastResult] = useState(null); // "good" | "bad" | null
  const [submitted, setSubmitted] = useState(false);
  const [selectedId, setSelectedId] = useState(null); // tap-to-feed selection
  const [shakeScreen, setShakeScreen] = useState(false);
  const [sparkles, setSparkles] = useState([]); // floating sparkle particles
  const [petScale, setPetScale] = useState(1.0);
  const [celebration, setCelebration] = useState(false);
  const hasSubmittedRef = useRef(false);
  const containerRef = useRef(null);

  const goal = Number(safeTask?.config?.goal || safeTask.goal || 4) || 4;
  const maxMistakes = Number(safeTask?.config?.maxMistakes || safeTask.maxMistakes || 3) || 3;

  // ─── Normalize food items ───
  const initialFoodItems = useMemo(() => {
    const cfg = safeTask.config || {};
    const fromArray =
      (Array.isArray(cfg.foodItems) && cfg.foodItems) ||
      (Array.isArray(safeTask.foodItems) && safeTask.foodItems) ||
      (Array.isArray(safeTask.items) && safeTask.items) ||
      null;

    const goodFoods = Array.isArray(cfg.goodFoods) ? cfg.goodFoods :
      Array.isArray(safeTask.goodFoods) ? safeTask.goodFoods : null;
    const badFoods = Array.isArray(cfg.badFoods) ? cfg.badFoods :
      Array.isArray(safeTask.badFoods) ? safeTask.badFoods : null;

    if (fromArray && fromArray.length) {
      return fromArray.map((x, idx) => {
        if (typeof x === "string") return { id: `i_${idx}`, label: x, good: null, emoji: FOOD_EMOJIS[idx % FOOD_EMOJIS.length] };
        const label = String(x?.label || x?.word || x?.text || x?.name || `Item ${idx + 1}`).trim();
        const good = typeof x?.good === "boolean" ? x.good : typeof x?.isGood === "boolean" ? x.isGood : null;
        return { id: String(x?.id || `i_${idx}`), label, good, emoji: x?.emoji || FOOD_EMOJIS[idx % FOOD_EMOJIS.length] };
      }).filter((x) => x.label);
    }

    if ((goodFoods?.length) || (badFoods?.length)) {
      const items = [];
      const push = (arr, goodFlag, prefix) =>
        (arr || []).forEach((w, i) => {
          const label = String(w || "").trim();
          if (!label) return;
          items.push({ id: `${prefix}_${i}`, label, good: goodFlag, emoji: FOOD_EMOJIS[items.length % FOOD_EMOJIS.length] });
        });
      push(goodFoods, true, "g");
      push(badFoods, false, "b");
      // Shuffle
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items.slice(0, 16);
    }

    // Default set
    return [
      { id: "g1", label: "Fresh carrots", good: true, emoji: "🥕" },
      { id: "g2", label: "Clean water", good: true, emoji: "💧" },
      { id: "g3", label: "Healthy kibble", good: true, emoji: "🦴" },
      { id: "g4", label: "Fish fillet", good: true, emoji: "🐟" },
      { id: "g5", label: "Apple slices", good: true, emoji: "🍎" },
      { id: "b1", label: "Chocolate bar", good: false, emoji: "🍫" },
      { id: "b2", label: "Soda pop", good: false, emoji: "🥤" },
      { id: "b3", label: "Old leftovers", good: false, emoji: "🗑️" },
      { id: "b4", label: "Spoiled milk", good: false, emoji: "🥛" },
      { id: "b5", label: "Spicy peppers", good: false, emoji: "🌶️" },
      { id: "n1", label: "Mystery snack", good: null, emoji: "❓" },
      { id: "n2", label: "Crunchy treat", good: null, emoji: "🍪" },
    ];
  }, [safeTask?.id, safeTask?._id, packKey]);

  const [foodItems, setFoodItems] = useState(initialFoodItems);

  useEffect(() => { setFoodItems(initialFoodItems); }, [initialFoodItems]);

  // ─── Evaluate goodness ───
  const evaluateGoodness = (item) => {
    if (typeof item.good === "boolean") return item.good;
    const t = String(item.label || "").toLowerCase();
    const bad = ["chocolate", "soda", "spoiled", "old", "mold", "rotten", "poison", "glass", "soap", "candy", "spicy", "pepper"];
    const good = ["water", "fresh", "healthy", "kibble", "carrot", "fish", "apple", "grain", "hay", "lettuce", "berries", "clean"];
    if (bad.some((h) => t.includes(h))) return false;
    if (good.some((h) => t.includes(h))) return true;
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash + t.charCodeAt(i) * (i + 1)) % 997;
    return hash % 10 >= 5;
  };

  // ─── Spawn sparkle particles ───
  const spawnSparkles = (count = 8) => {
    const newSparkles = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      x: 40 + Math.random() * 20,
      y: 30 + Math.random() * 10,
      emoji: pickRandom(["✨", "⭐", "💫", "🌟", "💖", "🎉"]),
      dx: (Math.random() - 0.5) * 60,
      dy: -(Math.random() * 40 + 20),
    }));
    setSparkles((prev) => [...prev, ...newSparkles]);
    setTimeout(() => {
      setSparkles((prev) => prev.filter((s) => !newSparkles.find((n) => n.id === s.id)));
    }, 1200);
  };

  // ─── Feed the pet ───
  const feedPet = (item) => {
    if (disabled || submitted || !item) return;

    const good = evaluateGoodness(item);
    const nextFed = good ? fedCount + 1 : fedCount;
    const nextMistakes = good ? mistakes : mistakes + 1;

    setFedCount(nextFed);
    setMistakes(nextMistakes);
    setLastResult(good ? "good" : "bad");
    setSelectedId(null);

    // Remove the food card
    setFoodItems((prev) => prev.filter((x) => x.id !== item.id));

    if (good) {
      // Growth + sparkles
      setPetScale((s) => Math.min(s + 0.08, 1.6));
      spawnSparkles(10);
      try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
    } else {
      // Screen shake
      setShakeScreen(true);
      setTimeout(() => setShakeScreen(false), 500);
      try { new Audio("/sounds/buzz.mp3").play().catch(() => {}); } catch {}
    }

    // Clear result flash after a moment
    setTimeout(() => setLastResult(null), 1500);

    // Check win/loss
    if (nextFed >= goal) {
      setCelebration(true);
      spawnSparkles(25);
      try { new Audio("/sounds/victory.mp3").play().catch(() => {}); } catch {}
    }

    // Submit
    if ((nextFed >= goal || nextMistakes >= maxMistakes) && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      setSubmitted(true);
      setTimeout(() => {
        onSubmit?.({
          type: safeTask.taskType || safeTask.type || "pet-feeding",
          taskType: "pet-feeding",
          completed: true,
          pack: packKey,
          animal: animal?.type || null,
          goal,
          fedCount: nextFed,
          mistakes: nextMistakes,
          success: nextFed >= goal,
          pointsEarned: nextFed * 25 + (nextFed >= goal ? 50 : 0),
          teamPointsEarned: nextFed * 25 + (nextFed >= goal ? 50 : 0),
        });
      }, 1500);
    }
  };

  // ─── Tap-to-feed: tap card to select, tap pet/bowl area to feed ───
  const handleCardTap = (item) => {
    if (disabled || submitted) return;
    if (selectedId === item.id) {
      // Double-tap = feed immediately
      feedPet(item);
    } else {
      setSelectedId(item.id);
    }
  };

  const handlePetAreaTap = () => {
    if (disabled || submitted || !selectedId) return;
    const item = foodItems.find((x) => x.id === selectedId);
    if (item) feedPet(item);
  };

  // ─── Drag support ───
  const handleDragStart = (e, item) => {
    if (disabled || submitted) return;
    setSelectedId(item.id);
    e.dataTransfer.setData("text/plain", item.id);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled || submitted) return;
    const id = e.dataTransfer.getData("text/plain");
    const item = foodItems.find((x) => x.id === id);
    if (item) feedPet(item);
  };

  // ─── Pet expression ───
  const expression = (() => {
    if (celebration) return "🥳";
    if (mistakes >= maxMistakes) return "🤢";
    if (lastResult === "bad") return "😖";
    if (lastResult === "good") return "😋";
    if (fedCount > 0) return "😊";
    return "🤤"; // hungry
  })();

  const petMessage = (() => {
    if (celebration) return "YUMMY! I'M SO FULL AND HAPPY!";
    if (mistakes >= maxMistakes) return "Urghh... my tummy hurts...";
    if (lastResult === "bad") return "BLEH! That was GROSS!";
    if (lastResult === "good") return "MMMM! MORE MORE MORE!";
    if (fedCount > 0) return "That was delicious! Got more?";
    return `I'm SO hungry! Feed me, please!`;
  })();

  const fullnessPct = Math.min(100, Math.round((fedCount / goal) * 100));
  const dangerPct = Math.min(100, Math.round((mistakes / maxMistakes) * 100));
  const gameOver = submitted || fedCount >= goal || mistakes >= maxMistakes;

  return (
    <div
      ref={containerRef}
      style={{
        ...S.page,
        animation: shakeScreen ? "screenShake 0.5s ease" : "none",
      }}
    >
      {/* Header */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.titleEmoji}>🐾</span>
          <h2 style={S.title}>FEED THE PET!</h2>
        </div>
        <div style={S.packBadge}>{pack.name}</div>
      </div>

      {/* Status bars */}
      <div style={S.statusRow}>
        <div style={S.statusBar}>
          <div style={S.statusLabel}>
            <span>😋 Fullness</span>
            <span style={S.statusNum}>{fedCount}/{goal}</span>
          </div>
          <div style={S.barTrack}>
            <div style={{
              ...S.barFill,
              width: `${fullnessPct}%`,
              background: "linear-gradient(90deg, #22c55e, #16a34a)",
              boxShadow: fullnessPct > 50 ? "0 0 12px rgba(34,197,94,0.5)" : "none",
            }} />
          </div>
        </div>
        <div style={S.statusBar}>
          <div style={S.statusLabel}>
            <span>🤢 Yuck Meter</span>
            <span style={{ ...S.statusNum, color: dangerPct >= 66 ? "#dc2626" : "#64748b" }}>{mistakes}/{maxMistakes}</span>
          </div>
          <div style={S.barTrack}>
            <div style={{
              ...S.barFill,
              width: `${dangerPct}%`,
              background: dangerPct >= 66 ? "linear-gradient(90deg, #f59e0b, #dc2626)" : "linear-gradient(90deg, #fbbf24, #f59e0b)",
              boxShadow: dangerPct >= 66 ? "0 0 12px rgba(220,38,38,0.4)" : "none",
            }} />
          </div>
        </div>
      </div>

      {/* Pet area — tappable to feed selected card */}
      <div
        style={S.petArea}
        onClick={handlePetAreaTap}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Sparkle particles */}
        {sparkles.map((s) => (
          <div
            key={s.id}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${s.y}%`,
              fontSize: 24,
              pointerEvents: "none",
              animation: "sparkleFloat 1.2s ease-out forwards",
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              zIndex: 10,
            }}
          >
            {s.emoji}
          </div>
        ))}

        {/* Pet character — proper animated SVG (was a giant emoji). */}
        <div
          style={{
            ...S.petCharacter,
            transform: `scale(${petScale})`,
          }}
        >
          <AnimatedPet
            type={animal?.type || "dog"}
            mood={
              celebration              ? "celebrating" :
              mistakes >= maxMistakes  ? "sick" :
              lastResult === "good"    ? "eatingGood" :
              lastResult === "bad"     ? "eatingBad" :
                                         "idle"
            }
            scale={1}
          />
        </div>

        {/* Pet name + message */}
        <div style={S.petName}>{animal.name}</div>
        <div style={{
          ...S.petMessage,
          color: lastResult === "bad" ? "#dc2626" : lastResult === "good" ? "#16a34a" : "#475569",
          fontWeight: lastResult ? 900 : 700,
        }}>
          {petMessage}
        </div>

        {/* Bowl */}
        <div style={S.bowl}>
          <div style={S.bowlInner}>
            {selectedId && !gameOver && (
              <div style={S.bowlHint}>
                Tap here to feed!
              </div>
            )}
            {!selectedId && !gameOver && (
              <div style={S.bowlHintDim}>
                Pick a food below
              </div>
            )}
          </div>
          <div style={S.bowlShadow} />
        </div>
      </div>

      {/* Result flash */}
      {lastResult && (
        <div style={{
          ...S.resultFlash,
          background: lastResult === "good" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
          borderColor: lastResult === "good" ? "#22c55e" : "#ef4444",
          color: lastResult === "good" ? "#15803d" : "#dc2626",
        }}>
          {lastResult === "good" ? "✅ Great choice! The pet loves it!" : "❌ Yuck! That made the pet sick!"}
        </div>
      )}

      {/* Celebration overlay */}
      {celebration && (
        <div style={S.celebrationOverlay}>
          <div style={S.celebrationText}>🎉 GOAL REACHED! 🎉</div>
          <div style={S.celebrationSub}>{animal.name} is full and happy!</div>
        </div>
      )}

      {/* Game over (failure) */}
      {mistakes >= maxMistakes && !celebration && (
        <div style={S.failOverlay}>
          <div style={S.failText}>💔 Too many yucky foods!</div>
          <div style={S.failSub}>{animal.name} has a tummy ache...</div>
        </div>
      )}

      {/* Food cards grid */}
      {!gameOver && (
        <>
          <div style={S.foodHeader}>
            {selectedId
              ? "Now tap the pet area above to feed it! (or tap another card to switch)"
              : "Tap a food card to select it, then tap the pet to feed!"}
          </div>
          <div style={S.foodGrid}>
            {foodItems.map((item) => {
              const isSelected = selectedId === item.id;
              return (
                <div
                  key={item.id}
                  draggable={!disabled && !submitted}
                  onDragStart={(e) => handleDragStart(e, item)}
                  onClick={() => handleCardTap(item)}
                  style={{
                    ...S.foodCard,
                    borderColor: isSelected ? "#6366f1" : "rgba(226,232,240,1)",
                    background: isSelected
                      ? "linear-gradient(135deg, #eef2ff, #e0e7ff)"
                      : "linear-gradient(135deg, #ffffff, #f8fafc)",
                    transform: isSelected ? "scale(1.05)" : "scale(1)",
                    boxShadow: isSelected
                      ? "0 8px 24px rgba(99,102,241,0.3)"
                      : "0 4px 12px rgba(0,0,0,0.06)",
                  }}
                >
                  <div style={S.foodEmoji}>{item.emoji}</div>
                  <div style={S.foodLabel}>{item.label}</div>
                  {isSelected && <div style={S.selectedBadge}>SELECTED</div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes petIdle {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        @keyframes petBounce {
          0% { transform: scale(1) translateY(0); }
          30% { transform: scale(1.15) translateY(-18px); }
          50% { transform: scale(0.95) translateY(0); }
          70% { transform: scale(1.05) translateY(-8px); }
          100% { transform: scale(1) translateY(0); }
        }
        @keyframes petGag {
          0% { transform: translateX(0) rotate(0); }
          20% { transform: translateX(-8px) rotate(-5deg); }
          40% { transform: translateX(8px) rotate(5deg); }
          60% { transform: translateX(-6px) rotate(-3deg); }
          80% { transform: translateX(4px) rotate(2deg); }
          100% { transform: translateX(0) rotate(0); }
        }
        @keyframes petDance {
          0%, 100% { transform: translateY(0) rotate(0); }
          25% { transform: translateY(-10px) rotate(-5deg); }
          75% { transform: translateY(-10px) rotate(5deg); }
        }
        @keyframes screenShake {
          0%, 100% { transform: translateX(0); }
          10% { transform: translateX(-6px); }
          20% { transform: translateX(6px); }
          30% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          50% { transform: translateX(-3px); }
          60% { transform: translateX(3px); }
        }
        @keyframes sparkleFloat {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0.3); opacity: 0; }
        }
        @keyframes celebrationPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes slideUp {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        /* AnimatedPet keyframes */
        @keyframes tailWag {
          0%, 100% { transform: rotate(-25deg); }
          50%      { transform: rotate(25deg); }
        }
        @keyframes tailSway {
          0%, 100% { transform: rotate(-8deg); }
          50%      { transform: rotate(8deg); }
        }
        @keyframes earSway {
          0%, 100% { transform: rotate(-4deg); }
          50%      { transform: rotate(4deg); }
        }
        @keyframes earSwayR {
          0%, 100% { transform: rotate(4deg); }
          50%      { transform: rotate(-4deg); }
        }
        @keyframes earDroop {
          to { transform: rotate(35deg) scaleY(0.8); }
        }
        @keyframes petSlump {
          0%, 100% { transform: translateY(2px) rotate(-2deg); }
          50%      { transform: translateY(6px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───
const S = {
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: "100%",
    padding: "16px 12px 32px",
    background: "radial-gradient(ellipse at 30% 10%, rgba(186,230,253,0.5), transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(187,247,208,0.3), transparent 50%), #f8fafc",
    borderRadius: 18,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    position: "relative",
    overflow: "hidden",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    maxWidth: 560,
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 8,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 8 },
  titleEmoji: { fontSize: 28 },
  title: { fontSize: 24, fontWeight: 900, color: "#1e293b", margin: 0, letterSpacing: -0.5 },
  packBadge: {
    padding: "6px 14px",
    borderRadius: 99,
    background: "white",
    border: "1px solid #e2e8f0",
    fontWeight: 800,
    fontSize: 13,
    color: "#475569",
  },

  // Status bars
  statusRow: {
    display: "flex",
    gap: 12,
    width: "100%",
    maxWidth: 560,
    marginBottom: 12,
  },
  statusBar: { flex: 1 },
  statusLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    fontWeight: 800,
    color: "#475569",
    marginBottom: 4,
  },
  statusNum: { fontWeight: 900, color: "#1e293b" },
  barTrack: {
    height: 10,
    borderRadius: 5,
    background: "#e2e8f0",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 5,
    transition: "width 0.5s ease, background 0.3s ease",
  },

  // Pet area
  petArea: {
    position: "relative",
    width: "100%",
    maxWidth: 560,
    borderRadius: 24,
    background: "linear-gradient(180deg, #ffffff, #f1f5f9)",
    border: "2px solid #e2e8f0",
    boxShadow: "0 12px 32px rgba(0,0,0,0.06)",
    padding: "24px 16px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
    overflow: "hidden",
    marginBottom: 12,
  },
  petCharacter: {
    transition: "transform 0.4s ease",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  petEmoji: {
    fontSize: 96,
    lineHeight: 1,
    filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.15))",
  },
  petExpression: {
    fontSize: 32,
    marginTop: -8,
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
  },
  petName: {
    fontSize: 18,
    fontWeight: 900,
    color: "#1e293b",
    marginTop: 8,
  },
  petMessage: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 4,
    maxWidth: 300,
    lineHeight: 1.4,
    minHeight: 42,
    transition: "color 0.3s ease",
  },

  // Bowl
  bowl: {
    position: "relative",
    width: 160,
    height: 60,
    marginTop: 12,
  },
  bowlInner: {
    position: "absolute",
    inset: 0,
    borderRadius: "0 0 80px 80px",
    background: "linear-gradient(180deg, #cbd5e1, #94a3b8)",
    border: "3px solid #94a3b8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bowlHint: {
    fontSize: 12,
    fontWeight: 800,
    color: "#4f46e5",
    animation: "celebrationPulse 1.5s ease infinite",
  },
  bowlHintDim: {
    fontSize: 11,
    fontWeight: 700,
    color: "#94a3b8",
  },
  bowlShadow: {
    position: "absolute",
    bottom: -6,
    left: 20,
    right: 20,
    height: 12,
    borderRadius: 99,
    background: "rgba(0,0,0,0.08)",
    filter: "blur(6px)",
  },

  // Result flash
  resultFlash: {
    width: "100%",
    maxWidth: 560,
    padding: "10px 16px",
    borderRadius: 14,
    border: "2px solid",
    fontWeight: 800,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 8,
    animation: "slideUp 0.3s ease",
  },

  // Celebration
  celebrationOverlay: {
    width: "100%",
    maxWidth: 560,
    padding: 24,
    borderRadius: 20,
    background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(99,102,241,0.12))",
    border: "2px solid #22c55e",
    textAlign: "center",
    marginBottom: 12,
    animation: "celebrationPulse 1.5s ease infinite",
  },
  celebrationText: {
    fontSize: 28,
    fontWeight: 900,
    color: "#15803d",
  },
  celebrationSub: {
    fontSize: 16,
    color: "#475569",
    marginTop: 4,
    fontWeight: 700,
  },

  // Fail
  failOverlay: {
    width: "100%",
    maxWidth: 560,
    padding: 24,
    borderRadius: 20,
    background: "rgba(239,68,68,0.08)",
    border: "2px solid #ef4444",
    textAlign: "center",
    marginBottom: 12,
  },
  failText: { fontSize: 24, fontWeight: 900, color: "#dc2626" },
  failSub: { fontSize: 15, color: "#64748b", marginTop: 4, fontWeight: 700 },

  // Food cards
  foodHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 10,
    maxWidth: 400,
  },
  foodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 10,
    width: "100%",
    maxWidth: 560,
  },
  foodCard: {
    padding: "12px 10px",
    borderRadius: 16,
    border: "2px solid",
    cursor: "pointer",
    userSelect: "none",
    textAlign: "center",
    transition: "all 0.2s ease",
    position: "relative",
  },
  foodEmoji: { fontSize: 28 },
  foodLabel: {
    fontSize: 13,
    fontWeight: 800,
    color: "#1e293b",
    marginTop: 4,
    lineHeight: 1.3,
  },
  selectedBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    background: "#6366f1",
    color: "white",
    fontSize: 9,
    fontWeight: 900,
    padding: "2px 8px",
    borderRadius: 99,
    letterSpacing: 0.5,
  },
};
