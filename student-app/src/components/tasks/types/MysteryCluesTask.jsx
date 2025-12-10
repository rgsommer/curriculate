import React, { useState, useEffect } from "react";
import VictoryScreen from "../VictoryScreen";

const CARD_EMOJIS = [
  "Apple",
  "Banana",
  "Cat",
  "Dog",
  "Elephant",
  "Frog",
  "Ghost",
  "Heart",
  "Ice Cream",
  "Joker",
  "Key",
  "Lightning",
  "Moon",
  "Pizza",
  "Rocket",
  "Sun",
  "Tree",
  "Umbrella",
  "Volcano",
  "Watermelon",
];

export default function MysteryCluesTask({ task, onSubmit, disabled }) {
  const [selected, setSelected] = useState([]);
  const [revealedClues, setRevealedClues] = useState(task.revealedClues || []);
  const [showResult, setShowResult] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(null);
  const [showVictory, setShowVictory] = useState(false);

  // Reset state and handle clue reveal whenever the task changes
  useEffect(() => {
    setSelected([]);
    setShowResult(false);
    setWasCorrect(null);
    setShowVictory(false);

    if (!task.isFinal && task.clues && task.clues.length) {
      // Show the clue cards briefly, then hide them
      setRevealedClues(task.clues);
      const timer = setTimeout(() => {
        setRevealedClues([]);
      }, 8000);
      return () => clearTimeout(timer);
    } else {
      // For final round or if no clues are provided, just use whatever is in the task
      setRevealedClues(task.revealedClues || []);
    }
  }, [task]);

  const toggleCard = (emoji) => {
    if (disabled || showResult || !task.isFinal) return;

    setSelected((prev) =>
      prev.includes(emoji)
        ? prev.filter((e) => e !== emoji)
        : [...prev, emoji]
    );
  };

  const handleSubmit = () => {
    if (disabled || showResult || !task.isFinal) return;

    const clues = Array.isArray(task.clues) ? task.clues : [];

    const correct =
      clues.length > 0 &&
      clues.every((c) => selected.includes(c)) &&
      selected.every((s) => clues.includes(s));

    setWasCorrect(correct);
    setShowResult(true);

    // Let parent know the outcome & what was selected
    onSubmit?.({ correct, selected });

    if (correct) {
      setShowVictory(true);

      try {
        const audio = new Audio("/sounds/victory.mp3");
        audio.play().catch(() => {
          // Ignore autoplay / user-gesture errors
        });
      } catch (err) {
        // Fail silently if Audio is not supported
      }

      setTimeout(() => setShowVictory(false), 5000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <h2 className="text-4xl font-bold mb-6 text-purple-700">
        {task.isFinal ? "FINAL MEMORY CHALLENGE!" : "Mystery Clue Cards"}
      </h2>

      {/* MEMORIZE PHASE (non-final) */}
      {!task.isFinal && revealedClues.length > 0 && (
        <div className="mb-8">
          <p className="text-2xl mb-4 text-indigo-600">Memorize these cards!</p>
          <div className="flex gap-6 text-4xl md:text-6xl lg:text-8xl">
            {revealedClues.map((emoji, i) => (
              <div key={i} className="animate-bounce">
                {emoji}
              </div>
            ))}
          </div>
          <p className="mt-4 text-lg text-gray-600">
            They disappear in 8 seconds...
          </p>
        </div>
      )}

      {/* FINAL CHALLENGE PHASE */}
      {task.isFinal && (
        <>
          <p className="text-2xl mb-8 text-indigo-700">
            Select the <strong>{task.clues?.length || 0}</strong> cards you were
            shown!
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 md:gap-6 mb-10">
            {CARD_EMOJIS.slice(0, 20).map((emoji) => {
              const isSelected = selected.includes(emoji);
              const isCorrectCard =
                showResult &&
                Array.isArray(task.clues) &&
                task.clues.includes(emoji);
              const isWrongPick =
                showResult &&
                isSelected &&
                (!task.clues || !task.clues.includes(emoji));

              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => toggleCard(emoji)}
                  disabled={disabled || showResult}
                  className={`text-3xl md:text-5xl lg:text-6xl p-4 md:p-6 rounded-2xl border-4 transition-all
                    ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-800 scale-110"
                        : "bg-white border-gray-300 hover:border-indigo-400"
                    }
                    ${isCorrectCard ? "ring-4 ring-green-500" : ""}
                    ${isWrongPick ? "ring-4 ring-red-500" : ""}
                  `}
                >
                  {emoji}
                </button>
              );
            })}
          </div>

          {!showResult && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || selected.length === 0}
              className="px-8 md:px-10 py-4 md:py-5 text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50"
            >
              Lock In Answer (+10 Possible!)
            </button>
          )}

          {showResult && wasCorrect !== null && (
            <div className="text-4xl md:text-5xl lg:text-6xl font-bold animate-pulse mt-8">
              {wasCorrect ? (
                <span className="text-green-600">PERFECT! +10 Bonus!</span>
              ) : (
                <span className="text-red-600">Not quite... 0 points</span>
              )}
            </div>
          )}
        </>
      )}

      {showVictory && (
        <VictoryScreen onClose={() => setShowVictory(false)} />
      )}
    </div>
  );
}
