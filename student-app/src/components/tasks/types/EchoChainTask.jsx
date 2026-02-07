// student-app/src/components/tasks/types/EchoChainTask.jsx
import React, { useMemo, useState } from "react";
import { TaskCardFrame, PrimaryButton, GhostButton, TextInput } from "../taskStyles";

/**
 * Echo Chain
 * Contract: seed term MUST be provided by the task (prefer task.config.seedTerm).
 * We do NOT show a vague placeholder like "the seed term".
 */
export default function EchoChainTask({ task }) {
  const seed = useMemo(() => {
    // Canonical: config.seedTerm
    const cfgSeed = task?.config?.seedTerm;
    if (typeof cfgSeed === "string" && cfgSeed.trim()) return cfgSeed.trim();

    // Fallbacks (legacy)
    const topSeed = task?.seedTerm;
    if (typeof topSeed === "string" && topSeed.trim()) return topSeed.trim();

    if (Array.isArray(task?.ECHO_CHAIN) && task.ECHO_CHAIN.length > 0) {
      const legacy = task.ECHO_CHAIN[0];
      if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    }

    return "";
  }, [task]);

  const [chain, setChain] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [input, setInput] = useState("");
  const [seedVisible, setSeedVisible] = useState(true); // Player 1 only
  const [revealTemporarily, setRevealTemporarily] = useState(false);

  const isFirstTurn = chain.length === 0 && currentPlayer === 1;

  const handleSubmit = () => {
    if (!input.trim()) return;

    setChain((prev) => [...prev, input.trim()]);
    setInput("");
    setSeedVisible(false); // auto-hide seed forever after first move
    setRevealTemporarily(false);
    setCurrentPlayer((p) => p + 1);
  };

  const handleReset = () => {
    setChain([]);
    setCurrentPlayer(1);
    setInput("");
    setSeedVisible(true);
    setRevealTemporarily(false);
  };

  return (
    <TaskCardFrame>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Echo Chain</h2>
          <div style={{ color: "#6b7280", fontWeight: 600, marginTop: 4 }}>
            Build a spoken chain together—no silent reading.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>Speaker:</div>
          <select
            value={currentPlayer}
            onChange={(e) => setCurrentPlayer(Number(e.target.value) || 1)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "8px 12px",
              fontWeight: 800,
              background: "white",
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                Player {i + 1}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>How to play</h3>
      <ul style={{ marginTop: 8 }}>
        <li>
          Start with:{" "}
          <strong>{seed ? seed : "(missing seed term — task is invalid)"}</strong>
        </li>
        <li>Player 1 says it aloud and adds one related term.</li>
        <li>Next player repeats the full chain in order and adds one.</li>
        <li>If someone forgets or changes order, the chain breaks—reset and try again.</li>
      </ul>

      {!seed ? (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "2px solid #dc2626",
            background: "#fee2e2",
            color: "#7f1d1d",
            fontWeight: 800,
          }}
        >
          This Echo Chain task is missing a seed term. The task generator must supply
          <code style={{ marginLeft: 6, marginRight: 6 }}>config.seedTerm</code>
          (a real word/phrase) so the game can start.
        </div>
      ) : null}

      <h3 style={{ marginTop: 16 }}>Current chain ({chain.length})</h3>
      <div style={{ color: "#6b7280", fontWeight: 700, marginTop: 4 }}>
        Tip: one person says the full chain out loud. Keep it hidden to avoid silent reading.
      </div>

      {/* Seed visibility: Player 1 only, first turn only */}
      {seed && isFirstTurn && seedVisible ? (
        <div
          style={{
            padding: "16px",
            borderRadius: "12px",
            border: "2px dashed var(--accent)",
            background: "var(--soft-bg)",
            marginTop: "12px",
            marginBottom: "12px",
            fontSize: "1.2em",
            fontWeight: 800,
          }}
        >
          Seed term (Player 1 only): <strong>{seed}</strong>
        </div>
      ) : (
        <div
          style={{
            padding: "16px",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            background: "var(--panel-bg)",
            marginTop: "12px",
            marginBottom: "12px",
            color: "#6b7280",
            fontWeight: 700,
          }}
        >
          Chain is spoken aloud. No on-screen clues.
          {seed && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => {
                  setRevealTemporarily(true);
                  setTimeout(() => setRevealTemporarily(false), 1500);
                }}
                style={{
                  marginLeft: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "6px 10px",
                  background: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Reveal seed (1.5s)
              </button>
              {revealTemporarily && (
                <span style={{ marginLeft: 10, fontWeight: 900, color: "#0f172a" }}>
                  {seed}
                </span>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <TextInput
          placeholder="Type the next word your team adds…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!seed}
        />
        <PrimaryButton onClick={handleSubmit} disabled={!seed}>
          Submit
        </PrimaryButton>
        <GhostButton onClick={handleReset}>Reset</GhostButton>
      </div>
    </TaskCardFrame>
  );
}
