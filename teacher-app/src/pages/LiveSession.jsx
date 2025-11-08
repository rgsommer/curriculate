// dashboard/src/pages/LiveSession.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_API_URL);

export default function LiveSession() {
  const [roomCode, setRoomCode] = useState(() =>
    Math.random().toString(36).substring(2, 6).toUpperCase()
  );
  const [connected, setConnected] = useState(false);
  const [leaderboard, setLeaderboard] = useState({});
  const [taskPrompt, setTaskPrompt] = useState("");
  const [timer, setTimer] = useState(null);

  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("leaderboardUpdate", (scores) => setLeaderboard(scores));
    return () => {
      socket.off("connect");
      socket.off("leaderboardUpdate");
    };
  }, []);

  const launchTask = () => {
    if (!taskPrompt) return;
    socket.emit("teacherLaunchTask", { roomCode, task: { prompt: taskPrompt } });
  };

  const spawnBonus = () => {
    socket.emit("teacherSpawnBonus", { roomCode, points: 5, durationMs: 8000 });
  };

  const endSession = () => {
    socket.disconnect();
    setConnected(false);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto text-center">
      <h1 className="text-3xl font-bold mb-4">Live Session</h1>
      <p className="text-gray-600 mb-4">
        Room Code: <strong>{roomCode}</strong>
      </p>

      <div className="mb-6">
        <textarea
          className="border p-2 w-full rounded"
          placeholder="Enter your task or question prompt here..."
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
        />
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded mt-2"
          onClick={launchTask}
        >
          Launch Task
        </button>
        <button
          className="bg-green-600 text-white px-4 py-2 rounded mt-2 ml-2"
          onClick={spawnBonus}
        >
          Spawn Bonus Event
        </button>
      </div>

      <h2 className="text-xl font-semibold mb-2">Leaderboard</h2>
      <div className="bg-gray-100 p-4 rounded shadow">
        {Object.entries(leaderboard).length === 0 && <p>No scores yet.</p>}
        {Object.entries(leaderboard)
          .sort((a, b) => b[1] - a[1])
          .map(([name, score], i) => (
            <p key={name} className="text-lg">
              {i + 1}. {name} — {score} pts
            </p>
          ))}
      </div>

      <button
        className="bg-red-500 text-white px-4 py-2 rounded mt-6"
        onClick={endSession}
      >
        End Session
      </button>

      <p className="mt-4 text-sm text-gray-500">
        {connected ? "🟢 Connected" : "🔴 Disconnected"}
      </p>
    </div>
  );
}
