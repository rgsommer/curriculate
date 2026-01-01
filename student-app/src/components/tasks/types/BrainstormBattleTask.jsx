// student-app/src/components/tasks/types/BrainstormBattleTask.jsx
import React, { useState, useEffect, useMemo } from "react";
import { UI } from "../taskStyles.js";

export default function BrainstormBattleTask({ task, onSubmit, disabled, socket }) {
  const [ideaInput, setIdeaInput] = useState("");
  const [myIdeas, setMyIdeas] = useState([]);
  const [teamsSummary, setTeamsSummary] = useState({});
  const [timeLeft, setTimeLeft] = useState(
    typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0
      ? task.timeLimitSeconds
      : 90
  );
  const [submitted, setSubmitted] = useState(false);

  // Tiny “pop” feedback when adding ideas
  const [justAdded, setJustAdded] = useState(false);

  // Basic timer (client-side only)
  useEffect(() => {
    if (disabled || submitted) return;
    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, disabled, submitted]);

  // Listen for brainstorm scoreboard updates from the server
  useEffect(() => {
    if (!socket) return;

    const handleUpdate = (payload) => {
      if (!payload || !payload.teams) return;
      setTeamsSummary(payload.teams);
    };

    socket.on("brainstorm:update", handleUpdate);
    return () => socket.off("brainstorm:update", handleUpdate);
  }, [socket]);

  const cleanIdea = (text) =>
    String(text || "")
      .trim()
      .replace(/\s+/g, " ");

  const addIdea = () => {
    if (disabled || submitted) return;
    const idea = cleanIdea(ideaInput);
    if (!idea) return;

    // Local de-duplication
    if (myIdeas.some((i) => i.toLowerCase() === idea.toLowerCase())) {
      setIdeaInput("");
      return;
    }

    const nextIdeas = [...myIdeas, idea];
    setMyIdeas(nextIdeas);
    setIdeaInput("");

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 450);

    if (socket) {
      socket.emit("brainstorm:idea", {
        ideaText: idea,
        taskIndex: typeof task?.index === "number" ? task.index : undefined,
      });
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    setSubmitted(true);
    if (typeof onSubmit === "function") {
      onSubmit({ ideas: myIdeas });
    }
  };

  const totalTeams = Object.keys(teamsSummary || {}).length;

  const prompt = String(task?.prompt || "").trim();
  const promptHint =
    prompt || "In groups, brainstorm as many inventions as you can—wild ideas welcome!";

  const teamsList = useMemo(() => {
    const arr = Object.values(teamsSummary || {});
    arr.sort((a, b) => (b?.ideaCount || 0) - (a?.ideaCount || 0));
    return arr;
  }, [teamsSummary]);

  const leaderCount = teamsList?.[0]?.ideaCount || 0;

  const timePct = useMemo(() => {
    const total =
      typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0
        ? task.timeLimitSeconds
        : 90;
    return Math.max(0, Math.min(1, timeLeft / total));
  }, [timeLeft, task?.timeLimitSeconds]);

  const urgency = timeLeft <= 15;

  return (
    <div className="flex flex-col h-full w-full items-center justify-start p-4 sm:p-6 md:p-8 bg-gradient-to-br from-sky-900 via-indigo-900 to-slate-900 text-white">
      <style>{`
        @keyframes bb-wiggle { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-2deg)} 75%{transform:rotate(2deg)} }
        @keyframes bb-pop { 0%{transform:scale(.98);opacity:.6} 100%{transform:scale(1);opacity:1} }
        @keyframes bb-pulse { 0%,100%{opacity:1} 50%{opacity:.65} }
      `}</style>

      {/* Top “arena” strip */}
      <div className="w-full max-w-6xl mb-6">
        <div className="rounded-3xl border border-white/10 bg-white/10 backdrop-blur-md shadow-2xl px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-4 py-2 rounded-full border bg-white text-slate-900 font-black tracking-widest text-xs">
                ⚔️ BRAINSTORM BATTLE
              </span>
              <span className="px-3 py-2 rounded-full border border-white/20 bg-slate-950/40 text-sm font-bold text-slate-100/90">
                Team mode • Fast ideas • No judging
              </span>
              {submitted && (
                <span className="px-3 py-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 text-sm font-extrabold text-emerald-200">
                  Submitted ✅
                </span>
              )}
            </div>

            <div className="text-sm sm:text-base text-slate-100/85">
              {promptHint}
            </div>

            {/* Quick hint chips (pure UI nudge) */}
            <div className="flex flex-wrap gap-2">
              {["At school", "At home", "For sports", "For pets", "For backpacks"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={disabled || submitted}
                  onClick={() => {
                    // Optional helper: pre-fill input with a nudge
                    if (!ideaInput) setIdeaInput(`${chip}: `);
                  }}
                  className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold hover:bg-white/15 disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Timer + count */}
          <div className="flex items-center gap-5">
            {/* Timer ring */}
            <div className="relative w-16 h-16 sm:w-20 sm:h-20">
              <div className="absolute inset-0 rounded-full bg-slate-950/40 border border-white/10" />
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(${urgency ? "#fb7185" : "#34d399"} ${Math.round(
                    timePct * 360
                  )}deg, rgba(255,255,255,0.12) 0deg)`,
                }}
              />
              <div className="absolute inset-2 rounded-full bg-slate-950/70 border border-white/10 flex items-center justify-center">
                <div
                  className={
                    "text-xl sm:text-2xl font-black " +
                    (urgency ? "text-rose-300" : "text-emerald-200")
                  }
                  style={urgency ? { animation: "bb-pulse 0.9s ease-in-out infinite" } : undefined}
                >
                  {timeLeft}
                </div>
              </div>
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-slate-200/70">
                seconds
              </div>
            </div>

            {/* Idea count */}
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-200/70">
                Your ideas
              </div>
              <div
                className="text-4xl sm:text-5xl font-black text-amber-300"
                style={justAdded ? { animation: "bb-pop 220ms ease-out" } : undefined}
              >
                {myIdeas.length}
              </div>
              {justAdded && (
                <div className="text-xs font-extrabold text-amber-200" style={{ animation: "bb-pop 220ms ease-out" }}>
                  +1 💥
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="w-full max-w-6xl flex-1 flex flex-col lg:flex-row gap-6">
        {/* Left: input + my ideas */}
        <div className="flex-1 flex flex-col rounded-3xl bg-white/10 backdrop-blur-md p-4 sm:p-6 shadow-2xl border border-white/10">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-sm sm:text-base font-bold text-slate-100/90">
              🚀 Launch ideas one at a time
            </div>
            <div className="text-xs text-slate-200/70">
              Tip: short + clear wins
            </div>
          </div>

          {/* Input row */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={ideaInput}
              onChange={(e) => setIdeaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addIdea();
                }
              }}
              disabled={disabled || submitted}
              placeholder="Invent something that solves a real problem…"
              className="flex-1 rounded-2xl bg-slate-950/40 border border-white/10 px-4 py-3 text-base sm:text-lg outline-none focus:ring-2 focus:ring-emerald-400/70 focus:border-emerald-400/60 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={addIdea}
              disabled={disabled || submitted}
              className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-base sm:text-lg font-black bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed shadow-xl shadow-emerald-500/25 transition"
            >
              Launch 🚀
            </button>
          </div>

          {/* My ideas “sticker board” */}
          <div className="flex-1 overflow-y-auto rounded-2xl bg-slate-950/35 border border-white/10 p-3 sm:p-4">
            {myIdeas.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-extrabold text-slate-100 mb-1">
                  No ideas yet—go for it!
                </div>
                <div className="text-sm text-slate-200/70">
                  First ideas are often the best. Start simple, then get wild.
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {myIdeas.map((idea, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-300 text-slate-900 text-xs sm:text-sm font-black shadow-lg shadow-amber-300/20"
                    style={{ animation: "bb-pop 180ms ease-out" }}
                    title={idea}
                  >
                    <span className="max-w-[16rem] truncate">{idea}</span>
                    {!submitted && !disabled && (
                      <button
                        type="button"
                        onClick={() => setMyIdeas((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-slate-800 hover:text-rose-600 text-xs"
                        aria-label="Remove idea"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: battle board */}
        <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 rounded-3xl bg-slate-950/45 backdrop-blur-md p-4 sm:p-5 shadow-2xl border border-sky-400/30">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-lime-400" style={{ animation: "bb-pulse 1s ease-in-out infinite" }} />
              Battle board
            </h2>
            <span className="text-xs uppercase tracking-widest text-slate-300/80">
              {totalTeams} team{totalTeams === 1 ? "" : "s"}
            </span>
          </div>

          {totalTeams === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/75">
              When teams start adding ideas, their counts will appear here.
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {teamsList.map((t, i) => {
                const count = t?.ideaCount || 0;
                const pct = leaderCount > 0 ? Math.max(0.08, count / leaderCount) : 0.12;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏁";

                return (
                  <div key={t.teamId} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-lg">{medal}</span>
                        <span className="font-extrabold truncate">{t.teamName}</span>
                      </div>
                      <div className="text-emerald-200 font-black text-xl">
                        {count}
                      </div>
                    </div>

                    <div className="mt-2 h-3 rounded-full bg-slate-950/40 border border-white/10 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.round(pct * 100)}%`,
                          background: "linear-gradient(90deg, #34d399, #60a5fa, #a78bfa)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-xs text-slate-300/80">
            Live updates: this board refreshes whenever any team adds an idea.
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="w-full max-w-6xl mt-6 flex justify-center">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || submitted}
          className={
            "inline-flex items-center justify-center rounded-[1.5rem] px-8 py-4 text-lg sm:text-xl font-black shadow-2xl transition " +
            (submitted
              ? "bg-emerald-500/30 text-emerald-100 border border-emerald-400/30"
              : "bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/30") +
            " disabled:opacity-60 disabled:cursor-not-allowed"
          }
        >
          {submitted ? "Submitted! ✅" : "Submit Ideas 🏁"}
        </button>
      </div>
    </div>
  );
}
