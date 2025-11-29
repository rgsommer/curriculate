//student-app/src/components/tasks/types/FlashcardsTask.jsx
import React, { useEffect, useState, useRef } from "react";

export default function FlashcardsTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [currentCard, setCurrentCard] = useState(0);
  const [score, setScore] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const cards = task.cards || [];
  const card = cards[currentCard];

  // Auto-start speech recognition on card change
  useEffect(() => {
    if (!card || disabled) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang = "en-US";

    recognitionRef.current.onresult = (event) => {
      const spoken = event.results[0][0].transcript.trim().toLowerCase();
      const correct = card.answer.toLowerCase();
      const isCorrect = spoken.includes(correct) || correct.includes(spoken);

      if (isCorrect) {
        setScore(s => s + 10);
        new Audio("/sounds/correct.mp3").play();
      } else {
        new Audio("/sounds/wrong.mp3").play();
      }

      socket.emit("flashcard-answer", {
        roomCode: task.roomCode,
        cardIndex: currentCard,
        spoken,
        correct: isCorrect,
      });

      // Auto-advance
      setTimeout(() => {
        if (currentCard < cards.length - 1) {
          setCurrentCard(c => c + 1);
        } else {
          socket.emit("flashcards-complete", { roomCode: task.roomCode, score: score + (isCorrect ? 10 : 0) });
        }
      }, 1500);
    };

    recognitionRef.current.start();
    setIsListening(true);

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, [currentCard, card, disabled]);

  if (!card) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h2 className="text-6xl font-bold text-green-600">FLASHCARDS COMPLETE!</h2>
        <p className="text-4xl mt-8">Your team scored: <strong>{score}</strong> points!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="text-8xl mb-8 animate-bounce">{isListening ? "Mic" : "..." }</div>
      
      <div className="bg-white border-8 border-indigo-600 rounded-3xl p-12 shadow-2xl max-w-4xl">
        <h2 className="text-6xl font-bold text-indigo-800 mb-8">
          Card {currentCard + 1} / {cards.length}
        </h2>
        <p className="text-7xl font-bold text-gray-800 leading-tight">
          {card.question}
        </p>
      </div>

      <div className="mt-12 text-4xl">
        <span className="text-gray-600">Score: </span>
        <span className="font-bold text-green-600">{score}</span>
      </div>

      <p className="mt-8 text-3xl text-indigo-600 font-bold animate-pulse">
        SHOUT YOUR ANSWER!
      </p>
    </div>
  );
}