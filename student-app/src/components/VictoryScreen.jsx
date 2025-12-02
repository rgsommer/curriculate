//student-app/src/components/tasks/types/VictoryScreen.jsx
import React from "react";
import Lottie from "lottie-react";
import fireworks from "../../assets/animations/fireworks.json";

export default function VictoryScreen({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div className="relative">
        <Lottie
          animationData={fireworks}
          loop={false}
          style={{ width: 800, height: 800 }}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <h1 className="text-9xl font-bold text-white drop-shadow-2xl animate-pulse">
            VICTORY!
          </h1>
        </div>
      </div>
    </div>
  );
}