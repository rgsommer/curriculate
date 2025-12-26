// student-app/src/components/tasks/types/FlashcardsRaceTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import useSound from "use-sound";
import confetti from "canvas-confetti";

export default function FlashcardsRaceTask(props) {
  // Back/forward compatible props:
  // - existing usage: ({ socket, roomCode, playerTeam })
  // - TaskRunner-style usage may include: ({ task, socket, roomCode, playerTeam, disabled })
  const { task, socket, roomCode, playerTeam, disabled } = props || {};

  const [card, setCard] = useState(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [winner, setWinner] = useState(null);
  const [scores, setScores] = useState({ A: 0, B: 0 });
  const [gameOver, setGameOver] = useState(false);
  const [showShuffle, setShowShuffle] = useState(false);

  // Sound Effects (safe even if some assets missing; they'll just fail silently in many browsers)
  const [playShuffle] = useSound("/sounds/shuffle.mp3", { volume: 0.8 });
  const [playPointWin] = useSound("/sounds/point-win.mp3", { volume: 0.9 });
  const [playPointLose] = useSound("/sounds/point-lose.mp3", { volume: 0.7 });
  const [playGameWin] = useSound("/sounds/game-win.mp3", { volume: 1.0 });
  const [playShoutNow] = useSound("/sounds/shout-now.mp3", {
    volume: 0.6,
    playbackRate: 1.2,
  });

  const isMyTeamWinner = winner === playerTeam;

  const title = useMemo(() => {
    return task?.title || "Flashcards Race";
  }, [task]);

  const triggerVictory = () => {
    const duration = 5 * 1000;
    const end = Date.now() + duration;
    const interval = setInterval(() => {
      if (Date.now() > end) return clearInterval(interval);
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 },
        zIndex: 100,
      });
    }, 400);
  };

  // Play "SHOUT NOW!" every 4 seconds when waiting
  useEffect(() => {
    if (!winner && !showShuffle && card) {
      playShoutNow();
      const interval = setInterval(playShoutNow, 4000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [winner, showShuffle, card, playShoutNow]);

  useEffect(() => {
    if (!socket) return undefined;

    const onStart = (data) => {
      playShuffle();
      setShowShuffle(true);
      setCardIndex(data?.cardIndex || 0);
      setTotalCards(data?.totalCards || 0);
      setTimeout(() => {
        setShowShuffle(false);
        setCard(data?.card || null);
        setWinner(null);
        setGameOver(false);
      }, 2000);
    };

    const onNext = (data) => {
      setCardIndex(data?.cardIndex ?? 0);
      setCard(data?.card || null);
      setWinner(null);
    };

    const onWinner = (data) => {
      const team = data?.team;
      if (!team) return;

      setWinner(team);
      setScores((prev) => ({ ...prev, [team]: (prev?.[team] || 0) + 10 }));

      if (team === playerTeam) {
        playPointWin();
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      } else {
        playPointLose();
      }
    };

    const onEnd = (data) => {
      setScores(data?.finalScores || { A: 0, B: 0 });
      setGameOver(true);
      setWinner(data?.winner || null);

      if (data?.winner === playerTeam) {
        playGameWin();
        triggerVictory();
      }
    };

    socket.on("flashcards-race:start", onStart);
    socket.on("flashcards-race:next", onNext);
    socket.on("flashcards-race:winner", onWinner);
    socket.on("flashcards-race:end", onEnd);

    return () => {
      socket.off("flashcards-race:start", onStart);
      socket.off("flashcards-race:next", onNext);
      socket.off("flashcards-race:winner", onWinner);
      socket.off("flashcards-race:end", onEnd);
    };
  }, [
    socket,
    playerTeam,
    playPointWin,
    playPointLose,
    playGameWin,
    playShoutNow,
    playShuffle,
  ]);

  if (!socket) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white/90 shadow-xl p-6 text-center">
          <div className="text-2xl font-black text-slate-900">{title}</div>
          <div className="mt-2 text-slate-700">
            This mode requires a live socket race controller (events:
            <code className="mx-1">flashcards-race:start</code>,
            <code className="mx-1">:next</code>,
            <code className="mx-1">:winner</code>,
            <code className="mx-1">:end</code>).
          </div>
          <div className="mt-3 text-slate-500 text-sm">
            Room: {roomCode || "—"} • Team: {playerTeam || "—"}
          </div>
        </div>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900 text-white">
        <div className="text-white/70 text-lg font-semibold mb-3">{title}</div>
        <h1 className="text-6xl md:text-8xl font-black mb-8">RACE OVER!</h1>
        <div className="text-5xl md:text-7xl font-black mb-6 text-center px-6">
          {winner === "TIE" ? "IT'S A TIE!" : `TEAM ${winner} WINS!`}
        </div>
        <div className="text-4xl md:text-6xl font-black">
          A: {scores.A} — B: {scores.B}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 text-white relative overflow-hidden">
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-white/70 text-sm font-semibold tracking-wide">
            FLASHCARDS RACE
          </div>
          <div className="text-xl md:text-2xl font-black truncate">{title}</div>
          {task?.prompt ? (
            <div className="mt-1 text-white/70 text-sm md:text-base line-clamp-2">
              {task.prompt}
            </div>
          ) : null}
        </div>

        <div className="text-right shrink-0">
          <div className="text-white/70 text-sm font-semibold">TEAM</div>
          <div className="text-3xl md:text-4xl font-black">{playerTeam || "—"}</div>
        </div>
      </div>

      {showShuffle && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none bg-black bg-opacity-70">
          <div className="text-5xl md:text-7xl font-black text-yellow-400 animate-bounce text-center px-6">
            SHUFFLING DECK...
          </div>
        </div>
      )}

      {winner && (
        <div
          className={`mt-16 text-5xl md:text-7xl font-black animate-bounce mb-10 text-center px-6 ${
            isMyTeamWinner ? "text-green-300" : "text-red-300"
          }`}
        >
          {isMyTeamWinner ? "YOU WIN THIS POINT!" : `TEAM ${winner} WINS!`}
        </div>
      )}

      {card && (
        <div className="bg-white text-gray-900 p-8 md:p-12 rounded-3xl shadow-2xl max-w-5xl mx-6 border border-black/10">
          <div className="text-4xl md:text-7xl font-black leading-tight text-center break-words">
            {card.question}
          </div>
        </div>
      )}

      {totalCards > 0 && (
        <div className="mt-10 text-2xl md:text-4xl font-black bg-black bg-opacity-60 px-8 py-4 rounded-full border border-white/10">
          CARD <span className="text-yellow-300">{cardIndex + 1}</span> / {totalCards}
        </div>
      )}

      <div className="mt-10 text-3xl md:text-5xl font-black">
        A: <span className="text-yellow-300">{scores.A}</span> — B:{" "}
        <span className="text-pink-300">{scores.B}</span>
      </div>

      {!winner && !showShuffle && (
        <div className="mt-10 text-3xl md:text-5xl animate-pulse font-black text-yellow-300">
          SHOUT NOW!
        </div>
      )}

      {disabled ? (
        <div className="absolute bottom-4 text-white/60 text-sm font-semibold">
          Locked…
        </div>
      ) : null}
    </div>
  );
}
