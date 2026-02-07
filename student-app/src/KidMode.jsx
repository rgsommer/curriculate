// student-app/src/KidMode.jsx
import React from "react";
import { Routes, Route } from "react-router-dom";
import GameLobby from "./pages/GameLobby.jsx";
import WaitingRoom from "./pages/WaitingRoom.jsx";
import TaskRunner from "./components/tasks/TaskRunner.jsx";

export default function KidMode() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-yellow-400 overflow-hidden">
      {/* Floating shapes background */}
      <div className="fixed inset-0 opacity-30">
        <div className="absolute top-10 left-10 text-9xl animate-bounce">⭐</div>
        <div className="absolute bottom-20 right-20 text-8xl animate-pulse">🎨</div>
        <div className="absolute top-1/2 left-1/4 text-7xl animate-spin">🦖</div>
      </div>

      <Routes>
        <Route path="/" element={<GameLobby />} />
        <Route path="/waiting" element={<WaitingRoom />} />
        <Route path="/play" element={<TaskRunner />} />
      </Routes>
    </div>
  );
}