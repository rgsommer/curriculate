import React, { useState, useEffect, useRef, useMemo } from "react";

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

        {/* Pet character */}
        <div style={{
          ...S.petCharacter,
          transform: `scale(${petScale})`,
          animation:
            lastResult === "good" ? "petBounce 0.6s ease" :
            lastResult === "bad" ? "petGag 0.5s ease" :
            celebration ? "petDance 0.8s ease infinite" :
            "petIdle 3s ease-in-out infinite",
        }}>
          <div style={S.petEmoji}>{animal.emoji}</div>
          <div style={S.petExpression}>{expression}</div>
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
