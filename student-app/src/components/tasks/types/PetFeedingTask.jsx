import React, { useState, useEffect } from "react";

const ANIMAL_PACKS = {
  classic: {
    name: "Classic Pets",
    animals: [
      {
        type: "dog",
        emoji: "🐶",
        name: "Dog",
        hungry: "I'm starving!",
        thanks: "Woof! Thanks!",
      },
      {
        type: "cat",
        emoji: "🐱",
        name: "Cat",
        hungry: "Meow... feed me?",
        thanks: "Purrrfect!",
      },
      {
        type: "bunny",
        emoji: "🐰",
        name: "Bunny",
        hungry: "Nom nom?",
        thanks: "Hop hop happy!",
      },
    ],
  },
  farm: {
    name: "Farm Friends",
    animals: [
      {
        type: "cow",
        emoji: "🐮",
        name: "Cow",
        hungry: "Moo! Grass?",
        thanks: "Moooo!",
      },
      {
        type: "pig",
        emoji: "🐷",
        name: "Pig",
        hungry: "Oink! Slop?",
        thanks: "Oink oink!",
      },
      {
        type: "chicken",
        emoji: "🐔",
        name: "Chicken",
        hungry: "Cluck cluck!",
        thanks: "Bawk bawk!",
      },
    ],
  },
  ocean: {
    name: "Sea Creatures",
    animals: [
      {
        type: "dolphin",
        emoji: "🐬",
        name: "Dolphin",
        hungry: "Eeee! Fish?",
        thanks: "Eeeeee!",
      },
      {
        type: "octopus",
        emoji: "🐙",
        name: "Octopus",
        hungry: "Blub blub!",
        thanks: "🫧",
      },
      {
        type: "shark",
        emoji: "🦈",
        name: "Shark",
        hungry: "Rawr! Meat?",
        thanks: "CHOMP!",
      },
    ],
  },
  dino: {
    name: "DINOSAURS!",
    animals: [
      {
        type: "trex",
        emoji: "🦖",
        name: "T-Rex",
        hungry: "ROOOOAR!",
        thanks: "ROAR!!!",
      },
      {
        type: "triceratops",
        emoji: "🦕",
        name: "Triceratops",
        hungry: "Huff huff!",
        thanks: "Stomp stomp!",
      },
      {
        type: "raptor",
        emoji: "🦤",
        name: "Velociraptor",
        hungry: "Screech!",
        thanks: "Clever girl...",
      },
    ],
  },
  fantasy: {
    name: "Mythical Beasts",
    animals: [
      {
        type: "dragon",
        emoji: "🐉",
        name: "Dragon",
        hungry: "Fire... hungry...",
        thanks: "ROAR! 🔥",
      },
      {
        type: "unicorn",
        emoji: "🦄",
        name: "Unicorn",
        hungry: "Neigh! Magic?",
        thanks: "✨",
      },
      {
        type: "phoenix",
        emoji: "🦅",
        name: "Phoenix",
        hungry: "Caw! Ashes?",
        thanks: "REBORN!",
      },
    ],
  },
};

const TREATS = ["🍖", "🥕", "🍪", "🍗", "🐟", "🍕", "🥦", "🍩"];

function pickRandomAnimal(pack) {
  const animals = pack.animals || [];
  if (!animals.length) return null;
  const index = Math.floor(Math.random() * animals.length);
  return animals[index];
}

export default function PetFeedingTask({ task, onSubmit, disabled }) {
  const packKey = task.pack || "classic"; // AI or teacher chooses
  const pack = ANIMAL_PACKS[packKey] || ANIMAL_PACKS.classic;

  // Keep the chosen animal stable across renders
  const [animal, setAnimal] = useState(() => pickRandomAnimal(pack));
  const [chosenTreat, setChosenTreat] = useState(null);
  const [fed, setFed] = useState(false);

  // When the task or pack changes (new station, new round, etc.), reset
  useEffect(() => {
    setAnimal(pickRandomAnimal(pack));
    setChosenTreat(null);
    setFed(false);
  }, [packKey, task?.id]);

  // Play a happy sound once the pet is fed
  useEffect(() => {
    if (!fed) return;
    try {
      const audio = new Audio("/sounds/yay.mp3");
      // Ignore promise rejections if autoplay is blocked
      audio.play().catch(() => {});
    } catch {
      // fail silently if Audio is not available
    }
  }, [fed]);

  const feed = (treat) => {
    if (fed || disabled) return;
    if (!animal) return;

    setChosenTreat(treat);
    setFed(true);

    // Give a brief celebration before completing the task
    setTimeout(() => {
      if (typeof onSubmit === "function") {
        onSubmit({
          treat,
          animal: animal.type,
          pack: packKey,
        });
      }
    }, 2000);
  };

  if (!animal) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-xl text-red-600">
          No animals found for this pack.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-sky-300 to-green-300 p-8">
      <h2 className="mb-4 text-6xl font-bold text-white drop-shadow-lg">
        {pack.name.toUpperCase()}
      </h2>

      <div className="mb-8 text-9xl animate-bounce">{animal.emoji}</div>

      <p className="mb-12 text-5xl font-bold text-white drop-shadow-lg">
        {fed ? animal.thanks : animal.hungry}
      </p>

      {!fed ? (
        <div className="grid grid-cols-4 gap-8">
          {TREATS.map((treat, i) => (
            <button
              key={i}
              type="button"
              onClick={() => feed(treat)}
              disabled={disabled}
              className="transform rounded-3xl bg-white p-8 text-8xl shadow-2xl transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {treat}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-8xl animate-pulse">{chosenTreat}</div>
      )}

      {fed && (
        <p className="mt-12 text-6xl font-bold text-yellow-300 animate-bounce">
          +10 POINTS! {animal.name} IS HAPPY!
        </p>
      )}
    </div>
  );
}
