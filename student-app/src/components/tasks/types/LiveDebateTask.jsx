// student-app/src/components/tasks/types/LiveDebateTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function LiveDebateTask({
  task,
  onSubmit,
  disabled,
  socket,
  roomCode: roomCodeProp,
  memberNames = [],
  teamMembers: teamMembersFallback = [],
}) {
  // Build a clean names list: prefer memberNames, fall back to teamMembers prop, then generic
  const names = (() => {
    const src = memberNames.length ? memberNames : teamMembersFallback;
    const cleaned = src.map((n) => String(n ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["Player 1", "Player 2", "Player 3"];
  })();

  const [responses, setResponses] = useState(task.responses || []);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [myTeamSide] = useState(task.mySide);
  const [winner, setWinner] = useState(task.winner);
  const [errorMsg, setErrorMsg] = useState("");

  const recognitionRef = useRef(null);

  // Auto-assign speaker: rotate through team members
  const myResponses = responses.filter((r) => r.teamName === task.myTeamName);
  const turnIndex = myResponses.length; // 0-based turn number
  const currentSpeaker = names[turnIndex % names.length];
  const canSpeak = turnIndex < 3;

  // Fallback if browser doesn't support speech recognition
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeechRecognition = !!SpeechRecognition;

  // Speech Recognition Setup
  useEffect(() => {
    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      console.warn("Speech recognition not supported");
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = "en-US";

    recognitionRef.current.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        setTranscript((prev) => prev + " " + last[0].transcript);
        setIsListening(false);
      } else {
        setTranscript(last[0].transcript);
      }
    };

    recognitionRef.current.onerror = () => setIsListening(false);
    recognitionRef.current.onend = () => setIsListening(false);

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const submitResponse = () => {
    const text = transcript.trim();
    if (!text || disabled) return;

    const code = roomCodeProp || task?.roomCode;
    const canEmit = Boolean(socket && typeof socket.emit === "function");
    const connected =
      socket && (socket.connected === undefined ? true : socket.connected);

    if (!code) {
      setErrorMsg(
        "No room code was provided, so your response could not be sent."
      );
      return;
    }
    if (!canEmit || !connected) {
      setErrorMsg("Not connected right now. Please try again in a moment.");
      return;
    }

    try {
      socket.emit("debate-response", {
        roomCode: code,
        text,
        speaker: currentSpeaker,
        side: myTeamSide,
        teamName: task.myTeamName,
      });
      setErrorMsg("");
      setTranscript("");
    } catch {
      setErrorMsg("Response could not be sent. Please try again.");
    }
  };

  const topic =
    task.postulate ||
    task.prompt ||
    task.topic ||
    task.config?.postulate ||
    task.config?.topic ||
    "";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-center">
        <h2 className="text-2xl font-bold">LIVE DEBATE</h2>
        {topic ? <p className="text-lg mt-2">{topic}</p> : null}
        <p className="font-bold text-xl mt-2">
          You are arguing{" "}
          <span
            className={
              myTeamSide === "for" ? "text-green-300" : "text-red-300"
            }
          >
            {myTeamSide === "for" ? "FOR" : "AGAINST"}
          </span>
        </p>
      </div>

      {/* Response thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {responses.map((r, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg max-w-md ${
              r.side === "for"
                ? "bg-green-100 border-l-4 border-green-600"
                : "bg-red-100 border-l-4 border-red-600"
            } ${r.teamName === task.myTeamName ? "ml-auto" : ""}`}
          >
            <div className="font-bold text-sm">
              {r.teamName} ({r.speaker})
            </div>
            <div className="mt-1">{r.text}</div>
          </div>
        ))}
      </div>

      {/* Winner / Input area */}
      {winner ? (
        <div className="p-8 text-center text-5xl font-bold">
          {winner === task.myTeamName ? (
            <span className="text-green-600">YOUR TEAM WINS! +15</span>
          ) : (
            <span className="text-red-600">{winner} Wins</span>
          )}
        </div>
      ) : (
        <div className="p-4 border-t bg-gray-50">
          {/* Instructions (first turn only) */}
          {turnIndex === 0 && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-white">
              <div className="font-extrabold">How this works</div>
              <div className="text-sm text-slate-700 mt-1">
                Each team member takes a turn — no skipping! Speak (or type) one
                short argument per turn. Your team gets{" "}
                <span className="font-bold">3 turns</span> total, then wait
                while the other team responds.
              </div>
            </div>
          )}

          {errorMsg ? (
            <div className="mb-3 p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 font-bold">
              {errorMsg}
            </div>
          ) : null}

          {canSpeak ? (
            <div className="space-y-4">
              {/* Assigned speaker banner */}
              <div className="p-4 rounded-xl bg-indigo-50 border-2 border-indigo-300 text-center">
                <div className="text-sm font-bold text-indigo-500 uppercase tracking-wide">
                  Turn {turnIndex + 1} of 3
                </div>
                <div className="text-2xl font-black text-indigo-700 mt-1">
                  {currentSpeaker}, you're up!
                </div>
                <div className="text-sm text-indigo-500 mt-1">
                  Hand the device to {currentSpeaker} — it's their turn to argue
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={`${currentSpeaker}, speak your argument...`}
                  className="w-full p-4 pr-16 border-2 rounded-xl resize-none text-lg"
                  rows="4"
                />
                {hasSpeechRecognition ? (
                  <button
                    onClick={startListening}
                    disabled={isListening || disabled}
                    className={`absolute bottom-3 right-3 w-12 h-12 rounded-full flex items-center justify-center transition
                      ${
                        isListening
                          ? "bg-red-600 animate-pulse"
                          : "bg-indigo-600 hover:bg-indigo-700"
                      }`}
                  >
                    {isListening ? "Stop" : "Mic"}
                  </button>
                ) : (
                  <div className="absolute bottom-3 right-3 text-sm text-gray-500">
                    Voice not supported — type instead
                  </div>
                )}
              </div>

              <button
                onClick={submitResponse}
                disabled={disabled || !transcript.trim()}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
              >
                Submit {currentSpeaker}'s Argument ({turnIndex + 1}/3)
              </button>
            </div>
          ) : (
            <p className="text-center text-2xl font-bold text-gray-600">
              All 3 arguments submitted! Waiting for the other team...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
