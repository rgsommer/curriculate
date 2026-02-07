// student-app/src/components/tasks/types/BrainstormBattleTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextInput } from "../taskStyles";

export default function BrainstormBattleTask({ task, onSubmit, disabled, socket }) {
  const [ideaInput, setIdeaInput] = useState("");
  const [myIdeas, setMyIdeas] = useState([]);
  const [teamsSummary, setTeamsSummary] = useState({});
  const [socketWarn, setSocketWarn] = useState("");
  const [timeLeft, setTimeLeft] = useState(
    typeof task?.timeLimitSeconds === "number" && task.timeLimitSeconds > 0 ? task.timeLimitSeconds : 90
  );
  const [submitted, setSubmitted] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // Socket status (avoid silent failure). If socket exists but reports disconnected, treat as offline.
  const socketConnected = Boolean(socket) && (socket.connected !== false);

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

    // Do not silently fail if the room is not connected.
    if (!socketConnected) {
      setSocketWarn("Room not connected — ideas stay on this device only.");
      return;
    }

    try {
      socket?.emit?.("brainstorm:idea", {
        ideaText: idea,
        taskIndex: typeof task?.index === "number" ? task.index : undefined,
      });
      setSocketWarn("");
    } catch {
      setSocketWarn("Room not connected — ideas stay on this device only.");
    }
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
      {!socketConnected ? <Pill theme="dark">📡 Offline</Pill> : null}
      {submitted ? <Pill theme="dark">✅ Submitted</Pill> : null}
    </>
  );

  const chips = ["At school", "At home", "For sports", "For pets", "For backpacks"];

  return (
    <TaskCardFrame theme="dark" badge="⚔️ Brainstorm Battle" title="Shout ideas fast — type them in!" subtitle={promptHint} right={right}>
      <style>{`
        @keyframes bbPop { 0%{transform:scale(.98);opacity:.75} 100%{transform:scale(1);opacity:1} }
        @keyframes bbPulse { 0%,100%{opacity:1} 50%{opacity:.65} }
      `}</style>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.06)",
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 1100, marginBottom: 6 }}>How to play</div>
        <div style={{ color: "rgba(226,232,240,0.86)", fontWeight: 850, lineHeight: 1.35 }}>
          <div>1) As a team, <b>shout ideas</b>. One person types them.</div>
          <div>2) Add <b>one idea at a time</b> (short + clear).</div>
          <div>3) No repeats—build on each other and keep going until time is up.</div>
        </div>
      </div>

      {socketWarn ? (
        <div
          style={{
            marginTop: -6,
            marginBottom: 12,
            borderRadius: 16,
            border: "1px solid rgba(251,191,36,0.45)",
            background: "rgba(251,191,36,0.12)",
            padding: 12,
            fontWeight: 950,
            color: "rgba(226,232,240,0.92)",
          }}
        >
          📡 {socketWarn}
        </div>
      ) : null}

      {!socketConnected ? (
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(251,146,60,0.35)",
            background: "rgba(251,146,60,0.12)",
            padding: 12,
            marginBottom: 12,
            fontWeight: 900,
            color: "rgba(254,242,242,0.95)",
          }}
        >
          📡 <b>Room not connected.</b> Your ideas will still save for <b>your</b> team, but the live scoreboard may not update.
        </div>
      ) : socketWarn ? (
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(251,146,60,0.35)",
            background: "rgba(251,146,60,0.12)",
            padding: 12,
            marginBottom: 12,
            fontWeight: 900,
            color: "rgba(254,242,242,0.95)",
          }}
        >
          ⚠️ {socketWarn}
        </div>
      ) : null}

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
                        }}
                      >
                        {idea}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ opacity: 0.8, fontWeight: 850, fontSize: 12 }}>
                {totalTeams ? `Teams: ${totalTeams}` : " "}
                {leaderCount ? ` • Leader: ${leaderCount} ideas` : ""}
              </div>

              <PrimaryButton disabled={disabled || submitted} onClick={handleSubmit}>
                Submit ✅
              </PrimaryButton>
            </div>

            <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.round(timePct * 100)}%`,
                  transition: "width 200ms linear",
                  background: urgency
                    ? "linear-gradient(90deg, rgba(248,113,113,1), rgba(251,191,36,1))"
                    : "linear-gradient(90deg, rgba(56,189,248,1), rgba(34,197,94,1))",
                }}
              />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div
          style={{
            borderRadius: 26,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(2,6,23,0.22)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.30)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 14, borderBottom: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}>
            <div style={{ fontWeight: 1100, fontSize: 16 }}>🏁 Live scoreboard</div>
            <div style={{ fontWeight: 850, fontSize: 12, color: "rgba(226,232,240,0.70)" }}>
              {!socketConnected
                ? "Room offline — scoreboard may not update."
                : "(Optional) Shows idea counts if the room is connected."}
            </div>
          </div>

          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            {teamsList.length === 0 ? (
              <div style={{ color: "rgba(226,232,240,0.78)", fontWeight: 850 }}>No scoreboard yet.</div>
            ) : (
              teamsList.slice(0, 8).map((t, i) => (
                <div
                  key={t?.teamId || i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: 12,
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: i === 0 ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.06)",
                  }}
                >
                  <div style={{ fontWeight: 1000, color: "rgba(226,232,240,0.92)" }}>
                    {t?.teamName || `Team ${i + 1}`}
                  </div>
                  <Pill theme="dark">💡 {t?.ideaCount || 0}</Pill>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </TaskCardFrame>
  );
}
