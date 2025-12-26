import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * WordWeaverDuelTask
 * - Defensive: never assumes optional fields/events exist
 * - Duel-safe: can show opponent progress if socket emits updates (optional)
 * - No undefined references: no wrongGuesses/DroppableBlank/etc.
 *
 * Supported task shapes:
 *  - task.phrase OR task.targetPhrase OR task.solution: "THE QUICK BROWN FOX"
 *  - task.wordBank OR task.words: ["THE","QUICK","BROWN","FOX"] (optional; will auto-generate if missing)
 *  - task.prompt/task.instructions: optional
 */
export default function WordWeaverDuelTask({
  task,
  onSubmit,
  socket, // can be socketRef OR socket instance
  roomCode,
  teamId,
  disabled = false,
  mode = "play", // "play" | "review"
  review = null,
}) {
  const sock = useMemo(() => socket?.current || socket || null, [socket]);

  const phrase = useMemo(() => {
    const p = task?.targetPhrase ?? task?.phrase ?? task?.solution ?? task?.answerPhrase ?? "";
    return String(p || "").trim();
  }, [task]);

  const tokens = useMemo(() => {
    if (!phrase) return [];
    return phrase.split(/\s+/).filter(Boolean);
  }, [phrase]);

  const initialBank = useMemo(() => {
    const wb = task?.wordBank ?? task?.words ?? task?.bank ?? null;
    if (Array.isArray(wb) && wb.length) return wb.map((w) => String(w));
    if (!tokens.length) return [];
    const arr = [...tokens];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [task, tokens]);

  const prompt = useMemo(
    () =>
      task?.prompt ??
      task?.instructions ??
      "Rebuild the phrase by placing the correct words in order.",
    [task]
  );

  const [slots, setSlots] = useState(() => tokens.map(() => ""));
  const [bank, setBank] = useState(() => initialBank);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const [opponent, setOpponent] = useState({ teamId: null, filled: 0, submitted: false });

  const teamIdRef = useRef(teamId);
  const roomCodeRef = useRef(roomCode);
  useEffect(() => {
    teamIdRef.current = teamId;
  }, [teamId]);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // Reset state when task changes
  useEffect(() => {
    setSlots(tokens.map(() => ""));
    setBank(initialBank);
    setPickedIndex(null);
    setSubmitted(false);
    setOpponent({ teamId: null, filled: 0, submitted: false });
  }, [phrase, tokens, initialBank]);

  const canInteract = mode === "play" && !disabled && !submitted;

  // Optional socket listeners for opponent progress
  useEffect(() => {
    if (!sock || typeof sock.on !== "function") return;

    const handler = (payload) => {
      try {
        const p = payload || {};
        // ignore self
        if (p.teamId && teamIdRef.current && String(p.teamId) === String(teamIdRef.current)) return;
        // optional room guard
        if (p.roomCode && roomCodeRef.current && String(p.roomCode) !== String(roomCodeRef.current))
          return;

        const filled = Number.isFinite(p.filled)
          ? p.filled
          : Array.isArray(p.slots)
            ? p.slots.filter(Boolean).length
            : 0;

        setOpponent({
          teamId: p.teamId ?? null,
          filled,
          submitted: !!p.submitted,
        });
      } catch {
        // no-op
      }
    };

    sock.on("wordweaver:opponent-progress", handler);
    sock.on("wordweaver:progress", handler);
    sock.on("duel:progress", handler);

    return () => {
      try {
        sock.off?.("wordweaver:opponent-progress", handler);
        sock.off?.("wordweaver:progress", handler);
        sock.off?.("duel:progress", handler);
      } catch {
        // no-op
      }
    };
  }, [sock]);

  // Emit our progress (optional; harmless if server ignores it)
  useEffect(() => {
    if (!sock || typeof sock.emit !== "function") return;
    if (!roomCode || !teamId) return;
    if (mode !== "play") return;

    const filled = slots.filter(Boolean).length;

    try {
      sock.emit("wordweaver:progress", { roomCode, teamId, filled, submitted });
    } catch {
      // no-op
    }
  }, [sock, roomCode, teamId, slots, submitted, mode]);

  const placeWordIntoSlot = (slotIdx, word) => {
    if (!canInteract) return;
    const w = String(word || "").trim();
    if (!w) return;

    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = w;
      return next;
    });

    setBank((prev) => {
      const next = [...prev];
      const i = next.findIndex((x) => String(x) === String(w));
      if (i >= 0) next.splice(i, 1);
      return next;
    });

    setPickedIndex(null);
  };

  const clearSlot = (slotIdx) => {
    if (!canInteract) return;
    setSlots((prev) => {
      const next = [...prev];
      const removed = next[slotIdx];
      next[slotIdx] = "";
      if (removed) setBank((b) => [...b, removed]);
      return next;
    });
  };

  const handleSlotClick = (slotIdx) => {
    if (!canInteract) return;
    if (slots[slotIdx]) return clearSlot(slotIdx);
    if (pickedIndex !== null && bank[pickedIndex] != null) return placeWordIntoSlot(slotIdx, bank[pickedIndex]);
  };

  const handlePick = (idx) => {
    if (!canInteract) return;
    setPickedIndex((cur) => (cur === idx ? null : idx));
  };

  const handleReset = () => {
    if (!canInteract) return;
    setSlots(tokens.map(() => ""));
    setBank(initialBank);
    setPickedIndex(null);
  };

  const handleSubmit = () => {
    if (!canInteract) return;
    const answer = slots.join(" ").trim();

    setSubmitted(true);
    try {
      onSubmit?.({
        answer,
        slots,
        meta: {
          roomCode: roomCode ?? null,
          teamId: teamId ?? null,
          taskType: task?.taskType ?? "word-weaver-duel",
        },
      });
    } catch {
      setSubmitted(false);
    }

    if (sock && typeof sock.emit === "function" && roomCode && teamId) {
      try {
        sock.emit("wordweaver:submit", { roomCode, teamId, answer });
      } catch {
        // no-op
      }
    }
  };

  const progress = useMemo(() => {
    const filled = slots.filter(Boolean).length;
    const total = Math.max(tokens.length, 1);
    return { filled, total, pct: tokens.length ? Math.round((filled / tokens.length) * 100) : 0 };
  }, [slots, tokens.length]);

  const reviewCorrect = useMemo(() => {
    if (mode !== "review") return null;
    if (review && typeof review === "object") {
      if (typeof review.correct === "boolean") return review.correct;
      if (typeof review.isCorrect === "boolean") return review.isCorrect;
      if (typeof review.score === "number") return review.score > 0;
    }
    return null;
  }, [mode, review]);

  // -------- Defensive rendering ----------
  if (!task) {
    return (
      <div className="task task-wordweaver" style={styles.wrap}>
        <h2 style={styles.title}>Word Weaver</h2>
        <div style={styles.muted}>No task data received.</div>
      </div>
    );
  }

  if (!phrase || tokens.length === 0) {
    return (
      <div className="task task-wordweaver" style={styles.wrap}>
        <h2 style={styles.title}>Word Weaver</h2>
        <div style={styles.muted}>
          Missing phrase. Expected <code>task.phrase</code> or <code>task.targetPhrase</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="task task-wordweaver" style={styles.wrap}>
      <div style={styles.headerRow}>
        <h2 style={styles.title}>Word Weaver</h2>
        <div style={styles.pill}>
          {progress.filled}/{progress.total}
        </div>
      </div>

      <div style={styles.prompt}>{prompt}</div>

      {(opponent.teamId || opponent.filled > 0 || opponent.submitted) && (
        <div style={styles.duelBox}>
          <div style={styles.duelTitle}>Duel status</div>
          <div style={styles.duelLine}>
            <span style={styles.duelLabel}>You:</span>
            <span>
              {progress.filled}/{progress.total} {submitted ? "• submitted" : ""}
            </span>
          </div>
          <div style={styles.duelLine}>
            <span style={styles.duelLabel}>Opponent:</span>
            <span>
              {opponent.filled}/{progress.total} {opponent.submitted ? "• submitted" : ""}
            </span>
          </div>
        </div>
      )}

      <div style={styles.slotsWrap}>
        {tokens.map((_, i) => {
          const filled = !!slots[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSlotClick(i)}
              disabled={!canInteract}
              style={{
                ...styles.slot,
                ...(filled ? styles.slotFilled : styles.slotEmpty),
              }}
              title={
                canInteract
                  ? filled
                    ? "Click to remove this word"
                    : pickedIndex !== null
                      ? "Click to place the selected word here"
                      : "Select a word below, then click here"
                  : ""
              }
            >
              {filled ? slots[i] : "_____"}
            </button>
          );
        })}
      </div>

      <div style={styles.bankTitle}>Word Bank</div>
      <div style={styles.bankWrap}>
        {bank.length === 0 ? (
          <div style={styles.muted}>No words left in the bank.</div>
        ) : (
          bank.map((w, idx) => {
            const selected = pickedIndex === idx;
            return (
              <button
                key={`${w}-${idx}`}
                type="button"
                onClick={() => handlePick(idx)}
                disabled={!canInteract}
                style={{
                  ...styles.wordChip,
                  ...(selected ? styles.wordChipSelected : null),
                }}
                aria-pressed={selected}
              >
                {w}
              </button>
            );
          })
        )}
      </div>

      <div style={styles.controls}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canInteract || slots.some((s) => !s)}
          style={styles.submitBtn}
        >
          Submit
        </button>
        <button type="button" onClick={handleReset} disabled={!canInteract} style={styles.secondaryBtn}>
          Reset
        </button>
      </div>

      {mode === "review" && (
        <div style={styles.reviewBox}>
          <div style={styles.reviewTitle}>Review</div>
          {reviewCorrect === null ? (
            <div style={styles.muted}>Feedback not available.</div>
          ) : reviewCorrect ? (
            <div style={styles.good}>Correct ✅</div>
          ) : (
            <div style={styles.bad}>Not quite ❌</div>
          )}
          {review?.feedback && <div style={styles.feedback}>{String(review.feedback)}</div>}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
  },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { margin: 0, fontSize: 22, lineHeight: "26px" },
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    opacity: 0.9,
  },
  prompt: { marginTop: 8, opacity: 0.92 },
  slotsWrap: { marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 },
  slot: {
    padding: "10px 12px",
    minWidth: 84,
    borderRadius: 12,
    border: "1px dashed rgba(255,255,255,0.18)",
    cursor: "pointer",
    fontSize: 14,
  },
  slotEmpty: { background: "rgba(0,0,0,0.12)", opacity: 0.9 },
  slotFilled: { background: "rgba(255,255,255,0.06)", borderStyle: "solid" },
  bankTitle: { marginTop: 14, fontWeight: 600, opacity: 0.92 },
  bankWrap: { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 },
  wordChip: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    cursor: "pointer",
    fontSize: 13,
  },
  wordChipSelected: {
    transform: "scale(1.02)",
    border: "1px solid rgba(255,255,255,0.35)",
    background: "rgba(255,255,255,0.12)",
  },
  controls: { marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" },
  submitBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    cursor: "pointer",
    fontWeight: 700,
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.10)",
    cursor: "pointer",
    fontWeight: 600,
    opacity: 0.95,
  },
  muted: { opacity: 0.7, marginTop: 8 },
  duelBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.12)",
  },
  duelTitle: { fontWeight: 700, marginBottom: 6, opacity: 0.9 },
  duelLine: { opacity: 0.9, display: "flex", gap: 6, flexWrap: "wrap" },
  duelLabel: { opacity: 0.75, minWidth: 72 },
  reviewBox: {
    marginTop: 14,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.10)",
  },
  reviewTitle: { fontWeight: 700, marginBottom: 6, opacity: 0.9 },
  good: { fontWeight: 800 },
  bad: { fontWeight: 800 },
  feedback: { marginTop: 8, opacity: 0.9 },
};
