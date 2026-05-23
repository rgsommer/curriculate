// student-app/src/components/tasks/types/LiveDebateTask.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import SpeechQualityMeter from "../SpeechQualityMeter";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * scoreDebate — rule-based coach feedback for the practice flow.
 * Real classroom mode can swap this out with an AI-side scoring call;
 * for the solo demo we want immediate, actionable feedback without
 * a network round-trip.  Heuristics: argument length, evidence
 * vocabulary ("because", "for example"), and rebuttal vocabulary
 * ("however", "but", "in contrast").
 */
function scoreDebate(responses) {
  const arr = Array.isArray(responses) ? responses : [];
  const evidenceTerms = ["because", "since", "for example", "for instance", "evidence", "research", "studies", "data", "according to"];
  const rebuttalTerms = ["however", "but", "in contrast", "on the other hand", "actually", "while", "whereas"];
  const sides = { for: { score: 0, n: 0, words: 0, evidence: 0, rebuttal: 0 }, against: { score: 0, n: 0, words: 0, evidence: 0, rebuttal: 0 } };
  for (const r of arr) {
    const side = r?.side === "against" ? "against" : "for";
    const text = String(r?.text || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean).length;
    const lengthScore = Math.min(20, Math.floor(words / 3));
    const ev = evidenceTerms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0);
    const rb = rebuttalTerms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0);
    sides[side].score += lengthScore + ev * 5 + rb * 3;
    sides[side].n += 1;
    sides[side].words += words;
    sides[side].evidence += ev;
    sides[side].rebuttal += rb;
  }
  const winningSide = sides.for.score === sides.against.score
    ? "tie"
    : (sides.for.score > sides.against.score ? "for" : "against");
  const avgWords = (sides.for.words + sides.against.words) / Math.max(1, (sides.for.n + sides.against.n));
  const totalEvidence = sides.for.evidence + sides.against.evidence;
  const totalRebuttal = sides.for.rebuttal + sides.against.rebuttal;
  const tips = [];
  if (avgWords < 20) tips.push("Try fleshing out each turn — even one extra sentence of detail helps.");
  if (totalEvidence === 0) tips.push("Cite evidence: words like \"because\", \"for example\", or \"research shows\" make arguments stronger.");
  if (totalRebuttal === 0) tips.push("Try directly answering the other side: \"However…\", \"In contrast…\".");
  if (tips.length === 0) tips.push("Solid rounds — strong length, evidence and rebuttal mix. Keep it up!");
  return {
    winningSide,
    forScore: sides.for.score,
    againstScore: sides.against.score,
    avgWords: Math.round(avgWords),
    evidenceCount: totalEvidence,
    rebuttalCount: totalRebuttal,
    tips,
  };
}

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
  const names = useMemo(() => {
    const src = memberNames.length ? memberNames : teamMembersFallback;
    const cleaned = src.map((n) => String(n ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["Player 1", "Player 2", "Player 3"];
  }, [memberNames, teamMembersFallback]);

  // Bot opponent name for solo / single-player practice — tester saw
  // "FOR: Richard vs AGAINST: ???" in demo because there was no
  // opponent.  Pick a friendly stable name so the matchup reads
  // properly even when the player is alone.
  const BOT_NAMES = ["Quinn", "Avery", "Sam", "Riley", "Jamie", "Casey", "Drew", "Morgan"];
  const botName = useMemo(() => {
    const seedSrc = String(task?.id || task?._id || task?.title || "lb");
    let h = 0;
    for (let i = 0; i < seedSrc.length; i += 1) h = (h * 31 + seedSrc.charCodeAt(i)) | 0;
    return BOT_NAMES[Math.abs(h) % BOT_NAMES.length] + " (bot)";
  }, [task?.id, task?._id, task?.title]);

  const roomCode = roomCodeProp || task?.roomCode;
  const canEmit = Boolean(socket && typeof socket.emit === "function");
  const connected = socket && (socket.connected === undefined ? true : socket.connected);

  // ── Solo / intra-team detection ────────────────────────────
  // Solo if: no room, no socket, OR server never assigned a side (single team in room)
  const isSolo = !roomCode || !canEmit || !connected || !task.mySide;

  // Split team members into two sides for intra-team mode.  When the
  // player is alone (only one human name), pad the AGAINST side with
  // the bot so the matchup reads "Richard vs Quinn (bot)" instead of
  // "Richard vs ???".
  const { forMembers, againstMembers } = useMemo(() => {
    if (!isSolo) return { forMembers: names, againstMembers: [] };
    if (names.length <= 1) {
      return { forMembers: names, againstMembers: [botName] };
    }
    const half = Math.ceil(names.length / 2);
    return {
      forMembers: names.slice(0, half),
      againstMembers: names.slice(half),
    };
  }, [names, isSolo, botName]);

  // ── State ──────────────────────────────────────────────────
  const [responses, setResponses] = useState(task.responses || []);
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(task.currentTurn || "for");
  const [winner, setWinner] = useState(task.winner);
  const [debateOver, setDebateOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [coachFeedback, setCoachFeedback] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const threadEndRef = useRef(null);

  const turnsPerSide = task.turnsPerTeam || 3;

  // ── Derived ────────────────────────────────────────────────
  const forResponses = responses.filter((r) => r.side === "for");
  const againstResponses = responses.filter((r) => r.side === "against");

  const currentSideMembers = currentTurn === "for" ? forMembers : againstMembers;
  const currentSideResponses = currentTurn === "for" ? forResponses : againstResponses;
  const turnIndex = currentSideResponses.length;
  const currentSpeaker = currentSideMembers[turnIndex % currentSideMembers.length] || "???";
  const sideExhausted = turnIndex >= turnsPerSide;
  const allDone = forResponses.length >= turnsPerSide && againstResponses.length >= turnsPerSide;

  // Debate topic — check all possible field names the AI might use
  const topic =
    task.postulate ||
    task.resolution ||
    task.topic ||
    task.config?.postulate ||
    task.config?.resolution ||
    task.config?.topic ||
    "";

  // ── Auto-scroll thread ─────────────────────────────────────
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses]);

  // ── Socket listeners (multi-team mode only) ────────────────
  useEffect(() => {
    if (isSolo || !socket) return;

    const handleNewResponse = (data) => {
      setResponses((prev) => [...prev, data]);
      if (data.currentTurn) setCurrentTurn(data.currentTurn);
    };
    const handleDebateComplete = () => setDebateOver(true);
    const handleDebateError = (data) => setErrorMsg(data?.message || "Something went wrong.");

    socket.on("debate-new-response", handleNewResponse);
    socket.on("debate-complete", handleDebateComplete);
    socket.on("debate-error", handleDebateError);

    return () => {
      socket.off("debate-new-response", handleNewResponse);
      socket.off("debate-complete", handleDebateComplete);
      socket.off("debate-error", handleDebateError);
    };
  }, [socket, isSolo]);

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
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

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
              setTranscript((prev) => (prev + " " + json.transcript).trim());
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

    if (isSolo) {
      // Intra-team: manage locally
      const entry = {
        side: currentTurn,
        teamName: currentTurn === "for" ? "Team FOR" : "Team AGAINST",
        speaker: currentSpeaker,
        text,
      };
      const nextResponses = [...responses, entry];
      setResponses(nextResponses);
      setTranscript("");
      setErrorMsg("");

      // Check if both sides are done
      const newForCount = nextResponses.filter((r) => r.side === "for").length;
      const newAgainstCount = nextResponses.filter((r) => r.side === "against").length;

      if (newForCount >= turnsPerSide && newAgainstCount >= turnsPerSide) {
        setDebateOver(true);
        // Compute a rule-based coach score on the way out so the
        // tester gets actionable feedback without waiting on a
        // server-side AI call.  Tester: 'will the argument be
        // evaluated/aiscored? feedback would be nice.'
        const coach = scoreDebate(nextResponses);
        setCoachFeedback(coach);
        // Submit everything to the server for scoring (server may
        // also run a richer AI pass and surface that later).
        onSubmit?.({
          type: "live-debate",
          taskType: "live-debate",
          mode: "intra-team",
          completed: true,
          topic,
          responses: nextResponses,
          forMembers,
          againstMembers,
          turnsPerSide,
          coach,
        });
      } else {
        // Alternate turns
        setCurrentTurn(currentTurn === "for" ? "against" : "for");
      }
      return;
    }

    // Multi-team: emit via socket
    try {
      socket.emit("debate-response", {
        roomCode,
        taskId: task.taskId || task._id || "default",
        text,
        speaker: currentSpeaker,
        side: currentTurn,
        teamName: task.myTeamName,
      });
      setErrorMsg("");
      setTranscript("");
    } catch {
      setErrorMsg("Response could not be sent. Please try again.");
    }
  };

  // ── Render helpers ─────────────────────────────────────────
  const forLabel = isSolo
    ? `Team FOR (${forMembers.join(", ")})`
    : task.myTeamName || "Your team";
  const againstLabel = isSolo
    ? `Team AGAINST (${againstMembers.join(", ")})`
    : task.opponentName || "the other team";
  const currentSideLabel = currentTurn === "for" ? forLabel : againstLabel;
  const otherSideLabel = currentTurn === "for" ? againstLabel : forLabel;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-center">
        <h2 className="text-2xl font-bold">
          {isSolo ? "TEAM DEBATE" : "LIVE DEBATE"}
        </h2>
        {topic ? <p className="text-lg mt-2">{topic}</p> : null}
        {isSolo ? (
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              currentTurn === "for" ? "bg-green-400/30 ring-2 ring-green-300" : "bg-green-400/10"
            }`}>
              FOR: {forMembers.join(", ")}
            </span>
            <span className="text-white/60 font-bold">vs</span>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              currentTurn === "against" ? "bg-red-400/30 ring-2 ring-red-300" : "bg-red-400/10"
            }`}>
              AGAINST: {againstMembers.join(", ")}
            </span>
          </div>
        ) : (
          <p className="font-bold text-xl mt-2">
            You are arguing{" "}
            <span className={task.mySide === "for" ? "text-green-300" : "text-red-300"}>
              {task.mySide === "for" ? "FOR" : "AGAINST"}
            </span>
            {" "}vs {task.opponentName || "the other team"}
          </p>
        )}
      </div>

      {/* ── Response thread ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {responses.length === 0 && (
          <div className="text-center text-slate-400 mt-8 text-lg">
            {isSolo
              ? `${forMembers[0] || "Team FOR"} goes first — make your opening argument!`
              : currentTurn === task.mySide
              ? "You go first — make your opening argument!"
              : `Waiting for ${otherSideLabel} to open...`}
          </div>
        )}
        {responses.map((r, i) => (
          <div
            key={i}
            className={`p-4 rounded-xl max-w-[85%] ${
              r.side === "for"
                ? "bg-green-50 border-l-4 border-green-500 mr-auto"
                : "bg-red-50 border-l-4 border-red-500 ml-auto"
            }`}
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
                {r.speaker}
              </span>
            </div>
            {/* text-slate-900 (was -slate-800) for stronger contrast
                on the green-50 / red-50 message bubbles. */}
            <div className="text-base text-slate-900 leading-relaxed font-medium">{r.text}</div>
          </div>
        ))}
        <div ref={threadEndRef} />
      </div>

      {/* ── Bottom panel ── */}
      {winner ? (
        <div className="p-8 text-center text-5xl font-bold">
          <span className="text-green-600">{winner} Wins!</span>
        </div>
      ) : debateOver ? (
        <div className="p-6 bg-indigo-50 border-t">
          <div className="text-center text-2xl font-bold text-indigo-700">
            All arguments submitted!
          </div>
          <div className="text-center text-slate-600 mt-2">
            {isSolo ? "Great debate, team!" : "The judge is reviewing the debate..."}
          </div>
          {/* Coach feedback (rule-based) — visible immediately while
              the server-side AI scoring (if any) catches up. */}
          {coachFeedback && (
            <div className="mt-4 max-w-2xl mx-auto p-4 rounded-2xl bg-white border border-indigo-200 shadow-sm text-slate-900">
              <div className="font-extrabold text-base mb-2">🤖 Coach feedback</div>
              <div className="text-sm font-semibold mb-2">
                Edge:{" "}
                {coachFeedback.winningSide === "tie"
                  ? <span className="text-slate-700">Tied — both sides matched</span>
                  : coachFeedback.winningSide === "for"
                    ? <span className="text-emerald-700">FOR side ({coachFeedback.forScore} vs {coachFeedback.againstScore})</span>
                    : <span className="text-rose-700">AGAINST side ({coachFeedback.againstScore} vs {coachFeedback.forScore})</span>}
              </div>
              <div className="text-xs text-slate-700 mb-2">
                Avg argument length: <b>{coachFeedback.avgWords}</b> words ·
                Evidence cues: <b>{coachFeedback.evidenceCount}</b> ·
                Rebuttal cues: <b>{coachFeedback.rebuttalCount}</b>
              </div>
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {coachFeedback.tips.map((t, i) => (<li key={i}>{t}</li>))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 border-t bg-gray-50">
          {/* Instructions (first turn only) */}
          {responses.length === 0 && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-white">
              <div className="font-extrabold">How this works</div>
              <div className="text-sm text-slate-700 mt-1">
                {isSolo ? (
                  <>
                    Your team is split into <span className="font-bold text-green-700">FOR</span> and{" "}
                    <span className="font-bold text-red-700">AGAINST</span> sides.
                    Take <span className="font-bold">alternating turns</span> —
                    each person speaks once per turn. {turnsPerSide} arguments per side.
                    Hand the device to whoever's up!
                  </>
                ) : (
                  <>
                    Teams take <span className="font-bold">alternating turns</span>.
                    Each team gets {turnsPerSide} arguments. A different team member
                    speaks each turn — no skipping! After each argument, read the
                    other team's response on screen before your next speaker goes.
                  </>
                )}
              </div>
            </div>
          )}

          {errorMsg ? (
            <div className="mb-3 p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 font-bold">
              {errorMsg}
            </div>
          ) : null}

          {/* In solo mode, it's always someone's turn locally */}
          {(isSolo || !sideExhausted) ? (
            <div className="space-y-3">
              {/* Assigned speaker banner */}
              <div className={`p-4 rounded-xl border-2 text-center ${
                currentTurn === "for"
                  ? "bg-green-50 border-green-300"
                  : "bg-red-50 border-red-300"
              }`}>
                <div className={`text-sm font-bold uppercase tracking-wide ${
                  currentTurn === "for" ? "text-green-600" : "text-red-600"
                }`}>
                  {currentTurn === "for" ? "FOR" : "AGAINST"} — argument {turnIndex + 1} of {turnsPerSide}
                </div>
                <div className={`text-2xl font-black mt-1 ${
                  currentTurn === "for" ? "text-green-700" : "text-red-700"
                }`}>
                  {currentSpeaker}, you're up!
                </div>
                <div className="text-sm text-slate-500 mt-1">
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
                  // Explicit bg + text colour: tester reported the typed
                  // text was invisible — likely the parent dark theme
                  // was bleeding into the unstyled textarea.
                  className="w-full p-4 pr-16 border-2 border-slate-300 rounded-xl resize-none text-lg bg-white text-slate-900 placeholder:text-slate-400"
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

              {/* Live argument-quality speedometer (spoken or typed) — rewards
                  sustained, varied argument; flags filler words. */}
              <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 12, padding: "8px 12px", margin: "8px 0" }}>
                <SpeechQualityMeter text={transcript} />
              </div>

              <button
                onClick={submitResponse}
                disabled={disabled || !transcript.trim() || isRecording || isTranscribing}
                className={`w-full py-4 text-white rounded-xl font-bold text-xl transition disabled:opacity-50 ${
                  currentTurn === "for"
                    ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
                }`}
              >
                Submit {currentSpeaker}'s Argument ({turnIndex + 1}/{turnsPerSide})
              </button>
            </div>
          ) : !isSolo ? (
            <div className="p-6 text-center">
              <div className="text-xl font-bold text-slate-600">
                {otherSideLabel}'s turn to argue...
              </div>
              <div className="text-sm text-slate-500 mt-2">
                Read their response above when it appears.
              </div>
              <div className="mt-4 flex justify-center">
                <div className="w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
