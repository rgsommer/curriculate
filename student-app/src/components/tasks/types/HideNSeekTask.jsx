//student-app/src/components/tasks/types/HideNSeekTask.jsx
import React, { useState } from "react";

export default function HideNSeekTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [photo, setPhoto] = useState(null);
  const [significance, setSignificance] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isHard = task.difficulty === "HARD";

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const submit = () => {
    if (!photo || disabled || submitted) return;
    setSubmitted(true);
    onSubmit({
      photo,
      significance: isHard ? significance.trim() : null,
      completed: true,
    });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-orange-500 to-red-600">
      <h2 className="text-7xl font-bold text-white mb-8 drop-shadow-2xl">
        HIDENSEEK!
      </h2>

      <div className="bg-white rounded-3xl p-12 shadow-2xl max-w-4xl text-center">
        <p className="text-5xl font-bold text-gray-800 mb-8">
          {task.clue}
        </p>

        {!photo ? (
          <label className="cursor-pointer">
            <div className="bg-gray-200 border-8 border-dashed rounded-3xl w-96 h-96 mx-auto flex items-center justify-center">
              <p className="text-6xl text-gray-500">Camera</p>
            </div>
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
          </label>
        ) : (
          <img src={photo} alt="Found!" className="rounded-2xl max-w-full h-auto shadow-2xl" />
        )}

        {isHard && photo && (
          <div className="mt-8">
            <p className="text-4xl font-bold mb-4">Why is this important?</p>
            <textarea
              value={significance}
              onChange={e => setSignificance(e.target.value)}
              placeholder="Type your explanation..."
              className="w-full p-6 text-3xl rounded-2xl border-4 border-indigo-600"
              rows="4"
            />
          </div>
        )}

        <button
          onClick={submit}
          disabled={!photo || (isHard && !significance.trim()) || submitted}
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