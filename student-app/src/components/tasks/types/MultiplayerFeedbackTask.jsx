// student-app/src/components/tasks/types/MultiplayerFeedbackTask.jsx
import React, { useState } from "react";

const EMOJIS = [
  { emoji: "😍", value: 5, label: "Loved it!" },
  { emoji: "😊", value: 4, label: "Really liked it" },
  { emoji: "🙂", value: 3, label: "It was okay" },
  { emoji: "😐", value: 2, label: "Meh" },
  { emoji: "😞", value: 1, label: "Didn't like it" },
];

const MultiplayerFeedbackTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const [ratings, setRatings] = useState(Array(playerCount).fill(null)); // null or 1-5
  const [comment, setComment] = useState("");

  const handleRating = (playerIndex, value) => {
    const newRatings = [...ratings];
    newRatings[playerIndex] = value;
    setRatings(newRatings);
  };

  const handleSubmit = () => {
    socket.current.emit("submit-multiplayer-feedback", {
      roomCode,
      teamId,
      ratings, // array [5, 4, null, 2]
      comment: comment.trim(),
    });
    onSubmit({ feedbackSent: true });
  };

  const allRated = ratings.every(r => r !== null);

  return (
    <div style={{
      padding: 32,
      textAlign: "center",
      minHeight: "80vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      background: "linear-gradient(135deg, #e0e7ff, #c7d2fe)",
    }}>
      <h2 style={{ fontSize: "2rem", marginBottom: 40 }}>
        How did your team like this set?
      </h2>

      {Array.from({ length: playerCount }, (_, i) => (
        <div key={i} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: "1.3rem", marginBottom: 12 }}>
            Player {i + 1}
          </h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
            {EMOJIS.map((e) => (
              <button
                key={e.value}
                onClick={() => handleRating(i, e.value)}
                style={{
                  fontSize: "3.5rem",
                  background: ratings[i] === e.value ? "#22c55e" : "rgba(255,255,255,0.7)",
                  borderRadius: 16,
                  padding: 12,
                  border: ratings[i] === e.value ? "4px solid #15803d" : "none",
                  cursor: "pointer",
                }}
              >
                {e.emoji}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div style={{ margin: "40px 0" }}>
        <label style={{ fontSize: "1.1rem", display: "block", marginBottom: 12 }}>
          Team comment (optional)
        </label>
        <textarea
          placeholder="What did you like? Any suggestions?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          style={{
            width: "90%",
            maxWidth: 500,
            padding: 16,
            fontSize: "1rem",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            background: "#fff",
          }}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allRated}
        style={{
          padding: "16px 40px",
          fontSize: "1.3rem",
          fontWeight: 700,
          background: allRated ? "#22c55e" : "#94a3b8",
          color: "#fff",
          border: "none",
          borderRadius: 999,
          cursor: allRated ? "pointer" : "not-allowed",
          opacity: allRated ? 1 : 0.6,
        }}
      >
        Send Team Feedback
      </button>

      <p style={{ marginTop: 24, fontSize: "0.9rem", color: "#64748b" }}>
        You can skip if you want — thanks for playing!
      </p>
    </div>
  );
};

export default MultiplayerFeedbackTask;