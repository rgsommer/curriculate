// student-app/src/components/tasks/types/SpeedDrawTask.jsx
//
// Speed Draw — single device, "secret word" Pictionary-style task.
//
// Flow (rewritten per tester feedback — old flow showed the word to the
// whole team upfront with a useless "look away" instruction):
//
//   1. PICK_DRAWER — choose who's drawing (defaults to first member).
//   2. SECRET — word stays HIDDEN until the chosen drawer presses-and-
//      holds the "Hold to peek" button.  Releasing hides it again.
//      The drawer taps "Got it — start drawing" when ready.
//   3. DRAWING — word stays hidden; timer counts down; drawer draws on
//      paper; team can guess aloud.
//   4. REVEAL — timer ends (or drawer taps "Done").  Word revealed to
//      everyone.  Team taps which member guessed correctly (or "no one
//      got it").  Optional photo upload of the drawing.
//   5. SUBMIT.
//
// Falls back gracefully when no member names are supplied.

import React, { useState, useEffect, useRef } from "react";
import { getPlayerName } from "../../../utils/playerName";
import StepCircle from "../StepCircle";

const PHASE = {
  PICK_DRAWER: "pick-drawer",
  SECRET:      "secret",
  DRAWING:     "drawing",
  REVEAL:      "reveal",
  DONE:        "done",
};

export default function SpeedDrawTask({
  task,
  onSubmit,
  disabled,
  socket,
  presenter,
  memberNames = [],
  practiceMode = false,
}) {
  const word =
    task?.word || task?.config?.word || task?.config?.prompt || "Mystery Word";
  const difficulty = task?.difficulty || task?.config?.difficulty || "MEDIUM";
  const totalSeconds = Math.max(15, Number(task?.timeLimitSeconds || task?.config?.timeLimitSeconds) || 60);

  // Pad practice mode with bogus team-mates so the drawer/guesser
  // flow has names attached.  Tester: 'add fake names in practice
  // mode so it will be more like the real task'.
  const PRACTICE_BOTS = ["Riley", "Quinn", "Avery", "Sam"];
  const safeMembers = (() => {
    const real = (Array.isArray(memberNames) ? memberNames : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean);
    if (practiceMode && real.length < 3) {
      const me = real[0] || getPlayerName();
      return [me, ...PRACTICE_BOTS.slice(0, 3).map((b) => `${b} (bot)`)];
    }
    return real;
  })();
  const hasNames = safeMembers.length > 0;

  // Phase + per-phase state
  const [phase, setPhase] = useState(hasNames ? PHASE.PICK_DRAWER : PHASE.SECRET);
  const [drawerIdx, setDrawerIdx] = useState(0);
  const drawerName = safeMembers[drawerIdx] || "Drawer";

  const [pressing, setPressing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);
  const [photo, setPhoto] = useState(null);
  const [guesser, setGuesser] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef(null);

  /* ------------------------------------------------------------------ */
  /*  Timer (only ticks during DRAWING phase)                           */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (phase !== PHASE.DRAWING) return;
    if (timeLeft <= 0) {
      setPhase(PHASE.REVEAL);
      return;
    }
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [phase, timeLeft]);

  /* ------------------------------------------------------------------ */
  /*  Photo upload                                                      */
  /* ------------------------------------------------------------------ */
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  /* ------------------------------------------------------------------ */
  /*  Submit                                                            */
  /* ------------------------------------------------------------------ */
  const handleSubmit = () => {
    if (disabled || submitted) return;
    setSubmitted(true);
    setPhase(PHASE.DONE);
    onSubmit?.({
      taskType: "speed-draw",
      type: photo ? "photo" : "verbal",
      word,
      difficulty,
      drawer: drawerName,
      guesser: guesser || "",
      guessed: !!guesser,
      photo: photo || null,
      timeUsed: totalSeconds - timeLeft,
      completed: true,
      submittedAt: new Date().toISOString(),
    });
    if (socket && task?.roomCode) socket.emit("speed-draw-submitted", { roomCode: task.roomCode });
  };

  /* ------------------------------------------------------------------ */
  /*  RENDER                                                            */
  /* ------------------------------------------------------------------ */
  return (
    <div className="flex flex-col items-center justify-start h-full p-6 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white overflow-y-auto">
      <h1 className="text-5xl md:text-7xl font-black mb-4 drop-shadow-2xl">SPEED DRAW!</h1>

      {/* Concise rules — different per phase. */}
      <div className="w-full max-w-2xl mb-6">
        <div className="rounded-2xl border border-white/30 bg-white/10 backdrop-blur px-4 py-3 text-left">
          <div className="font-extrabold text-lg mb-2">How this works</div>
          <ol className="space-y-1 text-base">
            <li className="flex items-start gap-2"><StepCircle n={1} /> Pick the drawer.</li>
            <li className="flex items-start gap-2"><StepCircle n={2} /> Drawer presses & holds to peek at the word — privately.</li>
            <li className="flex items-start gap-2"><StepCircle n={3} /> When ready, drawer taps "Start drawing".</li>
            <li className="flex items-start gap-2"><StepCircle n={4} /> Team guesses out loud while the drawer draws on paper.</li>
            <li className="flex items-start gap-2"><StepCircle n={5} /> When time's up, the word is revealed and the team taps who guessed.</li>
          </ol>
        </div>
      </div>

      {/* ─── Pick drawer ─── */}
      {phase === PHASE.PICK_DRAWER && (
        <div className="w-full max-w-xl text-center">
          <div className="text-2xl font-black mb-3">Who's the drawer?</div>
          <div className="flex flex-wrap gap-3 justify-center mb-6">
            {safeMembers.map((n, i) => (
              <button
                key={n}
                onClick={() => setDrawerIdx(i)}
                className={
                  "px-6 py-3 rounded-full font-black text-xl transition-all " +
                  (i === drawerIdx
                    ? "bg-yellow-300 text-slate-900 shadow-2xl scale-105"
                    : "bg-white/15 hover:bg-white/25")
                }
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPhase(PHASE.SECRET)}
            disabled={disabled}
            className="px-12 py-5 bg-emerald-500 text-white text-2xl font-black rounded-full hover:bg-emerald-600 transition shadow-2xl"
          >
            Continue with {drawerName} →
          </button>
        </div>
      )}

      {/* ─── Secret peek ─── */}
      {phase === PHASE.SECRET && (
        <div className="w-full max-w-xl text-center">
          <div className="text-3xl md:text-4xl font-black mb-3">
            Pass the device to <span className="text-yellow-300">{drawerName}</span>
          </div>
          <div className="text-base opacity-85 mb-4">
            Press &amp; hold the button to peek. Release to hide. Don't let anyone else see!
          </div>

          <div
            className={
              "rounded-3xl p-12 mb-4 shadow-2xl select-none " +
              (pressing ? "bg-yellow-300/95 text-slate-900" : "bg-white/15 text-white")
            }
          >
            <div className="text-xs uppercase tracking-widest opacity-75 mb-2">Word</div>
            <div className="text-6xl md:text-7xl font-black tracking-tight min-h-[1.2em]">
              {pressing ? word : "🤫 hidden"}
            </div>
            {pressing && (
              <div className="text-base mt-3 opacity-80">Difficulty: {difficulty}</div>
            )}
          </div>

          <button
            onMouseDown={() => setPressing(true)}
            onMouseUp={() => setPressing(false)}
            onMouseLeave={() => setPressing(false)}
            onTouchStart={(e) => { e.preventDefault(); setPressing(true); }}
            onTouchEnd={() => setPressing(false)}
            onTouchCancel={() => setPressing(false)}
            disabled={disabled}
            className="block w-full px-8 py-6 mb-4 bg-amber-500 text-slate-900 text-xl font-black rounded-2xl hover:bg-amber-400 transition shadow-2xl select-none"
          >
            {pressing ? "👀 PEEKING — release to hide" : "👇 Press & hold to peek"}
          </button>

          <button
            onClick={() => { setPhase(PHASE.DRAWING); setTimeLeft(totalSeconds); }}
            disabled={disabled}
            className="px-10 py-5 bg-emerald-500 text-white text-xl font-black rounded-full hover:bg-emerald-600 transition shadow-2xl"
          >
            Got it — start drawing!
          </button>

          {hasNames && (
            <button
              onClick={() => setPhase(PHASE.PICK_DRAWER)}
              className="block mx-auto mt-3 text-sm font-bold opacity-75 hover:opacity-100"
            >
              ← Pick a different drawer
            </button>
          )}
        </div>
      )}

      {/* ─── Drawing (timer) ─── */}
      {phase === PHASE.DRAWING && (
        <div className="w-full max-w-2xl text-center">
          <div className="text-7xl md:text-8xl font-black mb-4 text-yellow-300 animate-pulse">
            {timeLeft}s
          </div>
          <div className="text-2xl font-black mb-2">
            {drawerName} is drawing • Team: guess out loud!
          </div>
          <div className="opacity-85 mb-6">
            (Word stays hidden until the timer ends.)
          </div>
          <button
            onClick={() => setPhase(PHASE.REVEAL)}
            disabled={disabled}
            className="px-10 py-5 bg-rose-500 text-white text-xl font-black rounded-full hover:bg-rose-600 transition shadow-2xl"
          >
            Stop early — go to reveal
          </button>
        </div>
      )}

      {/* ─── Reveal + capture guesser + optional photo ─── */}
      {phase === PHASE.REVEAL && (
        <div className="w-full max-w-2xl text-center">
          <div className="rounded-3xl bg-white/95 text-slate-900 p-8 mb-6 shadow-2xl">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">The word was</div>
            <div className="text-5xl md:text-6xl font-black text-amber-600">{word}</div>
            <div className="text-sm mt-2 text-slate-500">Difficulty: {difficulty}</div>
          </div>

          {hasNames && (
            <>
              <div className="text-2xl font-black mb-3">Who guessed it?</div>
              <div className="flex flex-wrap gap-2 justify-center mb-6">
                {safeMembers.map((n) => {
                  const isDrawer = n === drawerName;
                  if (isDrawer) return null;
                  const picked = guesser === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setGuesser(picked ? null : n)}
                      className={
                        "px-5 py-3 rounded-full font-black transition-all " +
                        (picked
                          ? "bg-emerald-400 text-slate-900 shadow-2xl scale-105"
                          : "bg-white/15 hover:bg-white/25")
                      }
                    >
                      {n}{picked ? " ✓" : ""}
                    </button>
                  );
                })}
                <button
                  onClick={() => setGuesser(guesser === "__none__" ? null : "__none__")}
                  className={
                    "px-5 py-3 rounded-full font-black transition-all " +
                    (guesser === "__none__"
                      ? "bg-slate-700 text-white shadow-2xl scale-105"
                      : "bg-white/15 hover:bg-white/25")
                  }
                >
                  {guesser === "__none__" ? "✓ No one got it" : "No one got it"}
                </button>
              </div>
            </>
          )}

          {/* Optional photo of the drawing.  Practice can skip. */}
          {!practiceMode && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || submitted}
                className="px-10 py-4 bg-blue-600 text-white text-lg font-bold rounded-2xl hover:bg-blue-700 transition shadow-2xl mb-3"
              >
                {photo ? "✅ Photo added — retake" : "📷 Photo of the drawing (optional)"}
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
                <div className="mb-4">
                  <img src={photo} alt="Your drawing" className="max-w-md mx-auto rounded-2xl shadow-2xl" />
                </div>
              )}
            </>
          )}

          <button
            onClick={handleSubmit}
            disabled={disabled || submitted}
            className="block mx-auto px-16 py-6 text-3xl font-black bg-emerald-500 text-white rounded-3xl hover:bg-emerald-600 disabled:opacity-50 transition shadow-2xl"
          >
            {submitted ? "Submitted!" : "Submit"}
          </button>
        </div>
      )}

      {phase === PHASE.DONE && (
        <div className="text-center mt-12">
          <div className="text-7xl font-black text-yellow-300 mb-4 animate-bounce">
            +{difficulty === "HARD" ? 20 : 10} pts
          </div>
          <div className="text-xl opacity-85">
            Drawer: <b>{drawerName}</b>
            {guesser && guesser !== "__none__" && <> · Guessed by: <b>{guesser}</b></>}
          </div>
        </div>
      )}
    </div>
  );
}
