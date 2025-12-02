// student-app/src/components/tasks/types/MotionMissionTask.jsx
import React, { useEffect, useState, useRef } from "react";
import Lottie from "lottie-react";

//import jumpAnimation from "../../assets/animations/jump.json";
//import squatAnimation from "../../assets/animations/squat.json";
//import runAnimation from "../../assets/animations/run.json";
//import danceAnimation from "../../assets/animations/dance.json";

const ACTIVITY_CONFIG = {
  "Jump 10 times": { type: "jump", target: 10, animation: jumpAnimation },
  "Do 8 squats": { type: "squat", target: 8, animation: squatAnimation },
  "Run on the spot": { type: "run", target: 15, animation: runAnimation },
  "Dance wildly!": { type: "dance", target: 12, animation: danceAnimation },
  "Spin around 5 times": { type: "spin", target: 5, animation: spinAnimation },
};

export default function MotionMissionTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showDemo, setShowDemo] = useState(true);

  const activityName = task.activity?.name || "Jump 10 times";
  const config = ACTIVITY_CONFIG[activityName] || ACTIVITY_CONFIG["Jump 10 times"];
  const animationData = config.animation;

  const lastAccel = useRef({ x: 0, y: 0, z: 0 });
  const state = useRef({
    jumpPeak: false,
    squatDown: false,
    runOscillation: 0,
    danceEnergy: 0,
    spinStartZ: null,
  });

  useEffect(() => {
    const timer = setTimeout(() => setShowDemo(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (disabled || completed || showDemo) return;

    const handleMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a?.x) return;

      const dx = Math.abs(a.x - lastAccel.current.x);
      const dy = Math.abs(a.y - lastAccel.current.y);
      const dz = Math.abs(a.z - lastAccel.current.z);
      const total = dx + dy + dz;

      let detected = false;

      switch (config.type) {
        case "jump":
          if (a.z < -8 && !state.current.jumpPeak) state.current.jumpPeak = true;
          if (a.z > -3 && state.current.jumpPeak) {
            detected = true;
            state.current.jumpPeak = false;
          }
          break;

        case "squat":
          if (a.y < -6 && !state.current.squatDown) state.current.squatDown = true;
          if (a.y > -2 && state.current.squatDown) {
            detected = true;
            state.current.squatDown = false;
          }
          break;

        case "run":
          state.current.runOscillation += dx + dy;
          if (state.current.runOscillation > 40) {
            detected = true;
            state.current.runOscillation = 0;
          }
          break;

        case "dance":
          state.current.danceEnergy += total;
          if (state.current.danceEnergy > 60) {
            detected = true;
            state.current.danceEnergy = 0;
          }
          break;

        case "spin":
          if (!state.current.spinStartZ) state.current.spinStartZ = a.z;
          if (Math.abs(a.z - state.current.spinStartZ) > 8) {
            detected = true;
            state.current.spinStartZ = null;
          }
          break;
      }

      if (detected) {
        const newCount = count + 1;
        setCount(newCount);
        setProgress((newCount / config.target) * 100);

        if (newCount >= config.target) {
          setCompleted(true);
          new Audio("/sounds/victory.mp3").play();
          onSubmit({ completed: true, activity: activityName, count: newCount });
        }
      }

      lastAccel.current = { x: a.x, y: a.y, z: a.z };
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [disabled, completed, showDemo, count, config, activityName, onSubmit]);

  return (
    <div className="relative flex flex-col items-center justify-center h-full bg-gradient-to-b from-sky-400 to-green-400 overflow-hidden">
      <h2 className="absolute top-8 text-6xl font-bold text-white drop-shadow-2xl z-10 animate-pulse">
        MOTION MISSION!
      </h2>

      {showDemo ? (
        <div className="text-center">
          <p className="text-5xl font-bold text-white mb-8">Watch and Copy!</p>
          <div className="w-96 h-96">
            <Lottie animationData={animationData} loop={true} />
          </div>
          <p className="text-5xl font-bold text-yellow-300 mt-8">{activityName}</p>
        </div>
      ) : (
        <>
          <p className="text-6xl font-bold text-white mb-12">{activityName}</p>

          <div className="w-96 bg-gray-800 rounded-full h-32 overflow-hidden shadow-2xl mb-12">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-600 flex items-center justify-center text-white text-6xl font-bold transition-all duration-300"
              style={{ width: `${progress}%` }}
            >
              {count > 0 && count}
            </div>
          </div>

          {completed ? (
            <div className="text-9xl font-bold text-yellow-400 animate-bounce">
              MISSION COMPLETE! +15
            </div>
          ) : (
            <p className="text-7xl font-bold text-white animate-pulse">GO!</p>
          )}
        </>
      )}
    </div>
  );
}