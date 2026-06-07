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
  const inRoom = Boolean(roomCode && canEmit && connected);

  // ── Server-assigned pairing ────────────────────────────────
  // In a taskset, the backend pairs teams on arrival and pushes a `debate-start`
  // (the team that arrives first sits in an "awaiting opponent" state until its
  // partner shows up). Quick-launch embeds the pairing directly in the task.
  // forceSolo lets a lone team bail out to a practice-bot debate.
  const [serverDebate, setServerDebate] = useState(null);
  const [forceSolo, setForceSolo] = useState(false);
  const [verdict, setVerdict] = useState(null);

  const mySide = serverDebate?.mySide ?? task.mySide ?? null;
  const opponentName = serverDebate?.opponentName ?? task.opponentName ?? "the other team";
  const myTeamNameVal = serverDebate?.myTeamName ?? task.myTeamName;
  const debateKeyVal = serverDebate?.debateKey ?? task.debateKey;

  // Three runtime modes:
  //   multiTeam – paired with a real opponent (server-driven)
  //   awaiting  – in a room, waiting for an opponent to reach this task
  //   solo      – no room, or fell back to the practice bot
  const multiTeam = inRoom && Boolean(mySide) && !forceSolo;
  const awaitingOpponent = inRoom && !forceSolo && !mySide && Boolean(task.awaitingOpponent);
  const isSolo = !multiTeam && !awaitingOpponent;

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

  const turnsPerSide = serverDebate?.turnsPerTeam ?? task.turnsPerTeam ?? 3;

  // ── Derived ────────────────────────────────────────────────
  const forResponses = responses.filter((r) => r.side === "for");
  const againstResponses = responses.filter((r) => r.side === "against");

  const currentSideMembers = currentTurn === "for" ? forMembers : againstMembers;
  const currentSideResponses = currentTurn === "for" ? forResponses : againstResponses;
  const turnIndex = currentSideResponses.length;
  const sideExhausted = turnIndex >= turnsPerSide;
  const allDone = forResponses.length >= turnsPerSide && againstResponses.length >= turnsPerSide;

  // ── Turn ownership ─────────────────────────────────────────
  // Solo/intra: this one device drives both sides, so it's always "my turn".
  // Multi-team: this device only acts when the live turn matches our assigned
  // side (task.mySide), and the speaker rotates through OUR team's members.
  const isMyTurn = isSolo ? true : currentTurn === mySide;
  const myResponsesCount = isSolo
    ? turnIndex
    : (mySide === "for" ? forResponses.length : againstResponses.length);
  const mySpeaker = isSolo
    ? (currentSideMembers[turnIndex % currentSideMembers.length] || "???")
    : (names[myResponsesCount % names.length] || names[0] || "Your team");
  const mySideExhausted = isSolo ? sideExhausted : myResponsesCount >= turnsPerSide;
  // Whether to show the input box on this device right now.
  const showInput = isSolo ? !sideExhausted : (isMyTurn && !mySideExhausted);

  // Debate topic — check all possible field names the AI might use
  const topic =
    serverDebate?.postulate ||
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

  // ── Socket listeners (room mode: awaiting OR paired) ───────
  // We subscribe whenever we're in a room and haven't bailed to the bot, so a
  // team sitting in the "awaiting opponent" state still receives debate-start.
  useEffect(() => {
    if (!socket || !inRoom || forceSolo) return;

    const handleDebateStart = (data) => {
      // Server paired us with an opponent — enter multi-team mode.
      setServerDebate({
        mySide: data?.mySide,
        opponentName: data?.opponentName,
        myTeamName: data?.myTeamName,
        debateKey: data?.debateKey,
        postulate: data?.postulate,
        currentTurn: data?.currentTurn || "for",
        turnsPerTeam: data?.turnsPerTeam || 3,
      });
      setResponses([]);
      setCurrentTurn(data?.currentTurn || "for");
      setErrorMsg("");
    };
    const handleNewResponse = (data) => {
      setResponses((prev) => [...prev, data]);
      if (data.currentTurn) setCurrentTurn(data.currentTurn);
    };
    const handleDebateComplete = (data) => {
      if (data) setVerdict(data);
      setDebateOver(true);
    };
    const handleDebateError = (data) => setErrorMsg(data?.message || "Something went wrong.");

    socket.on("debate-start", handleDebateStart);
    socket.on("debate-new-response", handleNewResponse);
    socket.on("debate-complete", handleDebateComplete);
    socket.on("debate-error", handleDebateError);

    return () => {
      socket.off("debate-start", handleDebateStart);
      socket.off("debate-new-response", handleNewResponse);
      socket.off("debate-complete", handleDebateComplete);
      socket.off("debate-error", handleDebateError);
    };
  }, [socket, inRoom, forceSolo]);

  // Auto-fallback: if no opponent shows up within 45s, offer the practice bot
  // automatically so a lone team is never stuck on the waiting screen.
  useEffect(() => {
    if (!awaitingOpponent) return;
    const t = setTimeout(() => setForceSolo(true), 45000);
    return () => clearTimeout(t);
  }, [awaitingOpponent]);

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
        speaker: mySpeaker,
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

    // Multi-team: emit via socket (server tracks turns + broadcasts to the pair)
    try {
      socket.emit("debate-response", {
        roomCode,
        debateKey: debateKeyVal,
        taskId: task.taskId || task._id || "quick",
        text,
        speaker: mySpeaker,
        side: mySide,
        teamName: myTeamNameVal,
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
    : (mySide === "for" ? (myTeamNameVal || "Your team") : opponentName);
  const againstLabel = isSolo
    ? `Team AGAINST (${againstMembers.join(", ")})`
    : (mySide === "against" ? (myTeamNameVal || "Your team") : opponentName);
  const currentSideLabel = currentTurn === "for" ? forLabel : againstLabel;
  const otherSideLabel = currentTurn === "for" ? againstLabel : forLabel;

  // ── Awaiting an opponent (taskset pairing) ─────────────────
  if (awaitingOpponent) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center">
        <div className="text-2xl font-extrabold text-indigo-700 mb-1">Live Debate</div>
        {topic ? <p className="text-lg text-slate-700 mb-4 max-w-md">{topic}</p> : null}
        <div className="w-10 h-10 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mb-4" />
        <div className="text-lg font-bold text-slate-700">Waiting for another team to reach this debate…</div>
        <div className="text-sm text-slate-500 mt-2 max-w-sm">
          You'll be paired automatically as soon as an opponent arrives.
        </div>
        <button
          type="button"
          onClick={() => setForceSolo(true)}
          className="mt-6 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
        >
          Debate the practice bot instead
        </button>
      </div>
    );
  }

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
            <span className={mySide === "for" ? "text-green-300" : "text-red-300"}>
              {mySide === "for" ? "FOR" : "AGAINST"}
            </span>
            {" "}vs {opponentName}
          </p>
        )}
      </div>

      {/* ── Response thread ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {responses.length === 0 && (
          <div className="text-center text-slate-400 mt-8 text-lg">
            {isSolo
              ? `${forMembers[0] || "Team FOR"} goes first — make your opening argument!`
              : currentTurn === mySide
              ? "You go first — make your opening argument!"
              : `Waiting for ${opponentName} to open...`}
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
            {isSolo ? "Great debate, team!" : verdict ? "The verdict is in!" : "The judge is reviewing the debate..."}
          </div>

          {/* Server verdict (multi-team head-to-head) — who won + points. */}
          {verdict && (
            <div className="mt-4 max-w-2xl mx-auto p-4 rounded-2xl bg-white border border-indigo-200 shadow-sm text-slate-900">
              <div className="font-extrabold text-base mb-2">🏆 Result</div>
              <div className="text-base font-bold mb-1">
                {verdict.winningSide === "tie"
                  ? "It's a tie — both sides argued well!"
                  : `${verdict.winningSide === "for"
                      ? (verdict.forTeamName || "FOR")
                      : (verdict.againstTeamName || "AGAINST")} wins this debate!`}
              </div>
              <div className="text-xs text-slate-700">
                Scores — {verdict.forTeamName || "FOR"}: <b>{verdict.forScore}</b> ·{" "}
                {verdict.againstTeamName || "AGAINST"}: <b>{verdict.againstScore}</b>
              </div>
              <div className="text-xs text-emerald-700 font-semibold mt-1">
                Points were added to the scoreboard.
              </div>
            </div>
          )}

          {/* Continue — multi-team is teacher/student-advanced; the server already
              scored, so we advance without re-awarding points. */}
          {!isSolo && (
            <button
              type="button"
              onClick={() =>
                onSubmit?.({
                  type: "live-debate",
                  taskType: "live-debate",
                  mode: "inter-team",
                  completed: true,
                  scoredByServer: true,
                  points: 0,
                  verdict,
                })
              }
              className="mt-5 mx-auto block px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              Continue ▶
            </button>
          )}

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
          {/* Instructions (first turn only).  Steps render as ① ② ③ —
              tester Richard 2026-06-05: "steps should be separated by ① ②
              etc". Numbered glyphs make the sequence obvious without the
              user having to read the prose. */}
          {responses.length === 0 && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-white">
              <div className="font-extrabold">How this works</div>
              <div className="text-sm text-slate-700 mt-1" style={{ display: "grid", gap: 4 }}>
                {isSolo ? (
                  <>
                    <div>
                      ① Your team is split into{" "}
                      <span className="font-bold text-green-700">FOR</span> and{" "}
                      <span className="font-bold text-red-700">AGAINST</span> sides.
                    </div>
                    <div>② Take <span className="font-bold">alternating turns</span> — each person speaks once per turn.</div>
                    <div>③ {turnsPerSide} arguments per side. Hand the device to whoever's up!</div>
                  </>
                ) : (
                  <>
                    <div>① Teams take <span className="font-bold">alternating turns</span> — each team gets {turnsPerSide} arguments.</div>
                    <div>② A different team member speaks each turn — no skipping!</div>
                    <div>③ After each argument, read the other team's response on screen before your next speaker goes.</div>
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

          {/* Solo: it's always someone's turn locally. Multi-team: only when
              the live turn matches our assigned side. */}
          {showInput ? (
            <div className="space-y-3">
              {/* Assigned speaker banner */}
              <div className={`p-4 rounded-xl border-2 text-center ${
                (isSolo ? currentTurn : mySide) === "for"
                  ? "bg-green-50 border-green-300"
                  : "bg-red-50 border-red-300"
              }`}>
                <div className={`text-sm font-bold uppercase tracking-wide ${
                  (isSolo ? currentTurn : mySide) === "for" ? "text-green-600" : "text-red-600"
                }`}>
                  {(isSolo ? currentTurn : mySide) === "for" ? "FOR" : "AGAINST"} — argument {myResponsesCount + 1} of {turnsPerSide}
                </div>
                <div className={`text-2xl font-black mt-1 ${
                  (isSolo ? currentTurn : mySide) === "for" ? "text-green-700" : "text-red-700"
                }`}>
                  {mySpeaker}, you're up!
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  Hand the device to {mySpeaker}
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
                      : `${mySpeaker}, speak or type your argument...`
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
                  (isSolo ? currentTurn : mySide) === "for"
                    ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
                }`}
              >
                Submit {mySpeaker}'s Argument ({myResponsesCount + 1}/{turnsPerSide})
              </button>
            </div>
          ) : !isSolo ? (
            <div className="p-6 text-center">
              <div className="text-xl font-bold text-slate-600">
                {mySideExhausted
                  ? `You've used all ${turnsPerSide} arguments — waiting for ${opponentName}…`
                  : `${opponentName}'s turn to argue…`}
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
