// student-app/src/components/tasks/types/SpeedDrawTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function SpeedDrawTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [showWord, setShowWord] = useState(true);
  const [timeLeft, setTimeLeft] = useState(60);
  const [timerActive, setTimerActive] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  const word = task.word || "Mystery Word"; // AI-generated based on difficulty
  const difficulty = task.difficulty || "MEDIUM";

  useEffect(() => {
    let interval;
    if (timerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      // Optional: Alert or auto-prompt photo
      alert("Time's up! Take a photo of your drawing.");
    }
    return () => clearInterval(interval);
  }, [timerActive, timeLeft]);

  const handleFlip = () => {
    setShowWord(false);
    setTimerActive(true);
  };

  const handleTakePhoto = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = () => {
    if (!photo || disabled || submitted) return;
    setSubmitted(true);
    onSubmit({
      photo,
      word,
      difficulty,
      timeUsed: 60 - timeLeft,
      completed: true,
    });
    socket.emit("speed-draw-submitted", { roomCode: task.roomCode });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
      <h1 className="text-8xl font-black mb-12 drop-shadow-2xl animate-pulse">SPEED DRAW!</h1>

      <div className="text-center max-w-5xl mb-16">
        <p className="text-5xl font-bold mb-8">Drawer: Memorize the word! Team: Look away!</p>
        
        {showWord ? (
          <div className="bg-white/20 backdrop-blur-lg rounded-3xl p-16 shadow-2xl mb-8">
            <p className="text-9xl font-bold text-yellow-300 leading-tight">
              {word}
            </p>
            <p className="text-4xl mt-4 text-gray-200">(Difficulty: {difficulty})</p>
          </div>
        ) : (
          <div className="bg-white/20 backdrop-blur-lg rounded-3xl p-16 shadow-2xl mb-8">
            <p className="text-9xl font-bold text-gray-300 leading-tight">
              HIDDEN
            </p>
          </div>
        )}

        {showWord && (
          <button
            onClick={handleFlip}
            disabled={disabled}
            className="px-16 py-8 bg-red-600 text-white text-5xl font-bold rounded-full hover:bg-red-700 transition shadow-2xl"
          >
            MEMORIZED! START DRAWING
          </button>
        )}
      </div>

      {!showWord && (
        <div className="w-full max-w-4xl text-center">
          <div className="text-7xl font-bold mb-12 animate-pulse text-yellow-300">
            Time Left: {timeLeft}s
          </div>

          <p className="text-5xl font-bold mb-8">Draw on paper! Team: Guess!</p>

          <button
            onClick={handleTakePhoto}
            disabled={disabled || submitted}
            className="px-16 py-8 bg-blue-600 text-white text-5xl font-bold rounded-full hover:bg-blue-700 transition shadow-2xl mb-8"
          >
            Take Photo of Drawing
          </button>

          <input
            type="file"
            accept="image/*"
            capture="camera"
            ref={fileInputRef}
            onChange={handlePhotoChange}
            className="hidden"
          />

          {photo && (
            <div className="mb-8">
              <img
                src={photo}
                alt="Your drawing"
                className="max-w-xl mx-auto rounded-2xl shadow-2xl"
              />
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!photo || disabled || submitted}
            className="px-20 py-10 text-6xl font-bold bg-green-600 text-white rounded-3xl hover:bg-green-700 disabled:opacity-50 shadow-2xl"
          >
            {submitted ? "SUBMITTED!" : "SUBMIT DRAWING"}
          </button>

          {submitted && (
            <p className="mt-8 text-7xl font-bold text-yellow-400 animate-bounce">
              +{difficulty === "HARD" ? "20" : "10"} POINTS!
            </p>
          )}
        </div>
      )}
    </div>
  );
}