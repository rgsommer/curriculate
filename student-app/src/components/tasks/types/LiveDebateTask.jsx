//student-app/src/components/tasks/types/LiveDebateTask.jsx
import React, { useState, useEffect } from "react";

export default function LiveDebateTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamMembers = ["Member 1", "Member 2", "Member 3", "Member 4"],
}) {
  const [responses, setResponses] = useState(task.responses || []);
  const [myResponse, setMyResponse] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState(teamMembers[0]);
  const [myTeamSide] = useState(task.mySide); // "for" or "against"
  const [winner, setWinner] = useState(task.winner);

  useEffect(() => {
    if (task.winner) {
      if (task.winner === task.myTeamName) {
        new Audio("/sounds/victory.mp3").play();
      } else {
        new Audio("/sounds/lose.mp3").play();
      }
      setWinner(task.winner);
    }
  }, [task.winner]);

  const submitResponse = () => {
    if (!myResponse.trim() || disabled) return;
    socket.emit("debate-response", {
      roomCode: task.roomCode,
      text: myResponse.trim(),
      speaker: selectedSpeaker,
      side: myTeamSide,
      teamName: task.myTeamName,
    });
    setMyResponse("");
  };

  const myResponses = responses.filter(r => r.teamName === task.myTeamName);
  const canSpeak = myResponses.length < 3;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <h2 className="text-2xl font-bold text-center">LIVE DEBATE</h2>
        <p className="text-center text-lg mt-2">{task.postulate}</p>
        <p className="text-center font-bold text-xl mt-3">
          Your team is arguing <span className={myTeamSide === "for" ? "text-green-300" : "text-red-300"}>
            {myTeamSide === "for" ? "FOR" : "AGAINST"}
          </span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {responses.map((r, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg max-w-xs ${
              r.side === "for" ? "bg-green-100 border-2 border-green-500 ml-auto" : "bg-red-100 border-2 border-red-500"
            }`}
          >
            <div className="font-bold text-sm">{r.teamName} ({r.speaker})</div>
            <div className="mt-1">{r.text}</div>
          </div>
        ))}
      </div>

      {winner ? (
        <div className="p-8 text-center text-5xl font-bold">
          {winner === task.myTeamName ? (
            <span className="text-green-600">YOUR TEAM WINS! +15</span>
          ) : (
            <span className="text-red-600">{winner} Wins</span>
          )}
        </div>
      ) : (
        <div className="p-4 border-t">
          {canSpeak ? (
            <div className="space-y-3">
              <select
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                className="w-full p-2 border rounded"
              >
                {teamMembers.map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <textarea
                value={myResponse}
                onChange={(e) => setMyResponse(e.target.value)}
                placeholder="Type your argument... (be respectful!)"
                className="w-full p-3 border rounded-lg resize-none"
                rows="3"
              />
              <button
                onClick={submitResponse}
                disabled={disabled || !myResponse.trim()}
                className="w-full py-3 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700 disabled:opacity-50"
              >
                Submit Response ({myResponses.length + 1}/3)
              </button>
            </div>
          ) : (
            <p className="text-center text-xl font-bold text-gray-600">
              Waiting for other teams... ({myResponses.length}/3 submitted)
            </p>
          )}
        </div>
      )}
    </div>
  );
}