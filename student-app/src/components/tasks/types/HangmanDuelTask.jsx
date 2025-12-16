// student-app/src/components/tasks/types/HangmanDuelTask.jsx
import React, { useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Draggable Letter Component
const DraggableLetter = ({ id, children, disabled }) => {
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
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        padding: "12px 16px",
        margin: "4px",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        fontWeight: 700,
        fontSize: "1.4rem",
        userSelect: "none",
        touchAction: "none",
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

// Droppable Blank
const DroppableBlank = ({ id, children, isFilled }) => {
  const { setNodeRef } = useSortable({ id });

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
        background: isFilled ? "#d4f4dd" : "#fff",
        color: isFilled ? "#16a34a" : "#666",
      }}
    >
      {children || "_"}
    </div>
  );
};

const HangmanDuelTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const [blanks, setBlanks] = useState(task.blanks || []); // Array of letters or null
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [players, setPlayers] = useState(task.players || []); // [{ playerNumber, letters, eliminated }]
  const [myPlayerNumber, setMyPlayerNumber] = useState(task.myPlayerNumber || 1);
  const [eliminated, setEliminated] = useState([]);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const timerRef = useRef(null);

  const isMyTurn = currentTurn === myPlayerNumber && !eliminated.includes(myPlayerNumber);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          setCurrentTask(null); // Auto-advance
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleDragEnd = (event) => {
    if (!isMyTurn) return;
    const { active, over } = event;
    if (over && over.id.startsWith("blank-")) {
      const letter = active.id.split("-")[1];
      const blankIndex = parseInt(over.id.split("-")[1]);
      socket.current.emit("hangman-place-letter", {
        roomCode,
        teamId,
        letter,
        blankIndex,
      });
    }
  };

  const handleGuessWord = () => {
    const guess = prompt("Guess the full word:");
    if (guess) {
      socket.current.emit("hangman-guess-word", { roomCode, teamId, guess });
    }
  };

  useEffect(() => {
    socket.current.on("hangman-update", (update) => {
      setBlanks(update.blanks);
      setWrongGuesses(update.wrongGuesses);
      setCurrentTurn(update.currentTurn);
      setPlayers(update.players);
      setEliminated(update.eliminated || []);
    });

    socket.current.on("submission-result", (data) => {
      setSubmissionFeedback({
        message: data.message || (data.correct ? "Correct!" : "Wrong guess!"),
        positive: data.correct,
        points: data.points,
      });
      startOverlayTimer();
    });

    return () => {
      socket.current.off("hangman-update");
      socket.current.off("submission-result");
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [socket]);

  // Render hangman (replace with your gamified SVG)
  const HangmanSVG = ({ parts }) => (
    <div style={{ fontSize: "6rem", textAlign: "center" }}>
      {parts >= 1 && "☃️"} {/* Snowman example */}
      {parts >= 2 && "⛄"}
      {parts >= 3 && "🎄"}
      {/* Add more festive parts */}
      {parts >= 6 && "🎉 Full! You lost!"}
      {parts < 6 && <div>Lives: {6 - parts}</div>}
    </div>
  );

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <h2 style={{ fontSize: "2rem", marginBottom: 20 }}>Hangman Duel</h2>

      <HangmanSVG parts={wrongGuesses} />

      <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
        {blanks.map((letter, i) => (
          <DroppableBlank key={i} id={`blank-${i}`} isFilled={!!letter}>
            {letter}
          </DroppableBlank>
        ))}
      </div>

      <div style={{ fontSize: "1.4rem", margin: "16px 0" }}>
        Turn: Player {currentTurn} {isMyTurn && "(You!)"}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
          {players.map((player) => (
            <div
              key={player.playerNumber}
              style={{
                padding: 16,
                borderRadius: 16,
                background: eliminated.includes(player.playerNumber) ? "#fee2e2" : "#f0fdf4",
                opacity: eliminated.includes(player.playerNumber) ? 0.6 : 1,
              }}
            >
              <h3>Player {player.playerNumber} {player.playerNumber === myPlayerNumber && "(You)"}</h3>
              {eliminated.includes(player.playerNumber) && <p>Eliminated</p>}
              <SortableContext items={player.letters.map(l => l.id)}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
                  {player.letters.map((letter) => (
                    <DraggableLetter
                      key={letter.id}
                      id={letter.id}
                      disabled={!isMyTurn || eliminated.includes(player.playerNumber)}
                    >
                      {letter.value}
                    </DraggableLetter>
                  ))}
                </div>
              </SortableContext>
            </div>
          ))}
        </div>
      </DndContext>

      {isMyTurn && (
        <button
          onClick={handleGuessWord}
          style={{
            marginTop: 24,
            padding: "16px 32px",
            fontSize: "1.2rem",
            background: "#22c55e",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
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
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            zIndex: 1000,
            textAlign: "center",
            padding: 20,
          }}
        >
          <div style={{ fontSize: "3rem", fontWeight: 900, marginBottom: 24 }}>
            {submissionFeedback.message}
          </div>
          {submissionFeedback.points != null && (
            <div style={{ fontSize: "2rem" }}>
              +{submissionFeedback.points} points!
            </div>
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