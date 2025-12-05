// student-app/src/components/tasks/types/HideNSeekTask.jsx
import React, { useState, useRef } from "react";

export default function HideNSeekTask({
  task,
  onSubmit,
  disabled,
}) {
  const [photo, setPhoto] = useState(null);
  const [significance, setSignificance] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  const prompt = task.prompt || "Find the textbook reference and snap a photo!";
  const isHard = task.difficulty === "HARD";

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

  const submit = () => {
    if (!photo || disabled || submitted || !significance.trim()) return;
    setSubmitted(true);
    onSubmit({
      photo,
      significance: significance.trim(),
      completed: true,
    });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
      <h1 className="text-8xl font-black mb-12 drop-shadow-2xl animate-pulse">HIDE 'N SEEK!</h1>

      <div className="text-center max-w-5xl mb-16">
        <p className="text-5xl font-bold mb-8">{prompt}</p>
        
        <button
          onClick={handleTakePhoto}
          disabled={disabled || submitted}
          className="px-16 py-8 bg-blue-600 text-white text-5xl font-bold rounded-full hover:bg-blue-700 transition shadow-2xl mb-8"
        >
          Take Photo of Page
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
              alt="Textbook page"
              className="max-w-xl mx-auto rounded-2xl shadow-2xl"
            />
          </div>
        )}

        <p className="text-4xl font-bold mb-4">Explain its significance:</p>
        <textarea
          value={significance}
          onChange={(e) => setSignificance(e.target.value)}
          placeholder="Why is this important? What does it mean?"
          className="w-full max-w-4xl p-6 text-3xl rounded-2xl bg-white/20 backdrop-blur-lg border-4 border-indigo-600 text-white placeholder-gray-300"
          rows="5"
          disabled={disabled || submitted}
        />

        <button
          onClick={submit}
          disabled={!photo || !significance.trim() || disabled || submitted}
          className="mt-12 px-20 py-10 text-6xl font-bold bg-green-600 text-white rounded-3xl hover:bg-green-700 disabled:opacity-50 shadow-2xl"
        >
          {submitted ? "SUBMITTED!" : "I FOUND IT!"}
        </button>

        {submitted && (
          <p className="mt-8 text-7xl font-bold text-yellow-400 animate-bounce">
            +{isHard ? "20" : "10"} POINTS!
          </p>
        )}
      </div>
    </div>
  );
}