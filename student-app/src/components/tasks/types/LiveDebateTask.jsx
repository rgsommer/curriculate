// student-app/src/components/tasks/types/LiveDebateTask.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function LiveDebateTask({
  task,
  onSubmit,
  disabled,
  socket,
  roomCode: roomCodeProp,
  memberNames = [],
  teamMembers: teamMembersFallback = [],
}) {
  // ── Names ──────────────────────────────────────────────────
  const names = (() => {
    const src = memberNames.length ? memberNames : teamMembersFallback;
    const cleaned = src.map((n) => String(n ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["Player 1", "Player 2", "Player 3"];
  })();

  // ── State ──────────────────────────────────────────────────
  const [responses, setResponses] = useState(task.responses || []);
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [myTeamSide] = useState(task.mySide);
  const [currentTurn, setCurrentTurn] = useState(task.currentTurn || "for");
  const [winner, setWinner] = useState(task.winner);
  const [debateOver, setDebateOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const threadEndRef = useRef(null);

  const roomCode = roomCodeProp || task?.roomCode;

  // ── Derived ────────────────────────────────────────────────
  const myResponses = responses.filter((r) => r.side === myTeamSide);
  const myTurnIndex = myResponses.length; // how many our side has submitted
  const currentSpeaker = names[myTurnIndex % names.length];
  const isMyTurn = currentTurn === myTeamSide && myTurnIndex < 3;
  const turnsPerTeam = task.turnsPerTeam || 3;

  const topic =
    task.postulate ||
    task.prompt ||
    task.topic ||
    task.config?.postulate ||
    task.config?.topic ||
    "";

  // ── Auto-scroll thread ─────────────────────────────────────
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses]);

  // ── Socket listeners ───────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleNewResponse = (data) => {
      setResponses((prev) => [...prev, data]);
      if (data.currentTurn) setCurrentTurn(data.currentTurn);
    };

    const handleDebateComplete = (data) => {
      setDebateOver(true);
      // Could trigger AI judge here
    };

    const handleDebateError = (data) => {
      setErrorMsg(data?.message || "Something went wrong.");
    };

    socket.on("debate-new-response", handleNewResponse);
    socket.on("debate-complete", handleDebateComplete);
    socket.on("debate-error", handleDebateError);

    return () => {
      socket.off("debate-new-response", handleNewResponse);
      socket.off("debate-complete", handleDebateComplete);
      socket.off("debate-error", handleDebateError);
    };
  }, [socket]);

  // ── Whisper-based recording ────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks so the mic indicator goes away
        stream.getTracks().forEach((t) => t.stop());

        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        // Send to Whisper
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "debate-argument.webm");
          form.append("language", "en");

          const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
            method: "POST",
            body: form,
          });

          if (res.ok) {
            const json = await res.json();
            if (json.transcript) {
              setTranscript((prev) =>
                (prev + " " + json.transcript).trim()
              );
            }
          } else {
            setErrorMsg("Transcription failed — you can type instead.");
          }
        } catch {
          setErrorMsg("Transcription failed — you can type instead.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setErrorMsg("Could not access microphone. You can type instead.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // ── Submit ─────────────────────────────────────────────────
  const submitResponse = () => {
    const text = transcript.trim();
    if (!text || disabled) return;

    const canEmit = Boolean(socket && typeof socket.emit === "function");
    const connected =
      socket && (socket.connected === undefined ? true : socket.connected);

    if (!roomCode) {
      setErrorMsg("No room code — response could not be sent.");
      return;
    }
    if (!canEmit || !connected) {
      setErrorMsg("Not connected. Please try again in a moment.");
      return;
    }

    try {
      socket.emit("debate-response", {
        roomCode,
        taskId: task.taskId || task._id || "default",
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

  // ── Render ─────────────────────────────────────────────────
  const opponentName = task.opponentName || "the other team";

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
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
          {" "}vs {opponentName}
        </p>
      </div>

      {/* ── Response thread ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {responses.length === 0 && (
          <div className="text-center text-slate-400 mt-8 text-lg">
            {currentTurn === myTeamSide
              ? "You go first — make your opening argument!"
              : `Waiting for ${opponentName} to open...`}
          </div>
        )}
        {responses.map((r, i) => {
          const isMine = r.side === myTeamSide;
          return (
            <div
              key={i}
              className={`p-4 rounded-xl max-w-[85%] ${
                r.side === "for"
                  ? "bg-green-50 border-l-4 border-green-500"
                  : "bg-red-50 border-l-4 border-red-500"
              } ${isMine ? "ml-auto" : "mr-auto"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                    r.side === "for"
                      ? "bg-green-200 text-green-800"
                      : "bg-red-200 text-red-800"
                  }`}
                >
                  {r.side}
                </span>
                <span className="font-bold text-sm text-slate-700">
                  {r.teamName} — {r.speaker}
                </span>
              </div>
              <div className="text-base text-slate-800 leading-relaxed">{r.text}</div>
            </div>
          );
        })}
        <div ref={threadEndRef} />
      </div>

      {/* ── Bottom panel ── */}
      {winner ? (
        <div className="p-8 text-center text-5xl font-bold">
          {winner === task.myTeamName ? (
            <span className="text-green-600">YOUR TEAM WINS! +15</span>
          ) : (
            <span className="text-red-600">{winner} Wins</span>
          )}
        </div>
      ) : debateOver ? (
        <div className="p-6 text-center bg-indigo-50 border-t">
          <div className="text-2xl font-bold text-indigo-700">
            All arguments submitted!
          </div>
          <div className="text-slate-600 mt-2">
            The judge is reviewing the debate...
          </div>
        </div>
      ) : (
        <div className="p-4 border-t bg-gray-50">
          {/* Instructions (show on first turn only) */}
          {myTurnIndex === 0 && responses.length === 0 && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-white">
              <div className="font-extrabold">How this works</div>
              <div className="text-sm text-slate-700 mt-1">
                Teams take <span className="font-bold">alternating turns</span>.
                Each team gets {turnsPerTeam} arguments. A different team member
                speaks each turn — no skipping! After each argument, read the
                other team's response on screen before your next speaker goes.
              </div>
            </div>
          )}

          {errorMsg ? (
            <div className="mb-3 p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 font-bold">
              {errorMsg}
            </div>
          ) : null}

          {isMyTurn ? (
            <div className="space-y-3">
              {/* Assigned speaker banner */}
              <div className="p-4 rounded-xl bg-indigo-50 border-2 border-indigo-300 text-center">
                <div className="text-sm font-bold text-indigo-500 uppercase tracking-wide">
                  Your team's turn — argument {myTurnIndex + 1} of {turnsPerTeam}
                </div>
                <div className="text-2xl font-black text-indigo-700 mt-1">
                  {currentSpeaker}, you're up!
                </div>
                <div className="text-sm text-indigo-500 mt-1">
                  Hand the device to {currentSpeaker}
                </div>
              </div>

              {/* Text input + mic */}
              <div className="relative">
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={
                    isTranscribing
                      ? "Transcribing your speech..."
                      : `${currentSpeaker}, speak or type your argument...`
                  }
                  className="w-full p-4 pr-16 border-2 rounded-xl resize-none text-lg"
                  rows="4"
                  disabled={isRecording || isTranscribing}
                />
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={disabled || isTranscribing}
                  className={`absolute bottom-3 right-3 w-14 h-14 rounded-full flex items-center justify-center text-white text-sm font-bold transition shadow-lg
                    ${
                      isRecording
                        ? "bg-red-600 animate-pulse"
                        : isTranscribing
                        ? "bg-yellow-500"
                        : "bg-indigo-600 hover:bg-indigo-700 active:scale-95"
                    }`}
                >
                  {isRecording ? "STOP" : isTranscribing ? "..." : "MIC"}
                </button>
              </div>

              <button
                onClick={submitResponse}
                disabled={disabled || !transcript.trim() || isRecording || isTranscribing}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition"
              >
                Submit {currentSpeaker}'s Argument ({myTurnIndex + 1}/{turnsPerTeam})
              </button>
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="text-xl font-bold text-slate-600">
                {opponentName}'s turn to argue...
              </div>
              <div className="text-sm text-slate-500 mt-2">
                Read their response above when it appears.
                {myTurnIndex < turnsPerTeam && (
                  <span className="block mt-1 font-semibold text-indigo-600">
                    Next up for your team: {names[myTurnIndex % names.length]}
                  </span>
                )}
              </div>
              <div className="mt-4 flex justify-center">
                <div className="w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
