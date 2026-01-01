// student-app/src/components/tasks/types/BrainstormBattleTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextInput } from "../taskStyles";

export default function BrainstormBattleTask({ task, onSubmit, disabled, socket }) {
  const [ideaInput, setIdeaInput] = useState("");
  const [myIdeas, setMyIdeas] = useState([]);
  const [teamsSummary, setTeamsSummary] = useState({});
  const [timeLeft, setTimeLeft] = useState(
    typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0 ? task.timeLimitSeconds : 90
  );
  const [submitted, setSubmitted] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // Timer
  useEffect(() => {
    if (disabled || submitted) return;
    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => (t > 0 ? t - 1 : 0)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, disabled, submitted]);

  // Scoreboard updates
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = (payload) => {
      if (!payload || !payload.teams) return;
      setTeamsSummary(payload.teams);
    };
    socket.on("brainstorm:update", handleUpdate);
    return () => socket.off("brainstorm:update", handleUpdate);
  }, [socket]);

  const cleanIdea = (text) => String(text || "").trim().replace(/\s+/g, " ");

  const addIdea = () => {
    if (disabled || submitted) return;
    const idea = cleanIdea(ideaInput);
    if (!idea) return;

    if (myIdeas.some((i) => i.toLowerCase() === idea.toLowerCase())) {
      setIdeaInput("");
      return;
    }

    const nextIdeas = [...myIdeas, idea];
    setMyIdeas(nextIdeas);
    setIdeaInput("");

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 450);

    socket?.emit?.("brainstorm:idea", {
      ideaText: idea,
      taskIndex: typeof task?.index === "number" ? task.index : undefined,
    });
  };

  const handleSubmit = () => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit?.({ ideas: myIdeas });
  };

  const prompt = String(task?.prompt || "").trim();
  const promptHint = prompt || "Brainstorm as many inventions as you can—wild ideas welcome!";

  const teamsList = useMemo(() => {
    const arr = Object.values(teamsSummary || {});
    arr.sort((a, b) => (b?.ideaCount || 0) - (a?.ideaCount || 0));
    return arr;
  }, [teamsSummary]);

  const leaderCount = teamsList?.[0]?.ideaCount || 0;
  const totalTeams = Object.keys(teamsSummary || {}).length;

  const totalSeconds =
    typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0 ? task.timeLimitSeconds : 90;

  const timePct = Math.max(0, Math.min(1, timeLeft / totalSeconds));
  const urgency = timeLeft <= 15;

  const right = (
    <>
      <Pill theme="dark">⏱️ {timeLeft}s</Pill>
      <Pill theme="dark">💡 Your ideas {myIdeas.length}</Pill>
      {submitted ? <Pill theme="dark">✅ Submitted</Pill> : null}
    </>
  );

  const chips = ["At school", "At home", "For sports", "For pets", "For backpacks"];

  return (
    <TaskCardFrame theme="dark" badge="⚔️ Brainstorm Battle" title="Launch ideas one at a time" subtitle={promptHint} right={right}>
      <style>{`
        @keyframes bbPop { 0%{transform:scale(.98);opacity:.75} 100%{transform:scale(1);opacity:1} }
        @keyframes bbPulse { 0%,100%{opacity:1} 50%{opacity:.65} }
      `}</style>

      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.9fr", gap: 14 }}>
        {/* Left panel */}
        <div
          style={{
            borderRadius: 26,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(2,6,23,0.30)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid rgba(255,255,255,0.10)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 10,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ fontWeight: 1100, fontSize: 16 }}>🚀 Launch</div>
            <div style={{ fontWeight: 850, fontSize: 12, color: "rgba(226,232,240,0.70)" }}>Short + clear wins</div>
          </div>

          <div style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <TextInput
                  theme="dark"
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
                />
              </div>

              <PrimaryButton disabled={disabled || submitted} onClick={addIdea} style={{ height: 52 }}>
                Launch 🚀
              </PrimaryButton>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chips.map((chip) => (
                <GhostButton
                  key={chip}
                  theme="dark"
                  disabled={disabled || submitted}
                  onClick={() => {
                    if (!ideaInput) setIdeaInput(`${chip}: `);
                  }}
                  style={{ padding: "10px 12px", borderRadius: 999, fontSize: 12 }}
                >
                  {chip}
                </GhostButton>
              ))}
            </div>

            <div
              style={{
                marginTop: 12,
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(2,6,23,0.35)",
                padding: 12,
                minHeight: 220,
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              {myIdeas.length === 0 ? (
                <div
                  style={{
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.06)",
                    padding: 14,
                    color: "rgba(226,232,240,0.80)",
                    fontWeight: 850,
                  }}
                >
                  <div style={{ fontWeight: 1100, marginBottom: 6 }}>No ideas yet—go for it!</div>
                  <div style={{ opacity: 0.85 }}>First ideas are often the best. Start simple, then get wild.</div>
                </div>
              ) : (
                <div>
                  {myIdeas.map((idea, idx) => (
                    <span
                      key={idx}
                      style={{
                        display: "inline-flex",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 12px",
                        borderRadius: 999,
                        background: "rgba(252,211,77,1)",
                        color: "#0b1220",
                        fontWeight: 1100,
                        margin: "0 8px 8px 0",
                        boxShadow: "0 14px 40px rgba(252,211,77,0.16)",
                        animation: justAdded && idx === myIdeas.length - 1 ? "bbPop 180ms ease-out" : undefined,
                      }}
                      title={idea}
                    >
                      <span
                        style={{
                          maxWidth: 420,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "inline-block",
                        }}
                      >
                        {idea}
                      </span>

                      {!submitted && !disabled && (
                        <button
                          type="button"
                          onClick={() => setMyIdeas((prev) => prev.filter((_, i) => i !== idx))}
                          style={{
                            marginLeft: 4,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontWeight: 1100,
                            color: "rgba(2,6,23,0.7)",
                          }}
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
        </div>

        {/* Right panel */}
        <div
          style={{
            borderRadius: 26,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(2,6,23,0.30)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid rgba(255,255,255,0.10)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 10,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ fontWeight: 1100, fontSize: 16 }}>🏁 Battle board</div>
            <div style={{ fontWeight: 850, fontSize: 12, color: "rgba(226,232,240,0.70)" }}>
              {totalTeams} team{totalTeams === 1 ? "" : "s"} • live
            </div>
          </div>

          <div style={{ padding: 14 }}>
            {totalTeams === 0 ? (
              <div
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.06)",
                  padding: 14,
                  color: "rgba(226,232,240,0.80)",
                  fontWeight: 850,
                }}
              >
                When teams start adding ideas, their counts will appear here.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, maxHeight: 420, overflow: "auto" }}>
                {teamsList.map((t, i) => {
                  const count = t?.ideaCount || 0;
                  const pct = leaderCount > 0 ? Math.max(0.08, count / leaderCount) : 0.12;
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏁";

                  return (
                    <div
                      key={t.teamId}
                      style={{
                        borderRadius: 20,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.06)",
                        padding: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                          <span style={{ fontSize: 18 }} aria-hidden="true">
                            {medal}
                          </span>
                          <div style={{ fontWeight: 1100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.teamName}
                          </div>
                        </div>
                        <div style={{ fontWeight: 1200, fontVariantNumeric: "tabular-nums", color: "rgba(52,211,153,1)" }}>
                          {count}
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          height: 10,
                          borderRadius: 999,
                          background: "rgba(2,6,23,0.45)",
                          border: "1px solid rgba(255,255,255,0.10)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.round(pct * 100)}%`,
                            background:
                              "linear-gradient(90deg, rgba(52,211,153,0.95), rgba(96,165,250,0.85), rgba(167,139,250,0.85))",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 12, color: "rgba(226,232,240,0.70)", fontWeight: 900 }}>
              Live updates: this board refreshes whenever any team adds an idea.
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <PrimaryButton disabled={disabled || submitted} onClick={handleSubmit}>
                {submitted ? "Submitted! ✅" : "Submit Ideas 🏁"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </TaskCardFrame>
  );
}
