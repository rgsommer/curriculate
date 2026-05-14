// student-app/src/components/tasks/types/HideNSeekTask.jsx
import React, { useState, useRef } from "react";

export default function HideNSeekTask({ task, onSubmit, disabled }) {
  const [photo, setPhoto] = useState(null);
  const [significance, setSignificance] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  // Sentence counter: enables "I FOUND IT" after 2+ sentences.
  // (Simple and kid-proof: counts . ! ? plus common abbreviations are ignored best-effort.)
  const countSentences = (text) => {
    const t = String(text || "").trim();
    if (!t) return 0;
    // Remove a few common abbreviations so we don't over-count.
    const scrubbed = t
      .replace(/\b(e\.g|i\.e|mr|mrs|ms|dr)\./gi, "$1")
      .replace(/\.{2,}/g, ".");
    const matches = scrubbed.match(/[^.!?]+[.!?]+/g);
    // If they ended without punctuation but have a decent chunk of text, count it as a sentence.
    const hasTrailing = /[^.!?]{12,}$/.test(scrubbed);
    return (matches ? matches.length : 0) + (hasTrailing ? 1 : 0);
  };

  // Teacher-facing prompt: "Find X and explain why it's important"
  // (Make it crystal clear the *teacher/presenter* is giving the clue.)
  const prompt =
    task.prompt ||
    task?.config?.prompt ||
    "Find the hidden vocabulary words related to our current unit. Use the clues provided by your teacher to uncover the words.";

  const clueSource =
    task?.config?.clueSource ||
    task?.config?.cluesSource ||
    task?.clueSource ||
    "your teacher";

  const clues =
    (Array.isArray(task?.config?.clues) && task.config.clues) ||
    (Array.isArray(task?.clues) && task.clues) ||
    [];

  // Teacher-facing page/location reference, saved with the taskset.
  // No hard default any more — the previous fallback ("Page 212,
  // Figure 2.3 in your textbook.") sent practice users home without
  // their textbook on a wild goose chase.  Tester Yuvraj: "I don't
  // have my textbook at home."  When unset the location pill is
  // simply omitted and the prompt + clues carry the task.
  const pageReference =
    task?.config?.pageReference ||
    task?.config?.pageRef ||
    task?.pageReference ||
    "";

  const isHard = task.difficulty === "HARD";

  const takePhotoBtnClass =
    "px-8 md:px-16 py-4 md:py-6 bg-blue-600 text-white text-2xl md:text-4xl lg:text-5xl font-bold rounded-full transition shadow-2xl mb-6 md:mb-8 " +
    (disabled || submitted ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700");

  const submitBtnClass =
    "mt-8 md:mt-10 px-10 md:px-16 lg:px-20 py-4 md:py-6 lg:py-8 text-3xl md:text-5xl lg:text-6xl font-bold rounded-3xl shadow-2xl " +
    (!photo || countSentences(significance) < 2 || disabled || submitted
      ? "bg-green-700/50 cursor-not-allowed opacity-60"
      : "bg-green-600 hover:bg-green-700");

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
    if (!photo || disabled || submitted || countSentences(significance) < 2) return;

    setSubmitted(true);

    onSubmit?.({
      photo,
      significance: significance.trim(),
      completed: true,
    });
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full p-6 md:p-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white overflow-hidden">
      {/* soft background accents */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-28 w-96 h-96 rounded-full bg-black/10 blur-2xl" />
      <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 md:mb-10 drop-shadow-2xl animate-pulse text-center">
        HIDE &apos;N SEEK!
      </h1>

      <div className="text-center w-full max-w-5xl mb-10 md:mb-14">
        {/* Teacher clue card */}
        <div className="mx-auto w-full max-w-5xl rounded-3xl bg-white/15 backdrop-blur-xl border border-white/20 shadow-2xl p-6 md:p-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="text-4xl md:text-5xl">🕵️‍♂️</div>
            <div className="text-xl md:text-2xl font-extrabold tracking-wide text-white/95">
              Teacher Clue
            </div>
          </div>

          <p className="text-2xl md:text-4xl lg:text-5xl font-black drop-shadow mb-2">
            {prompt}
          </p>

          <p className="text-base md:text-lg text-white/80 font-semibold">
            Use the clues from <span className="font-extrabold underline decoration-white/40">{clueSource}</span> (often written on the board or spoken aloud).
          </p>

          {clues.length > 0 && (
            <div className="mt-5 text-left">
              <div className="text-sm md:text-base font-extrabold text-white/90 uppercase tracking-wider">
                Clues
              </div>
              <ul className="mt-2 space-y-2">
                {clues.slice(0, 8).map((c, i) => (
                  <li
                    key={i}
                    className="flex gap-3 items-start rounded-2xl bg-black/10 border border-white/10 px-4 py-3"
                  >
                    <span className="text-xl">🔎</span>
                    <span className="text-lg md:text-xl font-bold text-white/90">
                      {String(c).trim()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {pageReference && (
          <div className="mt-6 mb-4 md:mb-6 inline-flex items-center gap-3 px-5 py-3 rounded-full bg-yellow-300/20 border border-yellow-200/30 shadow">
            <span className="text-2xl">📍</span>
            <p className="text-xl md:text-3xl lg:text-4xl text-yellow-100 font-extrabold">
              Look here: <span className="underline decoration-yellow-300">{pageReference}</span>
            </p>
          </div>
        )}

        <button
          onClick={handleTakePhoto}
          disabled={disabled || submitted}
          className={takePhotoBtnClass}
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

        <div className="mt-6 w-full max-w-4xl mx-auto rounded-3xl bg-white/10 backdrop-blur-xl border border-white/15 shadow-2xl p-5 md:p-7">
          <p className="text-2xl md:text-3xl lg:text-4xl font-black mb-2">
            Explain its significance
          </p>
          <p className="text-base md:text-lg mb-4 text-blue-100 font-semibold">
            In 2–4 sentences: what did you find, and why does it matter for this unit?
          </p>

          <textarea
            value={significance}
            onChange={(e) => setSignificance(e.target.value)}
            placeholder="Example: This page defines ____. It matters because ____. It connects to our unit by ____."
            className="w-full p-4 md:p-6 text-lg md:text-2xl rounded-2xl bg-white text-slate-900 placeholder-slate-400 border-2 md:border-4 border-indigo-200 focus:border-indigo-400 focus:outline-none shadow-inner"
            rows={4}
            disabled={disabled || submitted}
          />

          <div className="mt-3 flex items-center justify-between text-sm md:text-base text-white/90 font-bold">
            <div>
              Sentences: <span className="font-black">{countSentences(significance)}</span> (need 2–4)
            </div>
            <div className="text-white/80">
              Tip: End sentences with <span className="font-black">.</span> or <span className="font-black">!</span>
            </div>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!photo || countSentences(significance) < 2 || disabled || submitted}
          className={submitBtnClass}
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
