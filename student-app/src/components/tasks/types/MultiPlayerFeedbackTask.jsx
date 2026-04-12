// student-app/src/components/tasks/types/MultiPlayerFeedbackTask.jsx
import React, { useMemo, useState, useEffect } from "react";

const PLAYER_COLORS = [
  { bg: "linear-gradient(135deg, #FF6B6B, #FF8E72)", light: "rgba(255,107,107,0.1)", emoji: "🎯" },
  { bg: "linear-gradient(135deg, #4ECDC4, #44A08D)", light: "rgba(78,205,196,0.1)", emoji: "🚀" },
  { bg: "linear-gradient(135deg, #FFE66D, #FFA500)", light: "rgba(255,230,109,0.1)", emoji: "⭐" },
  { bg: "linear-gradient(135deg, #95E1D3, #38ada9)", light: "rgba(149,225,211,0.1)", emoji: "💎" },
  { bg: "linear-gradient(135deg, #A8EDEA, #fed6e3)", light: "rgba(168,237,234,0.1)", emoji: "🔥" },
];

const FeedbackCard = ({ icon, title, value, onChange, placeholder, isTextarea = false, bonus = false }) => {
  const [focused, setFocused] = useState(false);

  const CardComponent = isTextarea ? "textarea" : "input";

  return (
    <div
      style={{
        animation: "slideInUp 0.6s ease-out forwards",
        opacity: 0,
      }}
      onAnimationEnd={(e) => e.target.style.opacity = "1"}
    >
      <style>{`
        @keyframes slideInUp {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,250,252,0.95))",
          borderRadius: 20,
          padding: "18px 20px",
          border: focused ? "2px solid #0ea5e9" : "2px solid rgba(15,23,42,0.08)",
          transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
          boxShadow: focused ? "0 20px 40px rgba(14,165,233,0.15)" : "0 8px 16px rgba(0,0,0,0.06)",
          cursor: "text",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
          <span style={{ fontSize: "1.5rem", minWidth: 28 }}>{icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#1e293b" }}>
                {title}
              </span>
              {bonus && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(59,130,246,0.1))",
                    border: "1px solid rgba(34,197,94,0.3)",
                    color: "#16a34a",
                    fontWeight: 900,
                  }}
                >
                  +1 bonus
                </span>
              )}
            </div>
            <CardComponent
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              rows={isTextarea ? 3 : undefined}
              style={{
                width: "100%",
                padding: "12px 0",
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: "0.95rem",
                fontFamily: "inherit",
                resize: isTextarea ? "vertical" : "none",
                minHeight: isTextarea ? "80px" : "auto",
                color: "#334155",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const RatingButton = ({ value, isSelected, onClick }) => {
  const ratingEmojis = ["😢", "😞", "😐", "😊", "🤩"];
  const ratingColors = [
    "linear-gradient(135deg, #FF6B6B, #FF8E72)",
    "linear-gradient(135deg, #FFB347, #FFA500)",
    "linear-gradient(135deg, #FFE66D, #FFA500)",
    "linear-gradient(135deg, #95E1D3, #38ada9)",
    "linear-gradient(135deg, #4ECDC4, #44A08D)",
  ];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: isSelected ? "16px 12px" : "12px 10px",
        borderRadius: 16,
        border: "none",
        background: isSelected ? ratingColors[value - 1] : "rgba(15,23,42,0.04)",
        color: isSelected ? "#fff" : "#64748b",
        fontWeight: 900,
        fontSize: isSelected ? "1.8rem" : "1.5rem",
        cursor: "pointer",
        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: isSelected ? "scale(1.15) translateY(-4px)" : "scale(1)",
        boxShadow: isSelected ? `0 16px 32px ${(ratingColors[value - 1].match(/#\w+/) || ["#888"])[0]}40` : "0 4px 8px rgba(0,0,0,0.04)",
        minWidth: 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {ratingEmojis[value - 1]}
    </button>
  );
};

const Confetti = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  const confetti = Array.from({ length: 30 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 2 + Math.random() * 0.5,
  }));

  return (
    <>
      <style>{`
        @keyframes confettiFall {
          0% {
            transform: translateY(0) rotateZ(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotateZ(720deg);
            opacity: 0;
          }
        }
      `}</style>
      {confetti.map((c) => (
        <div
          key={c.id}
          style={{
            position: "fixed",
            left: `${c.left}%`,
            top: 0,
            fontSize: "1.5rem",
            pointerEvents: "none",
            animation: `confettiFall ${c.duration}s linear ${c.delay}s forwards`,
            zIndex: 9999,
          }}
        >
          {["🎉", "🎊", "⭐", "🌟", "💫", "🎈"][Math.floor(Math.random() * 6)]}
        </div>
      ))}
    </>
  );
};

export default function MultiPlayerFeedbackTask({
  roomCode,
  teamId,
  teamName,
  socket,
  onSubmit,
}) {
  const [rating, setRating] = useState(4);
  const [favorite, setFavorite] = useState("");
  const [improve, setImprove] = useState("");
  const [note, setNote] = useState("");
  const [learned, setLearned] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const playerColor = useMemo(() => {
    const hash = String(teamId || "").charCodeAt(0) || 0;
    return PLAYER_COLORS[hash % PLAYER_COLORS.length];
  }, [teamId]);

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
      highlights: String(note || "").trim() || null,
      improvements: String(improve || "").trim() || null,
      favoriteTask: String(favorite || "").trim() || null,
      whatILearned: String(learned || "").trim() || null,
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
      socket?.emit?.("feedback:submit", payload);
    } catch {}

    try {
      onSubmit && onSubmit(payload);
    } finally {
      setSubmitted(true);
      setTimeout(() => setSending(false), 2500);
    }

    // Play celebration sound
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.volume = 0.6;
      audio.play().catch(() => {});
    } catch {}
  };

  if (submitted) {
    return (
      <>
        <Confetti onComplete={() => setSubmitted(false)} />
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.1)",
            backdropFilter: "blur(4px)",
            zIndex: 9998,
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes popIn {
              0% {
                transform: scale(0.8) rotateZ(-5deg);
                opacity: 0;
              }
              50% {
                transform: scale(1.05);
              }
              100% {
                transform: scale(1) rotateZ(0);
                opacity: 1;
              }
            }
          `}</style>
          <div
            style={{
              background: "linear-gradient(135deg, #fff 0%, #f8fafc 100%)",
              borderRadius: 28,
              padding: "40px 32px",
              textAlign: "center",
              boxShadow: "0 40px 80px rgba(0,0,0,0.2)",
              maxWidth: 400,
              animation: "popIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <div style={{ fontSize: "4rem", marginBottom: 20 }}>🎉</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#1e293b", marginBottom: 12 }}>
              Feedback submitted!
            </div>
            <div style={{ fontSize: "0.95rem", color: "#64748b", marginBottom: 20 }}>
              Great job sharing your thoughts. You're helping make the next round even better!
              {String(learned || "").trim().length > 0 && (
                <div style={{ marginTop: 12, fontWeight: 700, color: "#16a34a" }}>
                  ✨ +1 bonus point earned!
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "#94a3b8",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            >
              <style>{`
                @keyframes pulse {
                  0%, 100% { opacity: 0.6; }
                  50% { opacity: 1; }
                }
              `}</style>
              Closing in a moment...
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
        borderRadius: 24,
        padding: "24px 20px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes slideDown {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes fadeInDelayed {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>

      <div style={{ animation: "slideDown 0.5s ease-out", marginBottom: 32 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: playerColor.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.8rem",
              color: "#fff",
              boxShadow: "0 12px 24px rgba(0,0,0,0.15)",
            }}
          >
            {playerColor.emoji}
          </div>
          <div>
            <div
              style={{
                fontSize: "1.4rem",
                fontWeight: 900,
                color: "#1e293b",
                lineHeight: 1.2,
              }}
            >
              Share Your Feedback
            </div>
            <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 4 }}>
              {teamName && <span>Team: <strong>{teamName}</strong></span>}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.8), rgba(248,250,252,0.8))",
            borderRadius: 16,
            padding: "16px 18px",
            border: "1px solid rgba(15,23,42,0.08)",
            fontSize: "0.9rem",
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          Help us make the next round even more fun! Your honest feedback takes just 30 seconds and
          you might earn a bonus point. 🚀
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          marginBottom: 28,
          animation: "fadeInDelayed 0.6s ease-out 0.2s both",
        }}
      >
        <div>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#1e293b" }}>
              How fun was this round?
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <RatingButton
                key={n}
                value={n}
                isSelected={n === rating}
                onClick={() => setRating(n)}
              />
            ))}
          </div>
        </div>

        <FeedbackCard
          icon="⭐"
          title="What was your favorite part?"
          value={favorite}
          onChange={setFavorite}
          placeholder="e.g., The treasure hunt, team games, winning a round..."
        />

        <FeedbackCard
          icon="🎯"
          title="One thing to improve?"
          value={improve}
          onChange={setImprove}
          placeholder="e.g., More time, clearer hints, harder questions..."
        />

        <FeedbackCard
          icon="💭"
          title="Anything else?"
          value={note}
          onChange={setNote}
          placeholder="Share any other thoughts or ideas..."
          isTextarea
        />

        <FeedbackCard
          icon="🧠"
          title="What did you learn?"
          value={learned}
          onChange={setLearned}
          placeholder="Write something you discovered or understood..."
          isTextarea
          bonus
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
          animation: "slideDown 0.6s ease-out 0.4s both",
        }}
      >
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          style={{
            padding: "16px 28px",
            borderRadius: 999,
            border: "none",
            background: canSend
              ? "linear-gradient(135deg, #0ea5e9, #06b6d4)"
              : "linear-gradient(135deg, #cbd5e1, #94a3b8)",
            color: "#fff",
            fontWeight: 900,
            fontSize: "0.95rem",
            cursor: canSend ? "pointer" : "not-allowed",
            boxShadow: canSend ? "0 20px 40px rgba(6,182,212,0.3)" : "none",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transform: "translateY(0)",
          }}
          onMouseEnter={(e) => {
            if (canSend) {
              e.target.style.transform = "translateY(-2px)";
              e.target.style.boxShadow = "0 24px 48px rgba(6,182,212,0.4)";
            }
          }}
          onMouseLeave={(e) => {
            if (canSend) {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 20px 40px rgba(6,182,212,0.3)";
            }
          }}
        >
          {sending ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTop: "2px solid #fff",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              >
                <style>{`
                  @keyframes spin {
                    to { transform: rotateZ(360deg); }
                  }
                `}</style>
              </span>
              Submitting...
            </span>
          ) : (
            "Submit feedback"
          )}
        </button>
      </div>
    </div>
  );
}
