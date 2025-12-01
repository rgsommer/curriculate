// teacher-app/src/pages/HostView.jsx
// Host dashboard: overview of stations, teams, scores, and latest submissions.
// Uses backend-backed recentSubmissions so history persists across view switches.

import React, { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    taskIndex: -1,
    locationCode: "Classroom",
    recentSubmissions: [],
  });

  const [submissions, setSubmissions] = useState([]);
  const joinSoundRef = useRef(null);

  // Preload join sound
  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;
  }, []);

  // Unlock audio on first click
  useEffect(() => {
    const unlock = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.muted = true;
      a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {});
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  // Join the room as host whenever roomCode changes
  useEffect(() => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("joinRoom", {
      roomCode: code,
      role: "host",
      name: "Host",
    });
  }, [roomCode]);

  useEffect(() => {
    const handleRoom = (state) => {
      const safe = state || {
        stations: [],
        teams: {},
        scores: {},
        taskIndex: -1,
        locationCode: "Classroom",
        recentSubmissions: [],
      };

      setRoomState(safe);

      // If backend sends recentSubmissions and our local list is empty,
      // seed the list so history persists across view switches.
      if (
        Array.isArray(safe.recentSubmissions) &&
        safe.recentSubmissions.length > 0 &&
        submissions.length === 0
      ) {
        // newest first
        const seeded = safe.recentSubmissions.slice().reverse();
        setSubmissions(seeded);
      }
    };

    const handleSubmission = (sub) => {
      if (!sub) return;
      setSubmissions((prev) => [sub, ...prev].slice(0, 20));
    };

    const handleTeamJoined = (info) => {
      console.log("[HostView] team joined:", info);
      if (joinSoundRef.current) {
        joinSoundRef.current.currentTime = 0;
        joinSoundRef.current.play().catch(() => {});
      }
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("taskSubmission", handleSubmission);
    socket.on("team:joined", handleTeamJoined);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("taskSubmission", handleSubmission);
      socket.off("team:joined", handleTeamJoined);
    };
  }, [submissions.length]);

  const { stations, teams = {}, scores = {}, taskIndex, locationCode } =
    roomState;

  const teamsArray = Object.values(teams);
  const scoresEntries = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-full flex flex-col p-4 md:p-6 gap-4 md:gap-6 font-sans">
      {/* Accessible page title (hidden visually – top bar already shows it) */}
      <h1 className="sr-only">Host view</h1>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          {roomCode ? (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Room {roomCode.toUpperCase()}
              </p>
              <p className="text-sm text-gray-700">
                Location:{" "}
                <span className="font-medium">
                  {locationCode || "Classroom"}
                </span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Task index:{" "}
                {taskIndex >= 0 ? (
                  <span className="font-mono">{taskIndex + 1}</span>
                ) : (
                  "—"
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-red-700">
              No room selected. Choose a room from the main bar.
            </p>
          )}
        </div>

        {/* Simple legend / status */}
        <div className="min-w-[220px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs md:text-sm">
          <div className="font-semibold mb-1">Session summary</div>
          <div>
            Teams joined:{" "}
            <span className="font-semibold">{teamsArray.length}</span>
          </div>
          <div>
            Stations: <span className="font-semibold">{stations.length}</span>
          </div>
          <div>
            Latest submissions:{" "}
            <span className="font-semibold">{submissions.length}</span>
          </div>
        </div>
      </div>

      {/* Main body: stations/teams + submissions + scores */}
      <div className="grid gap-4 flex-1 min-h-0 grid-cols-1 lg:grid-cols-3">
        {/* Stations column */}
        <div className="lg:border-r border-gray-200 lg:pr-4 min-w-0">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">
            Stations
          </h2>
          {stations.length === 0 ? (
            <p className="text-sm text-gray-500">
              No stations are defined yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {stations.map((s) => {
                const team = teams[s.assignedTeamId] || null;
                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 flex items-center justify-between text-xs md:text-sm"
                  >
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">
                        {s.id}
                      </div>
                      <div className="text-gray-800">
                        {team
                          ? team.teamName || team.teamId
                          : "No team assigned"}
                      </div>
                    </div>
                    {team && (
                      <div className="text-[11px] text-gray-500">
                        Score: {scores[team.teamId] ?? 0}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Teams column */}
        <div className="lg:border-r border-gray-200 lg:pr-4 min-w-0">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Teams</h2>
          {teamsArray.length === 0 ? (
            <p className="text-sm text-gray-500">No teams joined yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {teamsArray.map((team) => (
                <div
                  key={team.teamId}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs md:text-sm"
                >
                  <div className="font-semibold text-gray-900">
                    {team.teamName || team.teamId}
                  </div>
                  {Array.isArray(team.members) && team.members.length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-500">
                      {team.members.join(", ")}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-gray-500">
                    Current station:{" "}
                    <span className="font-mono">
                      {team.currentStationId || "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: latest submissions + scores */}
        <div className="flex flex-col gap-4 min-w-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-2">
              Latest submissions
            </h2>
            {submissions.length === 0 ? (
              <p className="text-xs md:text-sm text-gray-400">
                No submissions yet.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
                {submissions.map((sub, idx) => {
                  const t = sub.submittedAt ? new Date(sub.submittedAt) : null;
                  const timeStr = t
                    ? t.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "";

                  const isCorrect =
                    sub.correct === true
                      ? "✅"
                      : sub.correct === false
                      ? "❌"
                      : "•";

                  return (
                    <div
                      key={`${sub.teamId}-${sub.taskIndex}-${idx}`}
                      className={`px-1 py-1 border-b border-dashed border-gray-200 last:border-none`}
                    >
                      <div>
                        <strong>{sub.teamName || sub.teamId}</strong>{" "}
                        {timeStr && (
                          <span className="text-[10px] text-gray-500">
                            • {timeStr}
                          </span>
                        )}
                      </div>
                      <div
                        className="truncate"
                        title={sub.answerText}
                      >
                        {isCorrect} T{(sub.taskIndex ?? 0) + 1}:{" "}
                        {sub.answerText || "—"}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {sub.points ?? 0} pts{" "}
                        {sub.timeMs != null &&
                          `• ${(sub.timeMs / 1000).toFixed(1)}s`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-2">
              Scores
            </h2>
            {scoresEntries.length === 0 ? (
              <p className="text-xs md:text-sm text-gray-500">
                No scores yet.
              </p>
            ) : (
              <ol className="pl-5 text-xs md:text-sm">
                {scoresEntries.map(([teamId, pts]) => {
                  const teamName = teams[teamId]?.teamName || teamId;
                  return (
                    <li key={teamId} className="mb-1">
                      <strong>{teamName}</strong> — {pts} pts
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
