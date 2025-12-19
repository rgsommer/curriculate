// student-app/src/components/tasks/types/WordWeaverDuelTask.jsx
import React, { useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import useSound from "use-sound";

// Draggable Word Tile
function DraggableWord({ id, children, disabled, rotation }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "grab",
    display: "inline-block",
    padding: "10px 16px",
    margin: "6px",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    fontWeight: 700,
    fontSize: "1.2rem",
    userSelect: "none",
    touchAction: "none",
    transform: rotation ? "rotate(90deg)" : "none", // Vertical/horizontal
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// Droppable Grid Cell
function DroppableCell({ id, children, isOccupied }) {
  const { setNodeRef } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 40,
        height: 40,
        border: "1px solid #ccc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.2rem",
        fontWeight: 700,
        background: isOccupied ? "#d4f4dd" : "#f9fafb",
        color: isOccupied ? "#16a34a" : "#666",
      }}
    >
      {children || ""}
    </div>
  );
}

// Power-Up Card
function PowerUpCard({ id, name, onPlay, disabled }) {
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

// Hangman SVG (Gamified Styles)
function HangmanSVG({ style, parts }) {
  if (style === "snowman") {
    // Paste full Snowman SVG stages from previous response
    return <svg width="200" height="200" viewBox="0 0 200 200">
      {/* Conditional stages based on parts, e.g.: */}
      {parts >= 1 && <circle cx="100" cy="180" r="40" fill="#fff" />}
      {/* ... add all parts */}
    </svg>;
  } else if (style === "christmas-tree") {
    // Paste full Christmas Tree SVG stages
    return <svg width="200" height="200" viewBox="0 0 200 200">
      {/* Conditional stages */}
    </svg>;
  } else if (style === "classic") {
    // Paste full Classic Hangman SVG stages
    return <svg width="200" height="200" viewBox="0 0 200 200">
      {/* Conditional stages */}
    </svg>;
  } else if (style === "gingerbread") {
    // Paste full Gingerbread House SVG stages
    return <svg width="200" height="200" viewBox="0 0 200 200">
      {/* Conditional stages */}
    </svg>;
  }
  return <div>No style selected</div>;
}

const WordWeaverDuelTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const [grid, setGrid] = useState(task.config.grid || Array.from({ length: task.config.gridSize || 10 }, () => Array(task.config.gridSize || 10).fill(null)));
  const [currentTurn, setCurrentTurn] = useState(1);
  const [playerCount, setPlayerCount] = useState(task.config.playerCount || 1);
  const [players, setPlayers] = useState(task.config.players || []);
  const [myPlayerNumber, setMyPlayerNumber] = useState(task.myPlayerNumber || 1);
  const [eliminated, setEliminated] = useState([]);
  const [gameStyle, setGameStyle] = useState(null);
  const [styleChosen, setStyleChosen] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);
  const [gridRotation, setGridRotation] = useState(0);

  // Sound Effects
  const [playCorrect] = useSound("/sounds/correct-letter.mp3");
  const [playWrong] = useSound("/sounds/wrong-guess.mp3");
  const [playWin] = useSound("/sounds/word-win.mp3");
  const [playLose] = useSound("/sounds/eliminated.mp3");
  const [playPowerUp] = useSound("/sounds/power-up.mp3");
  const [playReveal] = useSound("/sounds/reveal-letter.mp3");
  const [playSteal] = useSound("/sounds/steal-letter.mp3");

  // Animations State
  const [stealAnimation, setStealAnimation] = useState(null); // { letter, fromPlayer, toPlayer }
  const [revealAnimation, setRevealAnimation] = useState(null); // { letter, blankIndex }
  const [extraGuessAnimation, setExtraGuessAnimation] = useState(null); // { playerNumber }

  const sensors = useSensors(useSensor(PointerSensor));

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          onSubmit(); // Auto-advance to next task/scan
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleChooseStyle = (style) => {
    socket.current.emit("word-weaver-choose-style", { roomCode, teamId, style });
    setStyleChosen(true);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over) {
      const word = active.id;
      const [row, col] = over.id.split(",").map(Number);
      socket.current.emit("word-weaver-place-word", { roomCode, teamId, word, row, col, rotation: gridRotation });
    }
  };

  const handlePlayPowerUp = (powerUpId) => {
    socket.current.emit("word-weaver-play-power-up", { roomCode, teamId, powerUpId });
  };

  useEffect(() => {
    socket.current.on("word-weaver-update", (update) => {
      setGrid(update.grid);
      setCurrentTurn(update.currentTurn);
      setPlayers(update.players);
      setEliminated(update.eliminated);
      setGameStyle(update.style);
    });

    socket.current.on("letter-correct", () => playCorrect());
    socket.current.on("letter-wrong", () => playWrong());
    socket.current.on("game-win", () => playWin());
    socket.current.on("player-eliminated", () => playLose());
    socket.current.on("power-up-used", () => playPowerUp());
    socket.current.on("power-up-reveal-letter", () => playReveal());
    socket.current.on("power-up-steal-letter", () => playSteal());

    return () => {
      socket.current.off("word-weaver-update");
      socket.current.off("letter-correct");
      socket.current.off("letter-wrong");
      socket.current.off("game-win");
      socket.current.off("player-eliminated");
      socket.current.off("power-up-used");
      socket.current.off("power-up-reveal-letter");
      socket.current.off("power-up-steal-letter");
    };
  }, []);

  if (!styleChosen) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <h2>Choose Game Style!</h2>
        <button onClick={() => handleChooseStyle("snowman")}>Snowman</button>
        <button onClick={() => handleChooseStyle("christmas-tree")}>Christmas Tree</button>
        <button onClick={() => handleChooseStyle("classic")}>Classic</button>
        <button onClick={() => handleChooseStyle("gingerbread")}>Gingerbread</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <h2>Word Weaver Duel</h2>

      <HangmanSVG style={gameStyle} parts={wrongGuesses} />

      <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
        {blanks.map((letter, i) => (
          <DroppableBlank key={i} id={i} isFilled={!!letter}>
            {letter}
          </DroppableBlank>
        ))}
      </div>

      <div style={{ fontSize: "1.4rem", margin: "16px 0" }}>
        Turn: Player {currentTurn} {currentTurn === myPlayerNumber && "(You!)"}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
          {players.map((player) => (
            <div key={player.playerNumber} style={{ background: eliminated.includes(player.playerNumber) ? "#fee2e2" : "#f0fdf4", opacity: eliminated.includes(player.playerNumber) ? 0.6 : 1 }}>
              <h3>Player {player.playerNumber} {player.playerNumber === myPlayerNumber && "(You)"}</h3>
              {eliminated.includes(player.playerNumber) && <p>Eliminated</p>}
              <SortableContext items={player.letters}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
                  {player.letters.map((letter) => (
                    <DraggableLetter key={letter} id={letter} disabled={!currentTurn === player.playerNumber}>
                      {letter}
                    </DraggableLetter>
                  ))}
                </div>
              </SortableContext>
              <div style={{ marginTop: 16 }}>
                Power-Ups:
                {player.powerUps.map((powerUp) => (
                  <PowerUpCard
                    key={powerUp}
                    name={powerUp}
                    onPlay={() => handlePlayPowerUp(powerUp)}
                    disabled={!currentTurn === player.playerNumber}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DndContext>

      {currentTurn === myPlayerNumber && (
        <button onClick={handleGuessWord}>Guess Full Word</button>
      )}

      {/* Overlay */}
      {submissionFeedback && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: "3rem", marginBottom: 24 }}>
            {submissionFeedback.message}
          </div>
          {submissionFeedback.points && (
            <div style={{ fontSize: "2rem" }}>
              +{submissionFeedback.points} points!
            </div>
          )}
          <div style={{ marginTop: 40, fontSize: "1.6rem" }}>
            Next task in {overlayTimer}s...
          </div>
        </div>
      )}

      {/* Waiting */}
      {!currentTask && !submissionFeedback && !showQrScanner && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <h2 style={{ fontSize: "2.2rem" }}>Waiting for your next task…</h2>
          <p style={{ fontSize: "1.5rem", color: "#64748b" }}>Get ready to Curriculate!</p>
        </div>
      )}
    </div>
  );
};

export default WordWeaverDuelTask;