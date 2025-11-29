// student-app/src/components/tasks/types/LiveDebateTask.jsx
import React, { useState, useEffect, useRef } from "react";

export default function LiveDebateTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamMembers = ["Member 1", "Member 2", "Member 3", "Member 4"],
}) {
  const [responses, setResponses] = useState(task.responses || []);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState(teamMembers[0]);
  const [myTeamSide] = useState(task.mySide);
  const [winner, setWinner] = useState(task.winner);

  const recognitionRef = useRef(null);

// Fallback if browser doesn't support speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSpeechRecognition = !!SpeechRecognition;

  // Speech Recognition Setup
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
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
        setTranscript(prev => prev + " " + last[0].transcript);
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

    socket.emit("debate-response", {
      roomCode: task.roomCode,
      text,
      speaker: selectedSpeaker,
      side: myTeamSide,
      teamName: task.myTeamName,
    });
    setTranscript("");
  };

  const myResponses = responses.filter(r => r.teamName === task.myTeamName);
  const canSpeak = myResponses.length < 3;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-center">
        <h2 className="text-2xl font-bold">LIVE DEBATE</h2>
        <p className="text-lg mt-2">{task.postulate}</p>
        <p className="font-bold text-xl mt-2">
          You are arguing <span className={myTeamSide === "for" ? "text-green-300" : "text-red-300"}>
            {myTeamSide === "for" ? "FOR" : "AGAINST"}
          </span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {responses.map((r, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg max-w-md ${
              r.side === "for" ? "bg-green-100 border-l-4 border-green-600" : "bg-red-100 border-l-4 border-red-600"
            } ${r.teamName === task.myTeamName ? "ml-auto" : ""}`}
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
        <div className="p-4 border-t bg-gray-50">
          {canSpeak ? (
            <div className="space-y-4">
              <select
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                className="w-full p-3 border rounded-lg text-center font-medium"
              >
                {teamMembers.map(m => <option key={m}>{m}</option>)}
              </select>

              <div className="relative">
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Click the mic and speak your argument..."
                  className="w-full p-4 pr-16 border-2 rounded-xl resize-none text-lg"
                  rows="4"
                />
                                {hasSpeechRecognition ? (
                  <button
                    onClick={startListening}
                    disabled={isListening || disabled}
                    className={`absolute bottom-3 right-3 w-12 h-12 rounded-full flex items-center justify-center transition
                      ${isListening ? "bg-red-600 animate-pulse" : "bg-indigo-600 hover:bg-indigo-700"}`}
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
                Submit Response ({myResponses.length + 1}/3)
              </button>
            </div>
          ) : (
            <p className="text-center text-2xl font-bold text-gray-600">
              Waiting for other teams... ({myResponses.length}/3)
            </p>
          )}
        </div>
      )}
    </div>
  );
}