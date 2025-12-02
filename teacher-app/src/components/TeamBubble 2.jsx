// src/components/TeamBubble.jsx
import React from "react";

export default function TeamBubble({ team }) {
  if (!team) return null;

  return (
    <div
      style={{
        background: team.teamColor || "rgba(148,163,184,0.25)",
        color: team.teamColor ? "#fff" : "#000",
        padding: "8px 12px",
        borderRadius: 10,
        minWidth: 150,
      }}
    >
      <strong>{team.teamName}</strong>{" "}
      {team.teamColor ? `(${team.teamColor})` : ""}
      {(team.members || []).length > 0 && (
        <div style={{ fontSize: "0.7rem" }}>{team.members.join(", ")}</div>
      )}
    </div>
  );
}
