import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

// -------------------------------
// Shared sizes so tiles == slots
// -------------------------------
const TILE_W = 52;
const TILE_H = 62;
const RADIUS = 12;

// -------------------------------
// Draggable Letter Tile (always available; shading shows usage)
// -------------------------------
function DraggableLetter({ id, letter, disabled, status, selected, onClick }) {
  // status: "unused" | "used" | "full"
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });

  const bg =
    status === "unused" ? "#ffffff" : status === "used" ? "#fef9c3" : "#e5e7eb"; // white / light yellow / grey
  const border =
    selected ? "3px solid #111827" : status === "full" ? "3px solid rgba(0,0,0,0.28)" : "3px solid rgba(0,0,0,0.18)";
  const text =
    status === "full" ? "#6b7280" : "#111827";

  const style = {
    width: TILE_W,
    height: TILE_H,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "grab",
    borderRadius: RADIUS,
    border,
    background: disabled ? "#e5e7eb" : bg,
    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
    fontWeight: 900,
    fontSize: 28,
    color: text,
    userSelect: "none",
    touchAction: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 6,
    position: "relative",
  };

  const badge =
    status === "unused" ? "" : status === "used" ? "✓" : "✓✓";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={disabled ? undefined : onClick}
      role="button"
      aria-disabled={disabled ? "true" : "false"}
      title={
        status === "unused"
          ? "Unused"
          : status === "used"
          ? "Used (still needed)"
          : "Fully used (still usable)"
      }
    >
      {letter}
      {badge ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 12,
            fontWeight: 900,
            opacity: 0.75,
          }}
        >
          {badge}
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------
// Droppable Placeholder Slot
// -------------------------------
function DroppableSlot({ id, value, canAct, onClick, onClear }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const filled = !!value && value !== "_";
  const style = {
    width: TILE_W,
    height: TILE_H,
    borderRadius: RADIUS,
    border: "3px solid #111827",
    background: isOver ? "#e0f2fe" : filled ? "#dcfce7" : "#ffffff",
    color: filled ? "#16a34a" : "#111827",
    fontWeight: 900,
    fontSize: 28,
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 6,
    cursor: canAct ? "pointer" : "default",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={canAct ? onClick : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        if (canAct) onClear?.();
      }}
      title={canAct ? "Drop a letter here (or tap to place selected). Right-click to clear." : ""}
    >
      {filled ? value : "_"}
    </div>
  );
}

// -------------------------------
// Hangman SVG (string markup)
// -------------------------------
function HangmanSVG({ style, parts }) {
  const snowmanStages = [
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/><rect x="120" y="100" width="60" height="40" fill="#000000"/><rect x="105" y="120" width="90" height="15" fill="#000000"/></svg>',
  ];

  const classicStages = [
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="220" y2="260" stroke="#333" stroke-width="4"/></svg>',
  ];

  const stages = style === "snowman" ? snowmanStages : classicStages;
  const safeParts = Math.max(0, Math.min(Number(parts || 0), stages.length - 1));
  return stages[safeParts];
}

// -------------------------------
// Main component
// -------------------------------
export default function HangmanDuelTask({ task, onSubmit, socket, roomCode, teamId }) {
  const word = useMemo(() => {
    const raw = String(task?.word || task?.hangmanWord || task?.data?.word || "");
    return raw.trim().toUpperCase();
  }, [task]);

  const slots = useMemo(() => {
    if (!word) return [];
    return word.split("").map((ch, idx) => ({
      idx,
      ch,
      isLetter: /^[A-Z]$/.test(ch),
    }));
  }, [word]);

  // requiredCounts: how many times each letter occurs in the word
  const requiredCounts = useMemo(() => {
    const counts = {};
    for (const s of slots) {
      if (!s.isLetter) continue;
      counts[s.ch] = (counts[s.ch] || 0) + 1;
    }
    return counts;
  }, [slots]);

  const [placed, setPlaced] = useState(() => []);
  const [selectedLetter, setSelectedLetter] = useState(null);

  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [myPlayerNumber, setMyPlayerNumber] = useState(task?.myPlayerNumber || 1);
  const [eliminated, setEliminated] = useState([]);
  const [gameStyle, setGameStyle] = useState(task?.style || "classic");

  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  const canAct = currentTurn === myPlayerNumber && !eliminated.includes(myPlayerNumber);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const alphabet = useMemo(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), []);

  // placedCounts: how many times each letter is currently placed in slots
  const placedCounts = useMemo(() => {
    const counts = {};
    for (let i = 0; i < placed.length; i++) {
      const v = placed[i];
      if (v && v !== "_" && /^[A-Z]$/.test(v)) counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }, [placed]);

  // Determine letter status for shading
  const letterStatus = useMemo(() => {
    const status = {};
    for (const L of alphabet) {
      const used = placedCounts[L] || 0;
      if (used <= 0) status[L] = "unused";
      else {
        const need = requiredCounts[L] || 0;
        status[L] = need > 0 && used >= need ? "full" : "used";
      }
    }
    return status;
  }, [alphabet, placedCounts, requiredCounts]);

  // reset placed whenever a new word arrives
  useEffect(() => {
    if (!slots.length) {
      setPlaced([]);
      return;
    }
    setPlaced(slots.map((s) => (s.isLetter ? "_" : s.ch)));
    setSelectedLetter(null);
  }, [slots]);

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);

    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
          overlayTimerRef.current = null;
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          if (typeof onSubmit === "function") onSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const emitPlaceLetter = (letter, slotIndex) => {
    if (!letter || slotIndex == null) return;
    if (!slots[slotIndex]?.isLetter) return;

    if (socket?.current) {
      socket.current.emit("hangman-place-letter", {
        roomCode,
        teamId,
        letter,
        blankIndex: slotIndex,
      });
      return;
    }

    setPlaced((prev) => {
      const next = [...prev];
      next[slotIndex] = letter;
      return next;
    });
  };

  const emitClearSlot = (slotIndex) => {
    if (slotIndex == null) return;
    if (!slots[slotIndex]?.isLetter) return;

    if (socket?.current) {
      socket.current.emit("hangman-clear-slot", { roomCode, teamId, blankIndex: slotIndex });
      return;
    }

    setPlaced((prev) => {
      const next = [...prev];
      next[slotIndex] = "_";
      return next;
    });
  };

  const handleDragEnd = (event) => {
    if (!canAct) return;
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active?.id || "");
    if (!activeId.startsWith("L:")) return;

    const letter = activeId.slice(2);
    const slotIndex = over?.id;
    if (typeof slotIndex !== "number") return;

    emitPlaceLetter(letter, slotIndex);
  };

  const handleGuessWord = () => {
    if (!canAct) return;

    const guess = slots
      .map((s, i) => (s.isLetter ? (placed[i] && placed[i] !== "_" ? placed[i] : "_") : s.ch))
      .join("");

    if (guess.includes("_")) {
      alert("Fill all letters before submitting the word guess.");
      return;
    }

    if (socket?.current) {
      socket.current.emit("hangman-guess-word", { roomCode, teamId, guess });
      return;
    }

    setSubmissionFeedback({ message: `Submitted: ${guess}`, points: 0 });
    startOverlayTimer();
  };

  const handleSetStyle = (style) => {
    setGameStyle(style);
    if (socket?.current) {
      socket.current.emit("hangman-set-style", { roomCode, teamId, style });
    }
  };

  // Server updates (optional)
  useEffect(() => {
    if (!socket?.current) return;

    const onUpdate = (update) => {
      if (!update) return;

      if (Array.isArray(update.blanks) && update.blanks.length) {
        setPlaced(update.blanks.map((x) => (x && x !== "" ? String(x).toUpperCase() : "_")));
      }

      if (typeof update.wrongGuesses === "number") setWrongGuesses(update.wrongGuesses);
      if (typeof update.currentTurn === "number") setCurrentTurn(update.currentTurn);
      if (typeof update.myPlayerNumber === "number") setMyPlayerNumber(update.myPlayerNumber);
      if (Array.isArray(update.eliminated)) setEliminated(update.eliminated);
      if (typeof update.style === "string") setGameStyle(update.style);

      if (update.feedback) {
        setSubmissionFeedback(update.feedback);
        startOverlayTimer();
      }
    };

    socket.current.on("hangman-update", onUpdate);
    return () => {
      socket.current?.off("hangman-update", onUpdate);
      if (overlayTimerRef.current) {
        clearInterval(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  if (!word) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Hangman Duel</h2>
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "#fee2e2" }}>
          <div style={{ fontWeight: 900 }}>Hangman error:</div>
          <div>No word provided for this task.</div>
        </div>
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(task, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <h2 style={{ margin: 0 }}>Hangman Duel</h2>

      {/* Style picker */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0 10px" }}>
        <button
          onClick={() => handleSetStyle("classic")}
          disabled={wrongGuesses > 0}
          style={{
            padding: "8px 14px",
            borderRadius: 12,
            border: "2px solid rgba(0,0,0,0.2)",
            fontWeight: 900,
            background: gameStyle === "classic" ? "#111827" : "#fff",
            color: gameStyle === "classic" ? "#fff" : "#111827",
            cursor: wrongGuesses > 0 ? "not-allowed" : "pointer",
          }}
        >
          Classic
        </button>

        <button
          onClick={() => handleSetStyle("snowman")}
          disabled={wrongGuesses > 0}
          style={{
            padding: "8px 14px",
            borderRadius: 12,
            border: "2px solid rgba(0,0,0,0.2)",
            fontWeight: 900,
            background: gameStyle === "snowman" ? "#111827" : "#fff",
            color: gameStyle === "snowman" ? "#fff" : "#111827",
            cursor: wrongGuesses > 0 ? "not-allowed" : "pointer",
          }}
        >
          Snowman
        </button>
      </div>

      {/* Hangman drawing */}
      <div
        style={{ display: "flex", justifyContent: "center", marginTop: 6 }}
        dangerouslySetInnerHTML={{
          __html: HangmanSVG({ style: gameStyle, parts: wrongGuesses }),
        }}
      />

      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>
        Turn: Player {currentTurn} {canAct ? "(You)" : ""}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {/* Slots row */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Drag letters into the boxes</div>

          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
            {slots.map((s, i) => {
              if (!s.isLetter) {
                return (
                  <div
                    key={`sp-${i}`}
                    style={{
                      width: TILE_W,
                      height: TILE_H,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: 6,
                      fontSize: 28,
                      fontWeight: 900,
                      opacity: 0.65,
                    }}
                  >
                    {s.ch}
                  </div>
                );
              }

              return (
                <DroppableSlot
                  key={`slot-${i}`}
                  id={i}
                  value={placed[i] || "_"}
                  canAct={canAct}
                  onClick={() => {
                    if (!canAct) return;
                    if (!selectedLetter) return;
                    emitPlaceLetter(selectedLetter, i);
                    setSelectedLetter(null);
                  }}
                  onClear={() => emitClearSlot(i)}
                />
              );
            })}
          </div>

          {canAct && (
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.75 }}>
              Tap-to-place works too: tap a letter (it highlights), then tap a box. Right-click a box to clear (desktop).
            </div>
          )}
        </div>

        {/* Letter bank (never disappears; shade indicates usage) */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Letter Bank{selectedLetter ? ` • Selected: ${selectedLetter}` : ""}
          </div>

          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
            {alphabet.map((L) => (
              <DraggableLetter
                key={L}
                id={`L:${L}`}
                letter={L}
                disabled={!canAct}
                status={letterStatus[L] || "unused"}
                selected={selectedLetter === L}
                onClick={() => setSelectedLetter(L)}
              />
            ))}
          </div>

          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            Legend: white = unused, yellow = used (still needed), grey = fully used for this word (still usable).
          </div>
        </div>
      </DndContext>

      {/* Submit guess */}
      <div style={{ marginTop: 14 }}>
        <button
          onClick={handleGuessWord}
          disabled={!canAct}
          style={{
            padding: "10px 18px",
            borderRadius: 12,
            border: "2px solid rgba(0,0,0,0.2)",
            fontWeight: 900,
            fontSize: 16,
            background: canAct ? "#111827" : "#9ca3af",
            color: "#fff",
            cursor: canAct ? "pointer" : "not-allowed",
          }}
        >
          Submit Word Guess
        </button>
      </div>

      {/* Overlay feedback */}
      {submissionFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: 24 }}>
            {submissionFeedback.message || "Nice!"}
          </div>
          {submissionFeedback.points ? (
            <div style={{ fontSize: "2rem" }}>+{submissionFeedback.points} points!</div>
          ) : null}
          <div style={{ marginTop: 40, fontSize: "1.6rem" }}>Next task in {overlayTimer}s...</div>
        </div>
      )}
    </div>
  );
}
