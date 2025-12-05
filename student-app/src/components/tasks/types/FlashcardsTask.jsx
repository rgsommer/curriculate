// student-app/src/components/tasks/types/FlashcardsTask.jsx
import React, { useEffect, useState, useRef } from "react";

export default function FlashcardsTask({
  task,
  onSubmit,
  disabled,
  socket,
  playerTeam, // "A" or "B" — passed from session
}) {
  const [currentCard, setCurrentCard] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [answered, setAnswered] = useState(false); // prevent double-answer
  const [winner, setWinner] = useState(null); // "A", "B", or null
  const [teamScores, setTeamScores] = useState({ A: 0, B: 0 });

  const cards = task.cards || [];
  const card = cards[currentCard];

  const recognitionRef = useRef(null);

  // Listen for race events from server
  useEffect(() => {
    if (!socket) return;

    socket.on("flashcard:winner", ({ team, points }) => {
      setWinner(team);
      setTeamScores(prev => ({ ...prev, [team]: prev[team] + points }));
      setAnswered(true);
      setIsListening(false);
    });

    socket.on("flashcard:next", ({ cardIndex }) => {
      setCurrentCard(cardIndex);
      setWinner(null);
      setAnswered(false);
    });

    socket.on("flashcards:complete", ({ finalScores }) => {
      setTeamScores(finalScores);
    });

    return () => {
      socket.off("flashcard:winner");
      socket.off("flashcard:next");
      socket.off("flashcards:complete");
    };
  }, [socket]);

  // Start speech recognition when card changes
  useEffect(() => {
    if (!card || disabled || answered || winner) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = task.language || "en-US";

    recognition.onresult = (event) => {
      if (answered || winner) return;

      const spoken = event.results[0][0].transcript.trim();
      const correct = card.answer.toLowerCase().trim();
      const confidence = event.results[0][0].confidence;

      // Strong match required
      const isCorrect = spoken.toLowerCase().includes(correct) || 
                        correct.includes(spoken.toLowerCase()) ||
                        spoken.toLowerCase().split(" ").some(word => correct.includes(word));

      if (isCorrect && confidence > 0.7) {
        // First team to answer correctly wins!
        socket.emit("flashcard:answer", {
          roomCode: task.roomCode,
          cardIndex: currentCard,
          team: playerTeam,
          spoken,
          correct: true,
        });

        setIsListening(false);
      }
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [currentCard, card, disabled, answered, winner, socket, task.roomCode, playerTeam]);

  if (!card) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-gradient-to-b from-indigo-900 to-purple-900 text-white">
        <h1 className="text-8xl font-bold mb-8 animate-pulse">FLASHCARDS COMPLETE!</h1>
        <div className="text-6xl space-y-6">
          <p>Team A: <strong className="text-yellow-400">{teamScores.A}</strong> points</p>
          <p>Team B: <strong className="text-pink-400">{teamScores.B}</strong> points</p>
        </div>
        <div className="mt-12 text-7xl font-bold">
          {teamScores.A > teamScores.B ? "Team A WINS!" : teamScores.B > teamScores.A ? "Team B WINS!" : "IT'S A TIE!"}
        </div>
      </div>
    );
  }

  const isMyTeamWinner = winner === playerTeam;

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-gradient-to-br from-indigo-800 via-purple-800 to-pink-800 text-white">
      {/* Scoreboard */}
      <div className="absolute top-8 left-1/2 transform -translate-x-1/2 flex gap-16 text-5xl font-bold">
        <div className={`px-8 py-4 rounded-2xl ${playerTeam === "A" ? "bg-yellow-500" : "bg-gray-700"}`}>
          A: {teamScores.A}
        </div>
        <div className={`px-8 py-4 rounded-2xl ${playerTeam === "B" ? "bg-pink-500" : "bg-gray-700"}`}>
          B: {teamScores.B}
        </div>
      </div>

      {/* Winner Flash */}
      {winner && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className={`text-9xl font-black animate-bounce ${isMyTeamWinner ? "text-green-400" : "text-red-500"}`}>
            {isMyTeamWinner ? "YOUR TEAM SCORED!" : `TEAM ${winner} SCORED!`}
          </div>
        </div>
      )}

      {/* Card */}
      <div className="relative">
        <div className="text-9xl mb-12 animate-pulse">
          {isListening ? "Microphone" : "Ear"}
        </div>

        <div className="bg-white text-gray-900 border-8 border-yellow-400 rounded-3xl p-16 shadow-2xl max-w-5xl transform hover:scale-105 transition-transform">
          <div className="text-5xl font-bold text-indigo-700 mb-6">
            Card {currentCard + 1} / {cards.length}
          </div>
          <div className="text-8xl font-black leading-tight">
            {card.question}
          </div>
        </div>

        {/* Listening Indicator */}
        {isListening && !winner && (
          <div className="mt-12 text-6xl font-bold text-green-400 animate-pulse">
            LISTENING... SHOUT NOW!
          </div>
        )}
      </div>

      {/* Your Team */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-5xl font-bold bg-black bg-opacity-70 px-12 py-6 rounded-full">
        YOU ARE TEAM <span className={playerTeam === "A" ? "text-yellow-400" : "text-pink-400"}>{playerTeam}</span>
      </div>
    </div>
  );
}