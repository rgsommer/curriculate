// student-app/src/components/tasks/types/MysteryCluesTask.jsx
import React, { useState, useEffect } from "react";
import VictoryScreen from "..VictoryScreen";

const CARD_EMOJIS = ["Apple", "Banana", "Cat", "Dog", "Elephant", "Frog", "Ghost", "Heart", "Ice Cream", "Joker", "Key", "Lightning", "Moon", "Pizza", "Rocket", "Sun", "Tree", "Umbrella", "Volcano", "Watermelon"];

export default function MysteryCluesTask({
  task,
  onSubmit,
  disabled,
}) {
  const [selected, setSelected] = useState([]);
  const [revealedClues, setRevealedClues] = useState(task.revealedClues || []);
  const [showResult, setShowResult] = useState(false);
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (!task.isFinal && revealedClues.length === 0 && task.clues) {
      setRevealedClues(task.clues);
      const timer = setTimeout(() => {
        setRevealedClues([]);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [task]);

  const toggleCard = (emoji) => {
    if (disabled || showResult) return;
    setSelected(prev =>
      prev.includes(emoji)
        ? prev.filter(e => e !== emoji)
        : [...prev, emoji]
    );
  };

  const handleSubmit = () => {
    if (disabled || showResult) return;
    const correct = task.clues.every(c => selected.includes(c)) &&
                    selected.every(s => task.clues.includes(s));
    setShowResult(true);
    onSubmit({ correct, selected });

    if (correct) {
      setShowVictory(true);
      new Audio("/sounds/victory.mp3").play();
      setTimeout(() => setShowVictory(false), 5000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <h2 className="text-4xl font-bold mb-6 text-purple-700">
        {task.isFinal ? "FINAL MEMORY CHALLENGE!" : "Mystery Clue Cards"}
      </h2>

      {!task.isFinal && revealedClues.length > 0 && (
        <div className="mb-8">
          <p className="text-2xl mb-4 text-indigo-600">Memorize these cards!</p>
          <div className="flex gap-6 text-8xl">
            {revealedClues.map((emoji, i) => (
              <div key={i} className="animate-bounce">{emoji}</div>
            ))}
          </div>
          <p className="mt-4 text-lg text-gray-600">They disappear in 8 seconds...</p>
        </div>
      )}

      {task.isFinal && (
        <>
          <p className="text-2xl mb-8 text-indigo-700">
            Select the <strong>{task.clues.length}</strong> cards you were shown!
          </p>

          <div className="grid grid-cols-5 gap-6 mb-10">
            {CARD_EMOJIS.slice(0, 20).map(emoji => (
              <button
                key={emoji}
                onClick={() => toggleCard(emoji)}
                disabled={disabled || showResult}
                className={`text-6xl p-6 rounded-2xl border-4 transition-all
                  ${selected.includes(emoji)
                    ? "bg-indigo-600 text-white border-indigo-800 scale-110"
                    : "bg-white border-gray-300 hover:border-indigo-400"
                  } ${showResult && task.clues.includes(emoji) ? "ring-4 ring-green-500" : ""}
                  ${showResult && selected.includes(emoji) && !task.clues.includes(emoji) ? "ring-4 ring-red-500" : ""}
                `}
              >
                {emoji}
              </button>
            ))}
          </div>

          {!showResult && (
            <button
              onClick={handleSubmit}
              disabled={disabled || selected.length === 0}
              className="px-10 py-5 text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50"
            >
              Lock In Answer (+10 Possible!)
            </button>
          )}

          {showResult && (
            <div className="text-6xl font-bold animate-pulse mt-8">
              {task.correct ? (
                <span className="text-green-600">PERFECT! +10 Bonus!</span>
              ) : (
                <span className="text-red-600">Not quite... 0 points</span>
              )}
            </div>
          )}
        </>
      )}

      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}