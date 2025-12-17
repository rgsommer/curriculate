// student-app/src/components/tasks/types/HangmanDuelTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import useSound from "use-sound";

// Draggable Letter Cube (sortable item)
function DraggableLetter({ id, children, disabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "grab",
    padding: "12px",
    margin: "4px",
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    fontWeight: 700,
    fontSize: "1.4rem",
    userSelect: "none",
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// Droppable Blank (proper droppable target, not sortable)
function DroppableBlank({ id, children, isFilled }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 50,
        height: 60,
        border: "3px solid #333",
        borderRadius: 8,
        margin: "0 4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.8rem",
        fontWeight: 700,
        background: isOver ? "#e0f2fe" : isFilled ? "#d4f4dd" : "#fff",
        color: isFilled ? "#16a34a" : "#666",
      }}
    >
      {children || "_"}
    </div>
  );
}

// Power-Up Card
function PowerUpCard({ name, onPlay, disabled }) {
  return (
    <button
      onClick={onPlay}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        margin: "4px",
        background: disabled ? "#94a3b8" : "#3b82f6",
        color: "#fff",
        border: "none",
        borderRadius: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {name}
    </button>
  );
}

// Hangman SVG (returns a string of SVG markup)
function HangmanSVG({ style, parts }) {
  const snowmanStages = [
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/><rect x="120" y="100" width="60" height="40" fill="#000000"/><rect x="105" y="120" width="90" height="15" fill="#000000"/><rect x="120" y="160" width="60" height="20" fill="#ef4444"/></svg>',
  ];

  const christmasTreeStages = [
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/><polygon points="150,260 100,320 200,320" fill="#22c55e"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/><polygon points="150,260 100,320 200,320" fill="#22c55e"/><polygon points="150,200 110,260 190,260" fill="#16a34a"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/><polygon points="150,260 100,320 200,320" fill="#22c55e"/><polygon points="150,200 110,260 190,260" fill="#16a34a"/><polygon points="150,170 140,190 120,190 135,205 130,225 150,210 170,225 165,205 180,190 160,190" fill="#fbbf24"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/><polygon points="150,260 100,320 200,320" fill="#22c55e"/><polygon points="150,200 110,260 190,260" fill="#16a34a"/><polygon points="150,170 140,190 120,190 135,205 130,225 150,210 170,225 165,205 180,190 160,190" fill="#fbbf24"/><circle cx="120" cy="280" r="8" fill="#ef4444"/><circle cx="180" cy="280" r="8" fill="#3b82f6"/><circle cx="135" cy="240" r="8" fill="#eab308"/><circle cx="165" cy="240" r="8" fill="#a855f7"/><circle cx="150" cy="210" r="8" fill="#ef4444"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="320" width="20" height="80" fill="#8b4513"/><polygon points="150,320 80,380 220,380" fill="#166534"/><polygon points="150,260 100,320 200,320" fill="#22c55e"/><polygon points="150,200 110,260 190,260" fill="#16a34a"/><polygon points="150,170 140,190 120,190 135,205 130,225 150,210 170,225 165,205 180,190 160,190" fill="#fbbf24"/><circle cx="120" cy="280" r="8" fill="#ef4444"/><circle cx="180" cy="280" r="8" fill="#3b82f6"/><circle cx="135" cy="240" r="8" fill="#eab308"/><circle cx="165" cy="240" r="8" fill="#a855f7"/><circle cx="150" cy="210" r="8" fill="#ef4444"/><rect x="100" y="380" width="40" height="30" fill="#ef4444"/><rect x="160" y="380" width="40" height="30" fill="#3b82f6"/></svg>',
  ];

  const classicStages = [
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#333" stroke-width="4"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#333" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#333" stroke-width="4"/><line x1="180" y1="220" x2="220" y2="260" stroke="#333" stroke-width="4"/></svg>',
  ];

  const gingerbreadStages = [
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/><rect x="100" y="240" width="40" height="40" fill="#87ceeb"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/><rect x="100" y="240" width="40" height="40" fill="#87ceeb"/><rect x="190" y="240" width="20" height="80" fill="#fff" rx="10"/><rect x="190" y="240" width="20" height="20" fill="#ef4444"/><rect x="190" y="280" width="20" height="20" fill="#ef4444"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/><rect x="100" y="240" width="40" height="40" fill="#87ceeb"/><rect x="190" y="240" width="20" height="80" fill="#fff" rx="10"/><rect x="190" y="240" width="20" height="20" fill="#ef4444"/><rect x="190" y="280" width="20" height="20" fill="#ef4444"/><circle cx="150" cy="170" r="15" fill="#22c55e"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/><rect x="100" y="240" width="40" height="40" fill="#87ceeb"/><rect x="190" y="240" width="20" height="80" fill="#fff" rx="10"/><rect x="190" y="240" width="20" height="20" fill="#ef4444"/><rect x="190" y="280" width="20" height="20" fill="#ef4444"/><circle cx="150" cy="170" r="15" fill="#22c55e"/><path d="M70,200 Q150,160 230,200" fill="none" stroke="#fff" stroke-width="8"/></svg>',
    '<svg width="300" height="400" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="200" width="140" height="150" fill="#d2691e" rx="10"/><polygon points="70,200 150,140 230,200" fill="#8b4513"/><rect x="130" y="280" width="40" height="70" fill="#654321"/><rect x="100" y="240" width="40" height="40" fill="#87ceeb"/><rect x="190" y="240" width="20" height="80" fill="#fff" rx="10"/><rect x="190" y="240" width="20" height="20" fill="#ef4444"/><rect x="190" y="280" width="20" height="20" fill="#ef4444"/><circle cx="150" cy="170" r="15" fill="#22c55e"/><path d="M70,200 Q150,160 230,200" fill="none" stroke="#fff" stroke-width="8"/><circle cx="100" cy="200" r="4" fill="#f97316"/><circle cx="120" cy="180" r="4" fill="#f97316"/><circle cx="180" cy="200" r="4" fill="#f97316"/><circle cx="200" cy="180" r="4" fill="#f97316"/></svg>',
  ];

  const stages =
    {
      snowman: snowmanStages,
      "christmas-tree": christmasTreeStages,
      classic: classicStages,
      gingerbread: gingerbreadStages,
    }[style] || classicStages;

  const safeParts = Math.max(0, Math.min(Number(parts || 0), stages.length - 1));
  return stages[safeParts];
}

const HangmanDuelTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const initialWord = useMemo(() => String(task?.word || ""), [task]);

  const [blanks, setBlanks] = useState(() => {
    const w = initialWord;
    return w ? w.split("").map(() => "_") : [];
  });

  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [playerCount, setPlayerCount] = useState(task?.playerCount || 1);
  const [players, setPlayers] = useState(Array.isArray(task?.players) ? task.players : []);
  const [myPlayerNumber, setMyPlayerNumber] = useState(task?.myPlayerNumber || 1);
  const [eliminated, setEliminated] = useState([]);
  const [gameStyle, setGameStyle] = useState(task?.style || "classic");

  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  // Sound Effects (kept; you can wire them to server events later)
  useSound("/sounds/correct-letter.mp3");
  useSound("/sounds/wrong-guess.mp3");
  useSound("/sounds/word-win.mp3");
  useSound("/sounds/eliminated.mp3");
  useSound("/sounds/power-up.mp3");
  useSound("/sounds/reveal-letter.mp3");
  useSound("/sounds/steal-letter.mp3");

  const sensors = useSensors(useSensor(PointerSensor));

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
          if (typeof onSubmit === "function") onSubmit(); // Auto-advance
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleDragEnd = (event) => {
    // ✅ FIX: correct turn check
    if (currentTurn !== myPlayerNumber) return;

    const { active, over } = event;
    if (!over) return;

    const letter = active?.id;
    const blankIndex = over?.id;

    if (!socket?.current) return;
    socket.current.emit("hangman-place-letter", {
      roomCode,
      teamId,
      letter,
      blankIndex,
    });
  };

  const handleGuessWord = () => {
    if (currentTurn !== myPlayerNumber) return;
    const guess = prompt("Guess the full word:");
    if (!guess) return;
    if (!socket?.current) return;
    socket.current.emit("hangman-guess-word", { roomCode, teamId, guess });
  };

  const handlePlayPowerUp = (powerUpId) => {
    if (currentTurn !== myPlayerNumber) return;
    if (!socket?.current) return;
    socket.current.emit("hangman-play-power-up", {
      roomCode,
      teamId,
      powerUpId,
    });
  };

  useEffect(() => {
    if (!socket?.current) return;

    const onUpdate = (update) => {
      if (!update) return;

      if (Array.isArray(update.blanks)) setBlanks(update.blanks);
      if (typeof update.wrongGuesses === "number") setWrongGuesses(update.wrongGuesses);
      if (typeof update.currentTurn === "number") setCurrentTurn(update.currentTurn);
      if (typeof update.playerCount === "number") setPlayerCount(update.playerCount);
      if (Array.isArray(update.players)) setPlayers(update.players);
      if (Array.isArray(update.eliminated)) setEliminated(update.eliminated);
      if (typeof update.style === "string") setGameStyle(update.style);

      // Optional: if your server sends feedback, show the overlay
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

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <h2>Hangman Duel</h2>

      {/* ✅ FIX: render SVG string correctly */}
      <div
        dangerouslySetInnerHTML={{
          __html: HangmanSVG({ style: gameStyle, parts: wrongGuesses }),
        }}
      />

      <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
        {blanks.map((letter, i) => (
          <DroppableBlank key={i} id={i} isFilled={letter && letter !== "_"}>
            {letter}
          </DroppableBlank>
        ))}
      </div>

      <div style={{ fontSize: "1.4rem", margin: "16px 0" }}>
        Turn: Player {currentTurn} {currentTurn === myPlayerNumber && "(You!)"}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 20,
          }}
        >
          {(players || []).map((player) => {
            const pnum = player?.playerNumber;
            const isElim = eliminated.includes(pnum);
            const letters = Array.isArray(player?.letters) ? player.letters : [];
            const powerUps = Array.isArray(player?.powerUps) ? player.powerUps : [];

            const canDragFromThisPlayer =
              currentTurn === myPlayerNumber && pnum === myPlayerNumber;

            return (
              <div
                key={pnum}
                style={{
                  background: isElim ? "#fee2e2" : "#f0fdf4",
                  opacity: isElim ? 0.6 : 1,
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <h3>
                  Player {pnum} {pnum === myPlayerNumber && "(You)"}
                </h3>

                {isElim && <p>Eliminated</p>}

                <SortableContext items={letters} strategy={rectSortingStrategy}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
                    {letters.map((letter) => (
                      <DraggableLetter key={letter} id={letter} disabled={!canDragFromThisPlayer}>
                        {letter}
                      </DraggableLetter>
                    ))}
                  </div>
                </SortableContext>

                <div style={{ marginTop: 16 }}>
                  Power-Ups:
                  <div style={{ marginTop: 8 }}>
                    {powerUps.map((powerUp) => (
                      <PowerUpCard
                        key={powerUp}
                        name={powerUp}
                        onPlay={() => handlePlayPowerUp(powerUp)}
                        disabled={currentTurn !== myPlayerNumber}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DndContext>

      {currentTurn === myPlayerNumber && (
        <button onClick={handleGuessWord} style={{ marginTop: 16 }}>
          Guess Full Word
        </button>
      )}

      {/* Post-submission overlay */}
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
          {submissionFeedback.points && (
            <div style={{ fontSize: "2rem" }}>+{submissionFeedback.points} points!</div>
          )}
          <div style={{ marginTop: 40, fontSize: "1.6rem" }}>
            Next task in {overlayTimer}s...
          </div>
        </div>
      )}
    </div>
  );
};

export default HangmanDuelTask;
