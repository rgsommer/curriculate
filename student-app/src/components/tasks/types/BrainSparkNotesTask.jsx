//student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect } from "react";

export default function BrainSparkNotesTask({
  task,
  onSubmit,
  disabled,
}) {
  const bullets = task.bullets || [];
  const title = task.title || "My Notes";
  const date = new Date().toLocaleDateString("en-US", { 
    weekday: "long", 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });

  useEffect(() => {
    if (task.completed) {
      new Audio("/sounds/victory.mp3").play();
    }
  }, [task.completed]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-amber-50">
      <div className="relative w-full max-w-4xl">
        {/* Notebook Paper Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-amber-100 to-amber-50 rounded-3xl shadow-2xl"></div>
        
        {/* Red margin line */}
        <div className="absolute left-20 top-0 bottom-0 w-1 bg-red-600"></div>
        
        {/* Blue horizontal lines */}
        <div className="absolute inset-0 flex flex-col justify-between px-24 py-20 pointer-events-none">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="border-t border-blue-300"></div>
          ))}
        </div>

        {/* Header: Title + Date */}
        <div className="relative z-10 pt-16 px-24 pb-8">
          <h2 className="text-5xl font-bold text-indigo-800 text-left">
            {title}
          </h2>
          <p className="text-3xl text-right text-gray-600 mt-4">
            {date}
          </p>
        </div>

        {/* Bullet Points */}
        <div className="relative z-10 px-24 pb-20 space-y-12">
          {bullets.map((bullet, i) => (
            <div key={i} className="flex items-start gap-6">
              <span className="text-5xl font-bold text-indigo-600">
                •
              </span>
              <p 
                className={`text-4xl leading-tight text-gray-800 ${
                  (task.gradeLevel && parseInt(task.gradeLevel) <= 4) 
                    ? "font-printing" 
                    : "font-handwriting"
                }`}
              >
                {bullet}
              </p>
            </div>
          ))}
        </div>

        {/* Instruction */}
        <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-yellow-400 text-black px-12 py-8 rounded-3xl shadow-2xl border-8 border-yellow-600">
            <p className="text-4xl font-bold text-center">
              WRITE THIS IN YOUR NOTEBOOK!
            </p>
            <p className="text-3xl text-center mt-4">
              +10 points for everyone!
            </p>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={() => onSubmit({ completed: true })}
        disabled={disabled}
        className="mt-12 px-20 py-10 text-5xl font-bold bg-green-600 text-white rounded-3xl hover:bg-green-700 shadow-2xl"
      >
        I Wrote It Down!
      </button>
    </div>
  );
}