// student-app/src/components/tasks/types/FlashcardsRaceTask.jsx
import React, { useEffect, useState } from "react";
import useSound from "use-sound";
import confetti from "canvas-confetti";

export default function FlashcardsRaceTask({ socket, roomCode, playerTeam }) {
  const [card, setCard] = useState(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [winner, setWinner] = useState(null);
  const [scores, setScores] = useState({ A: 0, B: 0 });
  const [gameOver, setGameOver] = useState(false);
  const [showShuffle, setShowShuffle] = useState(false);

  // Sound Effects
  const [playShuffle] = useSound("/sounds/shuffle.mp3", { volume: 0.8 });
  const [playPointWin] = useSound("/sounds/point-win.mp3", { volume: 0.9 });
  const [playPointLose] = useSound("/sounds/point-lose.mp3", { volume: 0.7 });
  const [playGameWin] = useSound("/sounds/game-win.mp3", { volume: 1.0 });
  const [playShoutNow] = useSound("/sounds/shout-now.mp3", { volume: 0.6, playbackRate: 1.2 });

  const isMyTeamWinner = winner === playerTeam;

  // Confetti & fireworks
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
  }, [winner, showShuffle, card, playShoutNow]);

  useEffect(() => {
    socket.on("flashcards-race:start", (data) => {
      playShuffle();
      setShowShuffle(true);
      setCardIndex(data.cardIndex || 0);
      setTotalCards(data.totalCards || 0);
      setTimeout(() => {
        setShowShuffle(false);
        setCard(data.card);
        setWinner(null);
        setGameOver(false);
      }, 2000);
    });

    socket.on("flashcards-race:next", (data) => {
      setCardIndex(data.cardIndex);
      setCard(data.card);
      setWinner(null);
    });

    socket.on("flashcards-race:winner", (data) => {
      setWinner(data.team);
      setScores(prev => ({ ...prev, [data.team]: prev[data.team] + 10 }));

      if (data.team === playerTeam) {
        playPointWin();
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      } else {
        playPointLose();
      }
    });

    socket.on("flashcards-race:end", (data) => {
      setScores(data.finalScores);
      setGameOver(true);
      setWinner(data.winner);

      if (data.winner === playerTeam) {
        playGameWin();
        triggerVictory();
      }
    });

    return () => {
      socket.off("flashcards-race:start");
      socket.off("flashcards-race:next");
      socket.off("flashcards-race:winner");
      socket.off("flashcards-race:end");
    };
  }, [socket, playerTeam, playPointWin, playPointLose, playGameWin, playShoutNow, playShuffle]);

  if (gameOver) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900 text-white">
        <h1 className="text-9xl font-black mb-16">RACE OVER!</h1>
        <div className="text-8xl font-bold mb-8">
          {winner === "TIE" ? "IT'S A TIE!" : `TEAM ${winner} WINS!`}
        </div>
        <div className="text-7xl">
          A: {scores.A} — B: {scores.B}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 text-white">
      <div className="text-6xl font-bold mb-4">TEAM {playerTeam}</div>

      {showShuffle && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none bg-black bg-opacity-70">
          <div className="text-9xl font-black text-yellow-400 animate-bounce">
            SHUFFLING DECK...
          </div>
        </div>
      )}

      {winner && (
        <div className={`text-9xl font-black animate-bounce mb-12 ${isMyTeamWinner ? "text-green-400" : "text-red-500"}`}>
          {isMyTeamWinner ? "YOU WIN THIS POINT!" : `TEAM ${winner} WINS!`}
        </div>
      )}

      {card && (
        <div className="bg-white text-gray-900 p-16 rounded-3xl shadow-2xl max-w-4xl">
          <div className="text-8xl font-black leading-tight text-center">
            {card.question}
          </div>
        </div>
      )}

      {totalCards > 0 && (
        <div className="mt-12 text-5xl font-bold bg-black bg-opacity-60 px-12 py-6 rounded-full">
          CARD <span className="text-yellow-400">{cardIndex + 1}</span> / {totalCards}
        </div>
      )}

      <div className="mt-12 text-7xl font-bold">
        A: <span className="text-yellow-400">{scores.A}</span> — B: <span className="text-pink-400">{scores.B}</span>
      </div>

      {!winner && !showShuffle && (
        <div className="mt-12 text-6xl animate-pulse font-bold text-yellow-400">
          SHOUT NOW!
        </div>
      )}
    </div>
  );
}