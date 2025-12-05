// student-app/src/components/tasks/types/BrainstormBattleTask.jsx

import React, { useState, useEffect } from "react";

export default function BrainstormBattleTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [ideaInput, setIdeaInput] = useState("");
  const [myIdeas, setMyIdeas] = useState([]);
  const [teamsSummary, setTeamsSummary] = useState({});
  const [timeLeft, setTimeLeft] = useState(
    typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0
      ? task.timeLimitSeconds
      : 90
  );
  const [submitted, setSubmitted] = useState(false);

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
      // payload: { taskKey, teams: { [teamId]: { teamId, teamName, ideaCount } } }
      if (!payload || !payload.teams) return;
      setTeamsSummary(payload.teams);
    };

    socket.on("brainstorm:update", handleUpdate);
    return () => {
      socket.off("brainstorm:update", handleUpdate);
    };
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

    // Notify backend so all teams see updated counts
    if (socket) {
      socket.emit("brainstorm:idea", {
        ideaText: idea,
        // We intentionally do NOT require roomCode/teamId here;
        // the backend will infer from socket.data when possible.
        taskIndex: typeof task?.index === "number" ? task.index : undefined,
      });
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    setSubmitted(true);

    // Let the normal submit pipeline handle scoring & progression
    if (typeof onSubmit === "function") {
      onSubmit({
        ideas: myIdeas,
      });
    }
  };

  const totalTeams = Object.keys(teamsSummary || {}).length;

  return (
    <div className="flex flex-col h-full w-full items-center justify-start p-4 sm:p-6 md:p-8 bg-gradient-to-br from-sky-900 via-indigo-900 to-slate-900 text-white">
      {/* Header */}
      <div className="w-full max-w-4xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
            Brainstorm Battle
          </h1>
          {task?.prompt && (
            <p className="mt-2 text-base sm:text-lg text-slate-100/80">
              {task.prompt}
            </p>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-slate-200/70">
              Time left
            </p>
            <p
              className={
                "text-3xl sm:text-4xl font-black " +
                (timeLeft <= 15 ? "text-red-400 animate-pulse" : "text-emerald-300")
              }
            >
              {timeLeft}s
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-slate-200/70">
              Your ideas
            </p>
            <p className="text-3xl sm:text-4xl font-black text-amber-300">
              {myIdeas.length}
            </p>
          </div>
        </div>
      </div>

      {/* Main layout: left = my ideas, right = scoreboard */}
      <div className="w-full max-w-6xl flex-1 flex flex-col lg:flex-row gap-6">
        {/* Left: idea entry + my ideas */}
        <div className="flex-1 flex flex-col bg-white/10 backdrop-blur-md rounded-2xl p-4 sm:p-6 shadow-xl border border-white/10">
          <p className="text-sm sm:text-base text-slate-100/90 mb-3">
            Think of as many good ideas as you can that fit the prompt.  
            Type one idea at a time and tap <span className="font-semibold">Add idea</span>.
          </p>

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
              placeholder="Type an idea and press Enter or Add…"
              className="flex-1 rounded-xl bg-slate-900/60 border border-slate-500/70 px-3 py-2 text-base sm:text-lg outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={addIdea}
              disabled={disabled || submitted}
              className="inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-base sm:text-lg font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30 transition"
            >
              Add idea
            </button>
          </div>

          {/* My ideas list */}
          <div className="flex-1 overflow-y-auto rounded-xl bg-slate-950/40 border border-slate-600/60 p-3 sm:p-4">
            {myIdeas.length === 0 ? (
              <p className="text-sm sm:text-base text-slate-300/80 italic">
                No ideas yet. First ideas are often the best ones—go for it!
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {myIdeas.map((idea, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-300 text-slate-900 text-xs sm:text-sm font-semibold shadow"
                  >
                    {idea}
                    {!submitted && !disabled && (
                      <button
                        type="button"
                        onClick={() =>
                          setMyIdeas((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="text-slate-800 hover:text-red-600 text-xs"
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

        {/* Right: live team scoreboard */}
        <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 bg-slate-950/50 backdrop-blur-md rounded-2xl p-4 sm:p-5 shadow-xl border border-sky-400/40">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
              Battle board
            </h2>
            <span className="text-xs uppercase tracking-wide text-slate-300/80">
              {totalTeams} team{totalTeams === 1 ? "" : "s"}
            </span>
          </div>

          {totalTeams === 0 ? (
            <p className="text-sm text-slate-300/80">
              When teams start adding ideas, their counts will appear here.
            </p>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {Object.values(teamsSummary)
                .sort((a, b) => b.ideaCount - a.ideaCount)
                .map((t) => (
                  <div
                    key={t.teamId}
                    className="flex items-center justify-between rounded-xl bg-slate-800/70 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold truncate max-w-[9rem]">
                      {t.teamName}
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
                      <span className="text-xs uppercase tracking-wide text-slate-300">
                        Ideas
                      </span>
                      <span className="text-xl">{t.ideaCount}</span>
                    </span>
                  </div>
                ))}
            </div>
          )}

          <div className="mt-4 text-xs text-slate-300/80">
            This board updates live for everyone whenever any team adds a new
            idea.
          </div>
        </div>
      </div>

      {/* Submit button */}
      <div className="w-full max-w-4xl mt-6 flex justify-center">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || submitted}
          className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-lg font-semibold bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed shadow-xl shadow-indigo-500/40 transition"
        >
          {submitted ? "Submitted!" : "Submit ideas"}
        </button>
      </div>
    </div>
  );
}
