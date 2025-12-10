// student-app/src/components/tasks/types/MotionMissionTask.jsx
import React, { useEffect, useState, useRef } from "react";
import Lottie from "lottie-react";

// Import animations from /public/animations (Vite will resolve these)
import jumpAnim from "/animations/jump.json";
import squatAnim from "/animations/squat.json";
import runAnim from "/animations/run.json";
import danceAnim from "/animations/dance.json";
import spinAnim from "/animations/spin.json";

// All animations are loaded directly from /public/animations/
const ACTIVITY_CONFIG = {
  "Jump 10 times": {
    type: "jump",
    target: 10,
    animationData: jumpAnim,
  },
  "Do 8 squats": {
    type: "squat",
    target: 8,
    animationData: squatAnim,
  },
  "Run on the spot": {
    type: "run",
    target: 15,
    animationData: runAnim,
  },
  "Dance wildly!": {
    type: "dance",
    target: 12,
    animationData: danceAnim,
  },
  "Spin around 5 times": {
    type: "spin",
    target: 5,
    animationData: spinAnim,
  },
};

export default function MotionMissionTask({ task, onSubmit, disabled }) {
  const activityPrompt = task?.prompt || "Jump 10 times";
  const [activityName] = useState(activityPrompt);
  const config =
    ACTIVITY_CONFIG[activityName] || ACTIVITY_CONFIG["Jump 10 times"];
  const { animationData, target } = config;

  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showDemo, setShowDemo] = useState(true);
  const [noMotionSupport, setNoMotionSupport] = useState(false);

  const lastShakeTime = useRef(0);
  const shakeThreshold = 1.9; // Fine-tuned for kids' energy
  const minInterval = 380; // Prevent double-counting

  // Request permission and start motion detection
  useEffect(() => {
    let cancelled = false;

    const handleMotion = (event) => {
      if (cancelled || disabled || completed) return;

      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const ax = typeof acc.x === "number" ? acc.x : 0;
      const ay = typeof acc.y === "number" ? acc.y : 0;
      const az = typeof acc.z === "number" ? acc.z : 0;

      const total = Math.abs(ax) + Math.abs(ay) + Math.abs(az);
      const now = Date.now();

      if (total > shakeThreshold && now - lastShakeTime.current > minInterval) {
        lastShakeTime.current = now;

        setCount((prev) => {
          const next = prev + 1;
          if (next >= target) {
            const clamped = target;
            setCompleted(true);
            try {
              new Audio("/sounds/victory.mp3").play();
            } catch (e) {
              // ignore audio errors
            }
            onSubmit?.({ completed: true, points: 15, count: clamped });
            return clamped;
          }
          return Math.min(next, target);
        });
      }
    };

    const requestMotionPermission = async () => {
      try {
        // iOS 13+ requires explicit permission
        if (
          typeof DeviceMotionEvent !== "undefined" &&
          typeof DeviceMotionEvent.requestPermission === "function"
        ) {
          const response = await DeviceMotionEvent.requestPermission();
          if (response === "granted") {
            window.addEventListener("devicemotion", handleMotion);
          } else {
            setNoMotionSupport(true);
          }
        } else if (typeof window !== "undefined" && window.DeviceMotionEvent) {
          // Android / desktop that supports DeviceMotion
          window.addEventListener("devicemotion", handleMotion);
        } else {
          setNoMotionSupport(true);
        }
      } catch (err) {
        setNoMotionSupport(true);
      }
    };

    // Show demo for 5 seconds, then request motion permission
    const demoTimer = setTimeout(() => setShowDemo(false), 5000);
    const motionTimer = setTimeout(() => {
      if (!cancelled) {
        requestMotionPermission();
      }
    }, 5500);

    return () => {
      cancelled = true;
      clearTimeout(demoTimer);
      clearTimeout(motionTimer);
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [disabled, completed, target, onSubmit]);

  // Update progress bar
  useEffect(() => {
    setProgress((count / target) * 100);
  }, [count, target]);

  return (
    <div className="relative flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-orange-600 via-red-600 to-pink-700 text-white overflow-hidden">
      {/* Epic Title */}
      <h1 className="absolute top-8 left-1/2 -translate-x-1/2 text-7xl md:text-9xl font-black drop-shadow-2xl animate-pulse z-10">
        MOTION MISSION!
      </h1>

      {showDemo ? (
        /* DEMO PHASE */
        <div className="text-center">
          <p className="text-5xl md:text-7xl font-bold mb-12 drop-shadow-2xl">
            Watch and Copy!
          </p>
          <div className="w-80 h-80 md:w-96 md:h-96 mx-auto">
            <Lottie animationData={animationData} loop={true} />
          </div>
          <p className="text-5xl md:text-7xl font-black text-yellow-300 mt-12 drop-shadow-2xl">
            {activityName.toUpperCase()}
          </p>
        </div>
      ) : (
        /* ACTIVE PHASE */
        <>
          <p className="text-5xl md:text-7xl font-black mb-16 drop-shadow-2xl">
            {activityName}
          </p>

          {/* Progress Bar */}
          <div className="relative w-full max-w-4xl mb-20">
            <div className="bg-gray-900/60 rounded-full h-40 overflow-hidden shadow-2xl">
              <div
                className="h-full bg-gradient-to-r from-green-500 via-emerald-500 to-teal-600 flex items-center justify-center text-8xl md:text-9xl font-black transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              >
                {count > 0 && count}
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-9xl md:text-10xl font-black drop-shadow-2xl">
                {count} / {target}
              </span>
            </div>
          </div>

          {/* No Motion Fallback */}
          {noMotionSupport && !completed && (
            <div className="text-center animate-pulse">
              <p className="text-5xl font-bold text-yellow-300 mb-8">
                Motion not available
              </p>
              <button
                onClick={() => {
                  const finalCount = target;
                  setCount(finalCount);
                  setCompleted(true);
                  try {
                    new Audio("/sounds/victory.mp3").play();
                  } catch (e) {
                    // ignore audio errors
                  }
                  onSubmit?.({ completed: true, points: 15, count: finalCount });
                }}
                className="px-16 py-8 bg-yellow-400 text-black text-5xl font-bold rounded-3xl hover:scale-110 transition shadow-2xl"
              >
                Complete Mission
              </button>
            </div>
          )}

          {/* Victory State */}
          {completed && (
            <div className="text-center animate-bounce">
              <div className="text-9xl mb-8">🏆</div>
              <p className="text-9xl md:text-10xl font-black text-yellow-400">
                MISSION COMPLETE!
              </p>
              <p className="text-7xl md:text-8xl font-bold mt-8">+15 POINTS!</p>
            </div>
          )}

          {/* Active Go! */}
          {!completed && !noMotionSupport && (
            <p className="text-9xl md:text-10xl font-black animate-pulse drop-shadow-2xl">
              GO!
            </p>
          )}
        </>
      )}
    </div>
  );
}
