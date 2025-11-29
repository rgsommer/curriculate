//student-app/src/components/tasks/types/PetFeedingTask.jsx
import React, { useState, useEffect } from "react";

const PETS = {
  dog: { name: "Dog", emoji: "Dog Face", hungry: "I'm starving!", thanks: "Woof! Thanks!" },
  cat: { name: "Cat", emoji: "Cat Face", hungry: "Meow... feed me?", thanks: "Purrrfect!" },
  dragon: { name: "Dragon", emoji: "Dragon", hungry: "I breathe fire when hungry!", thanks: "ROAR! Delicious!" },
};

const TREATS = ["Bone", "Fish", "Pizza", "Cookie", "Chicken", "Carrot"];

export default function PetFeedingTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [chosenTreat, setChosenTreat] = useState(null);
  const [fed, setFed] = useState(false);
  const pet = PETS[task.petType || "dog"];
  const treats = task.treats || TREATS.map(t => ({ name: t, correct: Math.random() > 0.5 }));

  useEffect(() => {
    if (fed) {
      new Audio("/sounds/yay.mp3").play();
    }
  }, [fed]);

  const feedPet = (treat) => {
    if (disabled || fed) return;
    setChosenTreat(treat);
    setFed(true);
    setTimeout(() => {
      onSubmit({ treat: treat.name, correct: treat.correct });
    }, 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-sky-200 to-sky-400">
      <h2 className="text-6xl font-bold mb-8 text-white drop-shadow-lg">
        FEED THE PET!
      </h2>

      <div className="text-9xl mb-8 animate-bounce">
        {pet.emoji}
      </div>

      <p className="text-4xl font-bold text-white mb-12 drop-shadow">
        {fed ? pet.thanks : pet.hungry}
      </p>

      {!fed ? (
        <div className="grid grid-cols-3 gap-8">
          {treats.map((treat, i) => (
            <button
              key={i}
              onClick={() => feedPet(treat)}
              disabled={disabled}
              className="text-8xl p-8 bg-white rounded-3xl shadow-2xl hover:scale-110 transition transform active:scale-95"
            >
              {treat.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-8xl animate-pulse">
          {chosenTreat.correct ? "Happy" : "Confused"}
        </div>
      )}

      {fed && (
        <p className="mt-12 text-5xl font-bold text-white">
          +10 points! Great job!
        </p>
      )}
    </div>
  );
} 