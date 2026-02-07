import React, { useState, useEffect } from "react";

const ANIMAL_PACKS = {
  classic: {
    name: "Classic Pets",
    animals: [
      {
        type: "dog",
        emoji: "🐶",
        name: "Dog",
        hungry: "I'm starving!",
        thanks: "Woof! Thanks!",
      },
      {
        type: "cat",
        emoji: "🐱",
        name: "Cat",
        hungry: "Meow... feed me?",
        thanks: "Purrrfect!",
      },
      {
        type: "bunny",
        emoji: "🐰",
        name: "Bunny",
        hungry: "Nom nom?",
        thanks: "Hop hop happy!",
      },
    ],
  },
  farm: {
    name: "Farm Friends",
    animals: [
      {
        type: "cow",
        emoji: "🐮",
        name: "Cow",
        hungry: "Moo! Grass?",
        thanks: "Moooo!",
      },
      {
        type: "pig",
        emoji: "🐷",
        name: "Pig",
        hungry: "Oink! Slop?",
        thanks: "Oink oink!",
      },
      {
        type: "chicken",
        emoji: "🐔",
        name: "Chicken",
        hungry: "Cluck cluck!",
        thanks: "Bawk bawk!",
      },
    ],
  },
  ocean: {
    name: "Sea Creatures",
    animals: [
      {
        type: "dolphin",
        emoji: "🐬",
        name: "Dolphin",
        hungry: "Eeee! Fish?",
        thanks: "Eeeeee!",
      },
      {
        type: "octopus",
        emoji: "🐙",
        name: "Octopus",
        hungry: "Blub blub!",
        thanks: "🫧",
      },
      {
        type: "shark",
        emoji: "🦈",
        name: "Shark",
        hungry: "Rawr! Meat?",
        thanks: "CHOMP!",
      },
    ],
  },
  dino: {
    name: "DINOSAURS!",
    animals: [
      {
        type: "trex",
        emoji: "🦖",
        name: "T-Rex",
        hungry: "ROOOOAR!",
        thanks: "ROAR!!!",
      },
      {
        type: "triceratops",
        emoji: "🦕",
        name: "Triceratops",
        hungry: "Huff huff!",
        thanks: "Stomp stomp!",
      },
      {
        type: "raptor",
        emoji: "🦤",
        name: "Velociraptor",
        hungry: "Screech!",
        thanks: "Clever girl...",
      },
    ],
  },
  fantasy: {
    name: "Mythical Beasts",
    animals: [
      {
        type: "dragon",
        emoji: "🐉",
        name: "Dragon",
        hungry: "Fire... hungry...",
        thanks: "ROAR! 🔥",
      },
      {
        type: "unicorn",
        emoji: "🦄",
        name: "Unicorn",
        hungry: "Neigh! Magic?",
        thanks: "✨",
      },
      {
        type: "phoenix",
        emoji: "🦅",
        name: "Phoenix",
        hungry: "Caw! Ashes?",
        thanks: "REBORN!",
      },
    ],
  },
};

const TREATS = ["🍖", "🥕", "🍪", "🍗", "🐟", "🍕", "🥦", "🍩"];

function pickRandomAnimal(pack) {
  const animals = pack.animals || [];
  if (!animals.length) return null;
  const index = Math.floor(Math.random() * animals.length);
  return animals[index];
}

export default function PetFeedingTask({ task, onSubmit, disabled }) {
  const safeTask = task || {};

  const packKey = safeTask.pack || safeTask?.config?.pack || "classic"; // AI or teacher chooses
  const pack = ANIMAL_PACKS[packKey] || ANIMAL_PACKS.classic;

  // Keep the chosen animal stable across renders
  const [animal, setAnimal] = useState(() => pickRandomAnimal(pack));

  // Visual / game state
  const [fedCount, setFedCount] = useState(0); // how many GOOD feeds
  const [mistakes, setMistakes] = useState(0); // how many BAD feeds
  const [lastDrop, setLastDrop] = useState(null); // { item, good }
  const [submitted, setSubmitted] = useState(false);

  // Drag state
  const [draggingId, setDraggingId] = useState(null);
  const [dishHover, setDishHover] = useState(false);

  // Normalize food items from task config.
  // The player learns good/bad only by reading the word, not by visuals.
  // Supported shapes:
  // - task.config.foodItems: [{ id, label, good }]
  // - task.foodItems: ...
  // - task.config.goodFoods / badFoods arrays of strings
  const normalizeFoodItems = () => {
    const cfg = safeTask.config || {};
    const fromArray =
      (Array.isArray(cfg.foodItems) && cfg.foodItems) ||
      (Array.isArray(safeTask.foodItems) && safeTask.foodItems) ||
      (Array.isArray(safeTask.items) && safeTask.items) ||
      null;

    const goodFoods = Array.isArray(cfg.goodFoods)
      ? cfg.goodFoods
      : Array.isArray(safeTask.goodFoods)
      ? safeTask.goodFoods
      : null;

    const badFoods = Array.isArray(cfg.badFoods)
      ? cfg.badFoods
      : Array.isArray(safeTask.badFoods)
      ? safeTask.badFoods
      : null;

    if (fromArray && fromArray.length) {
      return fromArray
        .map((x, idx) => {
          if (typeof x === "string") {
            return { id: `i_${idx}`, label: x, good: null };
          }
          const label = String(x?.label || x?.word || x?.text || x?.name || `Item ${idx + 1}`).trim();
          const good =
            typeof x?.good === "boolean"
              ? x.good
              : typeof x?.isGood === "boolean"
              ? x.isGood
              : null;

          return { id: String(x?.id || x?._id || `i_${idx}`), label, good };
        })
        .filter((x) => x.label);
    }

    // If good/bad arrays provided, merge them.
    if ((goodFoods && goodFoods.length) || (badFoods && badFoods.length)) {
      const items = [];
      const push = (arr, goodFlag) => {
        (arr || []).forEach((w) => {
          const label = String(w || "").trim();
          if (!label) return;
          items.push({
            id: `${goodFlag ? "g" : "b"}_${label.toLowerCase().replace(/\W+/g, "_")}`,
            label,
            good: !!goodFlag,
          });
        });
      };
      push(goodFoods, true);
      push(badFoods, false);
      return items.slice(0, 16);
    }

    // Default classroom-friendly set.
    return [
      { id: "g_1", label: "Fresh carrots", good: true },
      { id: "g_2", label: "Clean water", good: true },
      { id: "g_3", label: "Healthy kibble", good: true },
      { id: "g_4", label: "Fish fillet", good: true },
      { id: "b_1", label: "Chocolate", good: false },
      { id: "b_2", label: "Soda pop", good: false },
      { id: "b_3", label: "Old leftovers", good: false },
      { id: "b_4", label: "Spoiled milk", good: false },
      { id: "n_1", label: "Mystery snack", good: null },
      { id: "n_2", label: "Crunchy treat", good: null },
      { id: "n_3", label: "Spicy chips", good: null },
      { id: "n_4", label: "Salty cracker", good: null },
    ].slice(0, 16);
  };

  const [foodItems, setFoodItems] = useState(() => normalizeFoodItems());

  // When the task or pack changes (new station, new round, etc.), reset
  useEffect(() => {
    setAnimal(pickRandomAnimal(pack));
    setFedCount(0);
    setMistakes(0);
    setLastDrop(null);
    setSubmitted(false);
    setDraggingId(null);
    setDishHover(false);
    setFoodItems(normalizeFoodItems());
  }, [packKey, safeTask?.id, safeTask?._id]);

  // Play a happy sound once the pet reaches a goal
  useEffect(() => {
    if (fedCount <= 0) return;
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.play().catch(() => {});
    } catch {
      // ignore
    }
  }, [fedCount]);

  const goal = Number(safeTask?.config?.goal || safeTask.goal || 4) || 4;
  const maxMistakes = Number(safeTask?.config?.maxMistakes || safeTask.maxMistakes || 3) || 3;

  const fedEnough = fedCount >= goal;

  const evaluateGoodness = (item) => {
    // If the item has explicit good/bad, use it.
    if (typeof item.good === "boolean") return item.good;

    // Otherwise, infer with a tiny heuristic (still "unknown" to students),
    // but keep it conservative and safe. This is only used when the generator
    // doesn't provide good/bad flags.
    const t = String(item.label || "").toLowerCase();
    const badHints = ["chocolate", "soda", "spoiled", "old", "mold", "rotten", "poison", "glass", "soap"];
    const goodHints = ["water", "fresh", "healthy", "kibble", "carrot", "fish", "apple", "grain", "hay", "lettuce", "berries"];
    if (badHints.some((h) => t.includes(h))) return false;
    if (goodHints.some((h) => t.includes(h))) return true;

    // fallback: deterministic "random" based on label
    let hash = 0;
    for (let i = 0; i < t.length; i += 1) hash = (hash + t.charCodeAt(i) * (i + 1)) % 997;
    return hash % 10 >= 6;
  };

  const canSubmit = fedEnough || mistakes >= maxMistakes;

  const submitIfDone = (nextFed, nextMistakes, last) => {
    if (submitted) return;
    const doneNow = nextFed >= goal || nextMistakes >= maxMistakes;
    if (!doneNow) return;

    setSubmitted(true);

    setTimeout(() => {
      onSubmit?.({
        type: safeTask.taskType || safeTask.type || "pet-feeding",
        completed: true,
        pack: packKey,
        animal: animal?.type || null,
        goal,
        fedCount: nextFed,
        mistakes: nextMistakes,
        lastDrop: last ? { label: last.item?.label, good: last.good } : null,
        // include the set shown to students:
        foodItems: foodItems.map((fi) => ({ id: fi.id, label: fi.label })),
      });
    }, 900);
  };

  const handleDropToDish = (item) => {
    if (disabled || submitted) return;
    if (!item) return;

    const good = evaluateGoodness(item);

    const nextFed = good ? fedCount + 1 : fedCount;
    const nextMistakes = good ? mistakes : mistakes + 1;

    setFedCount(nextFed);
    setMistakes(nextMistakes);
    setLastDrop({ item, good });

    // remove dropped item from the list for a cleaner feel
    setFoodItems((prev) => prev.filter((x) => x.id !== item.id));

    // Brief celebration / reaction delay then maybe submit
    submitIfDone(nextFed, nextMistakes, { item, good });
  };

  if (!animal) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-xl text-red-600">No animals found for this pack.</div>
      </div>
    );
  }

  const mood =
    mistakes >= maxMistakes
      ? "sad"
      : fedEnough
      ? "happy"
      : lastDrop
      ? lastDrop.good
        ? "happy"
        : "yuck"
      : "hungry";

  const petLine =
    mood === "sad"
      ? "Oh no… too many yucky foods."
      : mood === "happy"
      ? animal.thanks
      : mood === "yuck"
      ? "Bleh… that was gross."
      : animal.hungry;

  const progressPct = Math.max(0, Math.min(100, Math.round((fedCount / goal) * 100)));
  const mistakePct = Math.max(0, Math.min(100, Math.round((mistakes / maxMistakes) * 100)));

  return (
    <div
      className="flex h-full flex-col items-center justify-center p-6"
      style={{
        background: "radial-gradient(circle at 20% 10%, rgba(186,230,253,1), rgba(34,197,94,0.20) 40%, rgba(255,255,255,1) 75%)",
        fontFamily: "system-ui",
      }}
    >
      <div
        style={{
          width: "min(980px, 96vw)",
          borderRadius: 22,
          border: "1px solid rgba(226,232,240,1)",
          background: "linear-gradient(180deg, #ffffff, #f8fafc)",
          boxShadow: "0 22px 60px rgba(2,6,23,0.10)",
          padding: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "1.35rem", fontWeight: 1000, color: "#0f172a" }}>🐾 Feed the Pet</div>
            <div style={{ marginTop: 4, color: "#475569", fontWeight: 750 }}>
              Drag a word-card into the bowl. Some foods help… some are yucky.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(226,232,240,1)",
                background: "#ffffff",
                fontWeight: 900,
                color: "#0f172a",
              }}
              title="Animal pack"
            >
              {pack.name}
            </div>

            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(226,232,240,1)",
                background: "#ffffff",
                fontWeight: 900,
                color: "#0f172a",
              }}
              title="Goal"
            >
              Goal: {fedCount}/{goal}
            </div>

            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(226,232,240,1)",
                background: "#ffffff",
                fontWeight: 900,
                color: mistakes >= maxMistakes ? "#b91c1c" : "#0f172a",
              }}
              title="Mistakes"
            >
              Yuck: {mistakes}/{maxMistakes}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 18,
            border: "1px solid rgba(226,232,240,1)",
            background: "rgba(255,255,255,0.85)",
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 1000, color: "#0f172a" }}>How to play (quick)</div>
          <ol style={{ margin: "6px 0 0 18px", padding: 0, color: "#334155", fontWeight: 800, lineHeight: 1.35 }}>
            <li>Drag one word-card into the bowl.</li>
            <li>Try to feed the pet <b>{goal}</b> good items.</li>
            <li>Be careful: <b>{maxMistakes}</b> yucky items ends the round.</li>
          </ol>
        </div>

        {/* Main grid */}
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "1.05fr 0.95fr",
            gap: 14,
          }}
        >
          {/* Left: Pet scene */}
          <div
            style={{
              borderRadius: 20,
              border: "1px solid rgba(226,232,240,1)",
              background: "linear-gradient(180deg, rgba(239,246,255,1), rgba(255,255,255,1))",
              padding: 14,
              position: "relative",
              overflow: "hidden",
              minHeight: 340,
            }}
          >
            {/* soft blobs */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: -80,
                background:
                  "radial-gradient(circle at 30% 20%, rgba(99,102,241,0.18), transparent 55%), radial-gradient(circle at 70% 35%, rgba(34,197,94,0.18), transparent 55%), radial-gradient(circle at 50% 80%, rgba(251,191,36,0.14), transparent 55%)",
                pointerEvents: "none",
              }}
            />

            <div style={{ position: "relative", display: "grid", gap: 10, justifyItems: "center" }}>
              {/* Pet card */}
              <div
                style={{
                  width: "min(520px, 100%)",
                  borderRadius: 22,
                  border: "1px solid rgba(226,232,240,1)",
                  background: "#ffffff",
                  boxShadow: "0 18px 45px rgba(2,6,23,0.08)",
                  padding: 14,
                  display: "grid",
                  justifyItems: "center",
                  textAlign: "center",
                }}
              >
                <div style={{ fontWeight: 1000, fontSize: "1.05rem", color: "#0f172a" }}>
                  {animal.name}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    width: 200,
                    height: 200,
                    borderRadius: 999,
                    background:
                      mood === "sad"
                        ? "radial-gradient(circle at 35% 25%, #fecaca, #fca5a5)"
                        : mood === "yuck"
                        ? "radial-gradient(circle at 35% 25%, #fde68a, #fbbf24)"
                        : "radial-gradient(circle at 35% 25%, #bbf7d0, #86efac)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 20px 55px rgba(2,6,23,0.18)",
                    transform: draggingId ? "scale(1.01)" : "scale(1.00)",
                    transition: "transform 140ms ease",
                  }}
                >
                  <div
                    style={{
                      fontSize: "7.5rem",
                      lineHeight: 1,
                      filter: "drop-shadow(0 16px 28px rgba(2,6,23,0.25))",
                      animation: mood === "happy" ? "petBounce 900ms ease-in-out infinite" : "none",
                    }}
                  >
                    {animal.emoji}
                  </div>
                </div>

                <div style={{ marginTop: 10, fontSize: "1.35rem", fontWeight: 1000, color: "#0f172a" }}>
                  {petLine}
                </div>

                {/* Progress bars */}
                <div style={{ width: "min(520px, 100%)", marginTop: 12, display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color: "#0f172a" }}>
                      <span>Fullness</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div style={{ height: 14, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progressPct}%`, background: "#22c55e" }} />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color: "#0f172a" }}>
                      <span>Yuck Meter</span>
                      <span>{mistakePct}%</span>
                    </div>
                    <div style={{ height: 14, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${mistakePct}%`, background: mistakes >= maxMistakes ? "#b91c1c" : "#f59e0b" }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Dish drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (disabled || submitted) return;
                  setDishHover(true);
                }}
                onDragLeave={() => setDishHover(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDishHover(false);
                  if (disabled || submitted) return;

                  try {
                    const id = e.dataTransfer.getData("text/plain");
                    const item = foodItems.find((x) => x.id === id);
                    handleDropToDish(item);
                  } catch {
                    // ignore
                  } finally {
                    setDraggingId(null);
                  }
                }}
                style={{
                  width: "min(520px, 100%)",
                  borderRadius: 22,
                  border: dishHover ? "2px dashed #6366f1" : "1px solid rgba(226,232,240,1)",
                  background: dishHover ? "rgba(238,242,255,1)" : "#ffffff",
                  boxShadow: dishHover ? "0 22px 70px rgba(99,102,241,0.20)" : "0 18px 45px rgba(2,6,23,0.06)",
                  padding: 14,
                  transition: "all 120ms ease",
                  display: "grid",
                  justifyItems: "center",
                }}
                title="Drop food here"
              >
                <div style={{ fontWeight: 1000, color: "#0f172a" }}>🍽️ Feeding Bowl</div>

                {/* Bowl illustration */}
                <div style={{ width: 260, height: 110, marginTop: 10, position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 999,
                      background: "linear-gradient(180deg, #e2e8f0, #cbd5e1)",
                      boxShadow: "0 18px 35px rgba(2,6,23,0.18)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 18,
                      right: 18,
                      top: 18,
                      height: 56,
                      borderRadius: 999,
                      background: "linear-gradient(180deg, #f8fafc, #e2e8f0)",
                    }}
                  />
                  {/* food pile */}
                  <div
                    style={{
                      position: "absolute",
                      left: 40,
                      right: 40,
                      top: 18,
                      height: 44,
                      borderRadius: 999,
                      background:
                        lastDrop && lastDrop.good
                          ? "radial-gradient(circle at 30% 25%, rgba(34,197,94,0.75), rgba(34,197,94,0.15))"
                          : lastDrop && !lastDrop.good
                          ? "radial-gradient(circle at 30% 25%, rgba(245,158,11,0.75), rgba(245,158,11,0.15))"
                          : "radial-gradient(circle at 30% 25%, rgba(148,163,184,0.65), rgba(148,163,184,0.12))",
                      filter: "blur(0.2px)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: -10,
                      height: 28,
                      borderRadius: 999,
                      background: "rgba(15,23,42,0.10)",
                      filter: "blur(10px)",
                    }}
                  />
                </div>

                <div style={{ marginTop: 10, color: "#475569", fontWeight: 800, textAlign: "center" }}>
                  {submitted ? (
                    fedEnough ? (
                      <span style={{ color: "#16a34a" }}>✅ Goal reached! Great feeding choices.</span>
                    ) : (
                      <span style={{ color: "#b91c1c" }}>⛔ Too many yucky choices. Try again next time.</span>
                    )
                  ) : dishHover ? (
                    <span style={{ color: "#4f46e5" }}>Drop it in the bowl…</span>
                  ) : (
                    <span>Drag a word-card into the bowl.</span>
                  )}
                </div>
              </div>

              {/* last drop feedback */}
              {lastDrop && (
                <div
                  style={{
                    width: "min(520px, 100%)",
                    borderRadius: 18,
                    border: "1px solid rgba(226,232,240,1)",
                    background: lastDrop.good ? "rgba(240,253,244,1)" : "rgba(255,251,235,1)",
                    padding: 12,
                    fontWeight: 900,
                    color: "#0f172a",
                    textAlign: "center",
                  }}
                >
                  {lastDrop.good ? "✅ Good choice:" : "⚠️ Not a great choice:"} {lastDrop.item?.label}
                </div>
              )}
            </div>
          </div>

          {/* Right: draggable word cards */}
          <div
            style={{
              borderRadius: 20,
              border: "1px solid rgba(226,232,240,1)",
              background: "#ffffff",
              padding: 14,
              minHeight: 340,
            }}
          >
            <div style={{ fontWeight: 1000, fontSize: "1.05rem", color: "#0f172a" }}>Food word-cards</div>
            <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
              Read the words. Drag one into the bowl.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {foodItems.length ? (
                foodItems.map((item) => (
                  <div
                    key={item.id}
                    draggable={!disabled && !submitted}
                    onDragStart={(e) => {
                      if (disabled || submitted) return;
                      setDraggingId(item.id);
                      e.dataTransfer.setData("text/plain", item.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    style={{
                      padding: "12px 12px",
                      borderRadius: 16,
                      border: draggingId === item.id ? "2px solid #6366f1" : "1px solid rgba(226,232,240,1)",
                      background: draggingId === item.id ? "rgba(238,242,255,1)" : "linear-gradient(180deg, #ffffff, #f8fafc)",
                      boxShadow: draggingId === item.id ? "0 18px 45px rgba(99,102,241,0.18)" : "0 12px 28px rgba(2,6,23,0.05)",
                      cursor: disabled || submitted ? "not-allowed" : "grab",
                      userSelect: "none",
                      fontWeight: 1000,
                      color: "#0f172a",
                      transform: draggingId === item.id ? "scale(1.01)" : "scale(1.00)",
                      transition: "transform 120ms ease",
                    }}
                    title={disabled || submitted ? "Disabled" : "Drag to bowl"}
                  >
                    {item.label}
                  </div>
                ))
              ) : (
                <div
                  style={{
                    marginTop: 8,
                    padding: 14,
                    borderRadius: 16,
                    border: "1px solid rgba(226,232,240,1)",
                    background: "#f8fafc",
                    color: "#475569",
                    fontWeight: 900,
                    textAlign: "center",
                  }}
                >
                  No more cards to drag.
                </div>
              )}
            </div>

            <div style={{ marginTop: 14, color: "#64748b", fontSize: "0.95rem", fontWeight: 750 }}>
              Goal: feed <strong>{goal}</strong> good items before reaching <strong>{maxMistakes}</strong> yucky items.
            </div>

            {/* Manual submit button (optional) */}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => submitIfDone(fedCount, mistakes, lastDrop)}
                disabled={disabled || submitted || !canSubmit}
                style={{
                  padding: "12px 14px",
                  borderRadius: 999,
                  border: "none",
                  background: disabled || submitted || !canSubmit ? "#94a3b8" : "#16a34a",
                  color: "#fff",
                  fontWeight: 1000,
                  cursor: disabled || submitted || !canSubmit ? "not-allowed" : "pointer",
                  minWidth: 170,
                }}
                title="Finish when goal reached or mistakes maxed"
              >
                {submitted ? "Submitted" : "Finish"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* local keyframes */}
      <style>
        {`
          @keyframes petBounce {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-6px); }
            100% { transform: translateY(0px); }
          }
        `}
      </style>
    </div>
  );
}
