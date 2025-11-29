//student-app/src/components/tasks/types/PetFeedingTask.jsx
import React, { useState, useEffect } from "react";

const ANIMAL_PACKS = {
  classic: {
    name: "Classic Pets",
    animals: [
      { type: "dog", emoji: "🐶", name: "Dog", hungry: "I'm starving!", thanks: "Woof! Thanks!" },
      { type: "cat", emoji: "🐱", name: "Cat", hungry: "Meow... feed me?", thanks: "Purrrfect!" },
      { type: "bunny", emoji: "🐰", name: "Bunny", hungry: "Nom nom?", thanks: "Hop hop happy!" },
    ],
  },
  farm: {
    name: "Farm Friends",
    animals: [
      { type: "cow", emoji: "🐮", name: "Cow", hungry: "Moo! Grass?", thanks: "Moooo!" },
      { type: "pig", emoji: "🐷", name: "Pig", hungry: "Oink! Slop?", thanks: "Oink oink!" },
      { type: "chicken", emoji: "🐔", name: "Chicken", hungry: "Cluck cluck!", thanks: "Bawk bawk!" },
    ],
  },
  ocean: {
    name: "Sea Creatures",
    animals: [
      { type: "dolphin", emoji: "🐬", name: "Dolphin", hungry: "Eeee! Fish?", thanks: "Eeeeee!" },
      { type: "octopus", emoji: "🐙", name: "Octopus", hungry: "Blub blub!", thanks: "🫧" },
      { type: "shark", emoji: "🦈", name: "Shark", hungry: "Rawr! Meat?", thanks: "CHOMP!" },
    ],
  },
  dino: {
    name: "DINOSAURS!",
    animals: [
      { type: "trex", emoji: "🦖", name: "T-Rex", hungry: "ROOOOAR!", thanks: "ROAR!!!" },
      { type: "triceratops", emoji: "🦕", name: "Triceratops", hungry: "Huff huff!", thanks: "Stomp stomp!" },
      { type: "raptor", emoji: "🦤", name: "Velociraptor", hungry: "Screech!", thanks: "Clever girl..." },
    ],
  },
  fantasy: {
    name: "Mythical Beasts",
    animals: [
      { type: "dragon", emoji: "🐉", name: "Dragon", hungry: "Fire... hungry...", thanks: "ROAR! 🔥" },
      { type: "unicorn", emoji: "🦄", name: "Unicorn", hungry: "Neigh! Magic?", thanks: "✨" },
      { type: "phoenix", emoji: "🦅", name: "Phoenix", hungry: "Caw! Ashes?", thanks: "REBORN!" },
    ],
  },
};

const TREATS = ["🍖", "🥕", "🍪", "🍗", "🐟", "🍕", "🥦", "🍩"];

export default function PetFeedingTask({
  task,
  onSubmit,
  disabled,
}) {
  const packKey = task.pack || "classic"; // AI or teacher chooses
  const pack = ANIMAL_PACKS[packKey] || ANIMAL_PACKS.classic;
  const animal = pack.animals[Math.floor(Math.random() * pack.animals.length)];

  const [chosenTreat, setChosenTreat] = useState(null);
  const [fed, setFed] = useState(false);

  useEffect(() => {
    if (fed) new Audio("/sounds/yay.mp3").play();
  }, [fed]);

  const feed = (treat) => {
    if (fed || disabled) return;
    setChosenTreat(treat);
    setFed(true);
    setTimeout(() => {
      onSubmit({ treat, animal: animal.type, pack: packKey });
    }, 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-b from-sky-300 to-green-300">
      <h2 className="text-6xl font-bold text-white mb-4 drop-shadow-lg">
        {pack.name.toUpperCase()}
      </h2>

      <div className="text-9xl mb-8 animate-bounce">
        {animal.emoji}
      </div>

      <p className="text-5xl font-bold text-white mb-12 drop-shadow-lg">
        {fed ? animal.thanks : animal.hungry}
      </p>

      {!fed ? (
        <div className="grid grid-cols-4 gap-8">
          {TREATS.map((treat, i) => (
            <button
              key={i}
              onClick={() => feed(treat)}
              className="text-8xl p-8 bg-white rounded-3xl shadow-2xl hover:scale-110 transition transform"
            >
              {treat}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-8xl animate-pulse">
          {chosenTreat}
        </div>
      )}

      {fed && (
        <p className="mt-12 text-6xl font-bold text-yellow-300 animate-bounce">
          +10 POINTS! {animal.name} IS HAPPY!
        </p>
      )}
    </div>
  );
}