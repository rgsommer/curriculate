// student-app/src/components/tasks/types/SpeedDrawTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function SpeedDrawTask({ task, onSubmit, disabled, socket, presenter }) {
  const [showWord, setShowWord] = useState(true);
  const [timeLeft, setTimeLeft] = useState(60);
  const [timerActive, setTimerActive] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const fileInputRef = useRef(null);

  const word =
    task?.word || task?.config?.word || task?.config?.prompt || "Mystery Word"; // AI-generated based on difficulty
  const difficulty = task?.difficulty || task?.config?.difficulty || "MEDIUM";

  const instructionText =
    "1) One person memorizes the word. 2) Team looks away. 3) Draw on paper. 4) Take a photo and submit.";

  useEffect(() => {
    let interval;
    if (timerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      // Optional: Alert or auto-prompt photo
      setTimeUp(true);
    }
    return () => clearInterval(interval);
  }, [timerActive, timeLeft]);

  const handleFlip = async () => {
    if (disabled || starting) return;
    setStarting(true);
    try {
      await presenter?.showCountdown?.({ title: "Drawer ready? Team look away!", mode: "video" });
    } catch (e) {
      // ignore
    }
    setShowWord(false);
    setTimerActive(true);
    setStarting(false);
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
      taskType: "speed-draw",
      type: "photo",
      photo,
      word,
      difficulty,
      timeUsed: 60 - timeLeft,
      completed: true,
      submittedAt: new Date().toISOString(),
    });
    if (socket && task?.roomCode) socket.emit("speed-draw-submitted", { roomCode: task.roomCode });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
      <div className="w-full max-w-5xl mb-6">
        <div className="rounded-2xl border border-white/30 bg-white/10 backdrop-blur px-4 py-3">
          <div className="font-extrabold text-xl mb-1">How to play</div>
          <div className="text-lg opacity-90">{instructionText}</div>
        </div>
      </div>
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
            disabled={disabled || starting}
            className="px-16 py-8 bg-red-600 text-white text-5xl font-bold rounded-full hover:bg-red-700 transition shadow-2xl"
          >
            {starting ? "GET READY…" : "MEMORIZED! START DRAWING"}
          </button>
        )}
      </div>

      {!showWord && (
        <div className="w-full max-w-4xl text-center">
          <div className="text-7xl font-bold mb-12 animate-pulse text-yellow-300">
            Time Left: {timeLeft}s
          </div>

          {timeUp && (
            <div className="mb-8 px-8 py-6 rounded-3xl bg-black/30 border border-white/20 shadow-2xl text-3xl font-extrabold">
              ⏰ Time’s up! Take a photo of your drawing.
            </div>
          )}

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