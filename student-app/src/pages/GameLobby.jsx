// student-app/src/pages/GameLobby.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function GameLobby() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  const join = () => {
    if (code.length === 2) {
      navigate(`/waiting?room=${code.toUpperCase()}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen text-white">
      <h1 className="text-9xl font-bold mb-8 drop-shadow-2xl animate-pulse">
        CURRICULATE PLAY
      </h1>
      <p className="text-6xl mb-16">Enter your class code!</p>

      <input
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase().slice(0,2))}
        className="text-9xl font-mono text-center bg-white/20 backdrop-blur-lg rounded-3xl px-12 py-8 border-8 border-white/50 shadow-2xl"
        placeholder="AB"
        maxLength={2}
      />

      <button
        onClick={join}
        disabled={code.length < 2}
        className="mt-16 px-32 py-16 text-8xl font-bold bg-yellow-400 text-purple-900 rounded-full shadow-2xl hover:scale-110 transition disabled:opacity-50"
      >
        LET'S GO!
      </button>

      <div className="mt-20 text-6xl animate-bounce">🎮🦄🚀🎯</div>
    </div>
  );
}