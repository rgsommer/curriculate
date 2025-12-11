// student-app/src/components/tasks/types/HideNSeekTask.jsx
import React, { useState, useRef } from "react";

export default function HideNSeekTask({ task, onSubmit, disabled }) {
  const [photo, setPhoto] = useState(null);
  const [significance, setSignificance] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  // Teacher-facing prompt: "Find X and explain why it's important"
  const prompt =
    task.prompt || "Find the textbook reference and snap a photo!";

  // Teacher-facing page/location reference, saved with the taskset
  const pageReference =
    task?.config?.pageReference ||
    task?.config?.pageRef ||
    task?.pageReference ||
    "";

  const isHard = task.difficulty === "HARD";

  const handleTakePhoto = () => {
    if (disabled || submitted) return;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!photo || disabled || submitted || !significance.trim()) return;

    setSubmitted(true);

    onSubmit?.({
      photo,
      significance: significance.trim(),
      completed: true,
    });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 md:p-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
      <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 md:mb-10 drop-shadow-2xl animate-pulse text-center">
        HIDE &apos;N SEEK!
      </h1>

      <div className="text-center w-full max-w-5xl mb-10 md:mb-14">
        <p className="text-2xl md:text-4xl lg:text-5xl font-bold mb-4 md:mb-6">
          {prompt}
        </p>

        {pageReference && (
          <p className="text-xl md:text-3xl lg:text-4xl mb-6 md:mb-8 text-yellow-200 font-semibold">
            Look here:{" "}
            <span className="font-extrabold underline decoration-yellow-300">
              {pageReference}
            </span>
          </p>
        )}

        <button
          onClick={handleTakePhoto}
          disabled={disabled || submitted}
          className={`px-8 md:px-16 py-4 md:py-6 bg-blue-600 text-white text-2xl md:text-4xl lg:text-5xl font-bold rounded-full transition shadow-2xl mb-6 md:mb-8 ${
            disabled || submitted
              ? "opacity-60 cursor-not-allowed"
              : "hover:bg-blue-700"
          }`}
        >
          Take Photo of Page
        </button>

        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={fileInputRef}
          onChange={handlePhotoChange}
          className="hidden"
        />

        {photo && (
          <div className="mb-6 md:mb-8">
            <img
              src={photo}
              alt="Textbook page"
              className="max-h-[50vh] max-w-full mx-auto rounded-2xl shadow-2xl border-4 border-white/40 object-contain"
            />
          </div>
        )}

        <p className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
          Explain its significance:
        </p>
        <p className="text-base md:text-lg mb-3 md:mb-4 text-blue-100">
          Tell us <span className="font-semibold">why this page or picture is
          important</span> for what you&apos;re learning.
        </p>

        <textarea
          value={significance}
          onChange={(e) => setSignificance(e.target.value)}
          placeholder="Why is this important? What does it show or explain?"
          className="w-full max-w-4xl p-4 md:p-6 text-lg md:text-2xl rounded-2xl bg-white/20 backdrop-blur-lg border-2 md:border-4 border-indigo-300 focus:border-indigo-100 focus:outline-none text-white placeholder-gray-300"
          rows={4}
          disabled={disabled || submitted}
        />

        <button
          onClick={submit}
          disabled={!photo || !significance.trim() || disabled || submitted}
          className={`mt-8 md:mt-10 px-10 md:px-16 lg:px-20 py-4 md:py-6 lg:py-8 text-3xl md:text-5xl lg:text-6xl font-bold rounded-3xl shadow-2xl ${
            !photo || !significance.trim() || disabled || submitted
              ? "bg-green-700/50 cursor-not-allowed opacity-60"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {submitted ? "SUBMITTED!" : "I FOUND IT!"}
        </button>

        {submitted && (
          <p className="mt-6 md:mt-8 text-4xl md:text-5xl lg:text-6xl font-bold text-yellow-300 animate-bounce drop-shadow-lg">
            +{isHard ? "20" : "10"} POINTS!
          </p>
        )}
      </div>
    </div>
  );
}
