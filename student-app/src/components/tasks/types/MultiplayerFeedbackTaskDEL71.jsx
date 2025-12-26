// student-app/src/components/tasks/types/MultiPlayerFeedbackTask.jsx
import React, { useMemo, useState } from "react";

export default function MultiPlayerFeedbackTask({
  roomCode,
  teamId,
  teamName,
  socket,
  onSubmit,
}) {
  const [rating, setRating] = useState(4); // 1..5
  const [favorite, setFavorite] = useState("");
  const [improve, setImprove] = useState("");
  const [note, setNote] = useState("");
  const [learned, setLearned] = useState("");
  const [sending, setSending] = useState(false);

  const canSend = useMemo(() => {
    return !!roomCode && !!teamId && !sending;
  }, [roomCode, teamId, sending]);

  const send = () => {
    if (!canSend) return;
    setSending(true);

    const payload = {
      type: "multi-player-feedback",
      roomCode: String(roomCode || "").trim().toUpperCase(),
      teamId,
      teamName: teamName || null,
      rating: Number(rating) || 0,
      favorite: String(favorite || "").trim() || null,
      improve: String(improve || "").trim() || null,
      note: String(note || "").trim() || null,
      learned: String(learned || "").trim() || null,
      bonusLearned: String(learned || "").trim().length > 0,
      bonusPoints: String(learned || "").trim().length > 0 ? 1 : 0,
      bonusReason: String(learned || "").trim().length > 0 ? "learned" : null,
      submittedAt: new Date().toISOString(),
    };

    try {
      // Fire-and-forget; server may or may not listen.
      socket?.emit?.("feedback:submit", payload);
    } catch {}

    try {
      onSubmit && onSubmit(payload);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ textAlign: "left" }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 900, marginBottom: 6 }}>
        🗳️ Quick Team Feedback
      </div>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Help improve the next round. This takes ~15 seconds.
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Overall fun (1–5)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: n === rating ? "2px solid #0ea5e9" : "1px solid rgba(15,23,42,0.25)",
                background: n === rating ? "rgba(14,165,233,0.15)" : "rgba(15,23,42,0.04)",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>Favorite part</span>
          <input
            value={favorite}
            onChange={(e) => setFavorite(e.target.value)}
            placeholder="e.g., Hangman, BrainSparkNotes, treasures…"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.2)",
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>One thing to improve</span>
          <input
            value={improve}
            onChange={(e) => setImprove(e.target.value)}
            placeholder="e.g., more time, clearer hints, harder questions…"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.2)",
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800 }}>Anything else?</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            rows={3}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.2)",
              outline: "none",
              resize: "vertical",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            What did you learn?
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.25)",
                color: "rgba(21,128,61,0.95)",
                fontWeight: 900,
              }}
              title="If you add a learning takeaway, Curriculate can award a +1 bonus point."
            >
              +1 bonus
            </span>
          </span>
          <input
            value={learned}
            onChange={(e) => setLearned(e.target.value)}
            placeholder="Optional (but worth a bonus point!)"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.2)",
              outline: "none",
            }}
          />
        </label>
      </div>

      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
            color: "#fff",
            fontWeight: 900,
            cursor: canSend ? "pointer" : "not-allowed",
            opacity: canSend ? 1 : 0.6,
            boxShadow: "0 12px 28px rgba(2,132,199,0.35)",
          }}
        >
          {sending ? "Sending…" : "Submit feedback"}
        </button>
      </div>
    </div>
  );
}
