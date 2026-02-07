import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * WordWeaverDuelTask (WORD_WEAVER_DUEL)
 *
 * Supports TWO modes (backward compatible):
 * 1) Scrabble-like "words-on-grid" mode (preferred):
 *    - task.mode === "scrabble" OR task.words (5–10 words)
 *    - Players take turns placing whole words onto a grid (horizontal/vertical).
 *    - Simple scoring: points = word length + (2 * intersectionsCount)
 *    - Intra-team turnkeeper (no inter-team play required).
 *
 * 2) Legacy "phrase rebuild" mode:
 *    - task.phrase / task.targetPhrase / task.solution (string)
 *    - task.wordBank / task.words (array) used as selectable bank
 *
 * Defensive: never assumes optional fields/events exist.
 */
export default function WordWeaverDuelTask({
  task,
  onSubmit,
  socket, // socketRef OR socket instance
  roomCode,
  teamId,
  memberNames,
  disabled = false,
  mode = "play", // "play" | "review"
  review = null,
}) {
  const sock = useMemo(() => socket?.current || socket || null, [socket]);

  const canInteract = mode === "play" && !disabled;

  // ─────────────────────────────────────────────
  // Preferred Scrabble-like mode (words on grid)
  // ─────────────────────────────────────────────
  const scrabbleWords = useMemo(() => {
    const raw =
      Array.isArray(task?.words) ? task.words :
      Array.isArray(task?.config?.words) ? task.config.words :
      [];

    const cleaned = raw.map((w) => String(w || "").trim()).filter(Boolean).slice(0, 10);
    if (cleaned.length) return cleaned;

    // Fallback: derive 5–10 candidate words from prompt/title (keeps the task playable if AI forgets fields)
    const source =
      String(task?.prompt || task?.title || task?.topic || task?.category || "")
        .replace(/[^A-Za-z\s'-]/g, " ")
        .toLowerCase();

    const seen = new Set();
    const derived = [];
    for (const token of source.split(/\s+/g)) {
      const w = token.trim().replace(/^'+|'+$/g, "");
      if (!w) continue;
      if (w.length < 3 || w.length > 10) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      derived.push(w.toUpperCase());
      if (derived.length >= 10) break;
    }
    return derived.slice(0, 10);
  }, [task]);

  const gridSize = useMemo(() => {
    const n =
      Number.isFinite(Number(task?.gridSize)) && Number(task.gridSize) >= 7
        ? Number(task.gridSize)
        : Number.isFinite(Number(task?.config?.gridSize)) && Number(task.config.gridSize) >= 7
          ? Number(task.config.gridSize)
          : 11;
    return Math.max(7, Math.min(15, n));
  }, [task]);

  const scrabbleMode = useMemo(() => {
    const m = String(task?.mode || task?.config?.mode || "").trim().toLowerCase();
    if (m === "phrase") return false;
    if (m === "scrabble") return true;
    return scrabbleWords.length >= 1;
  }, [task, scrabbleWords.length]);

  // Turnkeeper config
  const turnkeeper = useMemo(() => {
    const tk = task?.turnkeeper || task?.config?.turnkeeper || {};
    const playerCount = Number(tk.playerCount) > 0 ? Number(tk.playerCount) : Number(task?.config?.playerCount) > 0 ? Number(task.config.playerCount) : 2;
    const perTurnSeconds = Number(tk.perTurnSeconds) > 0 ? Number(tk.perTurnSeconds) : 0;
    return { playerCount: Math.max(1, Math.min(6, playerCount)), perTurnSeconds };
  }, [task]);

  const players = useMemo(() => {
    // Prefer explicit memberNames (from TaskRunner) for the turn labels.
    const namesRaw =
      Array.isArray(memberNames) && memberNames.length
        ? memberNames
        : Array.isArray(task?.turnkeeper?.players)
          ? task.turnkeeper.players
          : Array.isArray(task?.config?.players)
            ? task.config.players
            : null;

    const base =
      Array.isArray(namesRaw) && namesRaw.length
        ? namesRaw.map((x) => String(x || "").trim()).filter(Boolean)
        : new Array(turnkeeper.playerCount).fill(0).map((_, i) => `Player ${i + 1}`);

    return base.slice(0, Math.max(1, turnkeeper.playerCount));
  }, [memberNames, task, turnkeeper.playerCount]);

  const [activePlayer, setActivePlayer] = useState(0);
  const [scores, setScores] = useState(() => ({})); // {playerIndex: number}
  const [selectedWordIdx, setSelectedWordIdx] = useState(null);
  const [orientation, setOrientation] = useState("H"); // H | V
  const [rotatedView, setRotatedView] = useState(false);

  // board is 2D char matrix + ownership of letters (which word placed it)
  const emptyBoard = useMemo(() => {
    const b = [];
    for (let r = 0; r < gridSize; r++) {
      const row = [];
      for (let c = 0; c < gridSize; c++) row.push({ ch: "", wordId: null });
      b.push(row);
    }
    return b;
  }, [gridSize]);

  const [board, setBoard] = useState(() => emptyBoard);
  const [placed, setPlaced] = useState(() => ({})); // { wordIdx: { r,c, orientation, playerIndex, points, intersections } }

  // simple per-turn timer (optional). purely UI.
  const [timeLeft, setTimeLeft] = useState(null);

  // Reset when task changes
  const taskKey = String(task?._id || task?.id || `${task?.taskType || "word-weaver"}:${gridSize}:${scrabbleWords.join("|")}`);
  useEffect(() => {
    setActivePlayer(0);
    setScores({});
    setSelectedWordIdx(null);
    setOrientation("H");
    setRotatedView(false);
    setBoard(emptyBoard);
    setPlaced({});
    setTimeLeft(turnkeeper.perTurnSeconds > 0 ? turnkeeper.perTurnSeconds : null);
  }, [taskKey, emptyBoard, turnkeeper.perTurnSeconds]);

  useEffect(() => {
    if (!canInteract) return;
    if (!turnkeeper.perTurnSeconds || turnkeeper.perTurnSeconds <= 0) return;
    setTimeLeft(turnkeeper.perTurnSeconds);
  }, [activePlayer, canInteract, turnkeeper.perTurnSeconds]);

  useEffect(() => {
    if (!canInteract) return;
    if (timeLeft == null) return;
    if (timeLeft <= 0) return;

    const tId = setTimeout(() => setTimeLeft((t) => (t == null ? null : t - 1)), 1000);
    return () => clearTimeout(tId);
  }, [timeLeft, canInteract]);

  const placedCount = useMemo(() => Object.keys(placed || {}).length, [placed]);
  const allPlaced = scrabbleWords.length > 0 && placedCount >= scrabbleWords.length;

  const computeIntersections = (r, c, word, ori, b) => {
    let intersections = 0;
    for (let i = 0; i < word.length; i++) {
      const rr = ori === "V" ? r + i : r;
      const cc = ori === "H" ? c + i : c;
      const cell = b?.[rr]?.[cc];
      if (cell?.ch) intersections += 1;
    }
    return intersections;
  };

  const canPlaceWord = (r, c, word, ori, b) => {
    if (!word) return { ok: false, reason: "No word selected." };
    const w = String(word).toUpperCase();

    // bounds
    if (ori === "H" && c + w.length > gridSize) return { ok: false, reason: "Doesn't fit horizontally." };
    if (ori === "V" && r + w.length > gridSize) return { ok: false, reason: "Doesn't fit vertically." };

    // conflicts
    for (let i = 0; i < w.length; i++) {
      const rr = ori === "V" ? r + i : r;
      const cc = ori === "H" ? c + i : c;
      const cell = b[rr][cc];
      const existing = cell?.ch ? String(cell.ch).toUpperCase() : "";
      const want = w[i];
      if (existing && existing !== want) return { ok: false, reason: `Conflict at ${rr + 1},${cc + 1}.` };
    }
    return { ok: true };
  };

  const placeWord = (r, c, wordIdx) => {
    if (!canInteract) return;
    if (wordIdx == null) return;
    if (placed?.[wordIdx]) return;

    const wordRaw = scrabbleWords[wordIdx] ?? "";
    const word = String(wordRaw).trim().toUpperCase();
    if (!word) return;

    setBoard((prev) => {
      const b = prev.map((row) => row.map((cell) => ({ ...cell })));
      const check = canPlaceWord(r, c, word, orientation, b);
      if (!check.ok) return prev;

      const intersections = computeIntersections(r, c, word, orientation, b);
      const points = word.length + intersections * 2;

      for (let i = 0; i < word.length; i++) {
        const rr = orientation === "V" ? r + i : r;
        const cc = orientation === "H" ? c + i : c;
        const cur = b[rr][cc];
        b[rr][cc] = { ch: word[i], wordId: cur?.wordId ?? wordIdx }; // preserve earlier ownership on intersections
      }

      setPlaced((p) => ({
        ...(p || {}),
        [wordIdx]: { r, c, orientation, playerIndex: activePlayer, points, intersections },
      }));

      setScores((s) => ({
        ...(s || {}),
        [activePlayer]: (Number(s?.[activePlayer]) || 0) + points,
      }));

      // advance turn
      setActivePlayer((ap) => (players.length ? (ap + 1) % players.length : ap));
      setSelectedWordIdx(null);

      return b;
    });
  };

  const handleCellDrop = (ev, r, c) => {
    if (!canInteract) return;
    ev.preventDefault?.();
    try {
      const payload = ev.dataTransfer?.getData?.("text/plain") || "";
      const idx = Number(payload);
      if (!Number.isFinite(idx)) return;
      placeWord(r, c, idx);
    } catch {
      // no-op
    }
  };

  const submitScrabble = () => {
    const payload = {
      mode: "scrabble",
      gridSize,
      words: scrabbleWords,
      placed,
      scores: Object.fromEntries(
        Object.entries(scores || {}).map(([k, v]) => [k, Number(v) || 0])
      ),
      players,
      endedBecause: allPlaced ? "allPlaced" : "manual",
      roomCode: roomCode ?? null,
      teamId: teamId ?? null,
      taskType: task?.taskType ?? "word-weaver-duel",
    };

    try {
      onSubmit?.(payload);
    } catch {
      // no-op
    }

    if (sock && typeof sock.emit === "function" && roomCode && teamId) {
      try {
        sock.emit("wordweaver:scrabble-submit", payload);
      } catch {
        // no-op
      }
    }
  };

  // ─────────────────────────────────────────────
  // Legacy phrase rebuild mode (existing behavior)
  // ─────────────────────────────────────────────
  const phrase = useMemo(() => {
    const p = task?.targetPhrase ?? task?.phrase ?? task?.solution ?? task?.answerPhrase ?? "";
    return String(p || "").trim();
  }, [task]);

  const tokens = useMemo(() => {
    if (!phrase) return [];
    return phrase.split(/\s+/).filter(Boolean);
  }, [phrase]);

  const initialBank = useMemo(() => {
    const wb = task?.wordBank ?? task?.bank ?? null;
    if (Array.isArray(wb) && wb.length) return wb.map((w) => String(w));
    if (Array.isArray(task?.words) && task.words.length && !scrabbleMode) return task.words.map((w) => String(w));
    if (!tokens.length) return [];
    const arr = [...tokens];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [task, tokens, scrabbleMode]);

  const phrasePrompt = useMemo(
    () =>
      task?.prompt ??
      task?.instructions ??
      "Rebuild the phrase by placing the correct words in order.",
    [task]
  );

  const [slots, setSlots] = useState(() => tokens.map(() => ""));
  const [bank, setBank] = useState(() => initialBank);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [submittedPhrase, setSubmittedPhrase] = useState(false);

  const [opponent, setOpponent] = useState({ teamId: null, filled: 0, submitted: false });

  const teamIdRef = useRef(teamId);
  const roomCodeRef = useRef(roomCode);
  useEffect(() => {
    teamIdRef.current = teamId;
  }, [teamId]);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // Reset phrase mode state when task changes
  useEffect(() => {
    setSlots(tokens.map(() => ""));
    setBank(initialBank);
    setPickedIndex(null);
    setSubmittedPhrase(false);
    setOpponent({ teamId: null, filled: 0, submitted: false });
  }, [phrase, tokens, initialBank]);

  const canInteractPhrase = mode === "play" && !disabled && !submittedPhrase;

  // Optional socket listeners for opponent progress (phrase mode only)
  useEffect(() => {
    if (scrabbleMode) return;
    if (!sock || typeof sock.on !== "function") return;

    const handler = (payload) => {
      try {
        const p = payload || {};
        if (p.teamId && teamIdRef.current && String(p.teamId) === String(teamIdRef.current)) return;
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
  }, [sock, scrabbleMode]);

  // Emit our progress (phrase mode only; harmless if server ignores it)
  useEffect(() => {
    if (scrabbleMode) return;
    if (!sock || typeof sock.emit !== "function") return;
    if (!roomCode || !teamId) return;
    if (mode !== "play") return;

    const filled = slots.filter(Boolean).length;

    try {
      sock.emit("wordweaver:progress", { roomCode, teamId, filled, submitted: submittedPhrase });
    } catch {
      // no-op
    }
  }, [sock, roomCode, teamId, slots, submittedPhrase, mode, scrabbleMode]);

  const placeWordIntoSlot = (slotIdx, word) => {
    if (!canInteractPhrase) return;
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
    if (!canInteractPhrase) return;
    setSlots((prev) => {
      const next = [...prev];
      const removed = next[slotIdx];
      next[slotIdx] = "";
      if (removed) setBank((b) => [...b, removed]);
      return next;
    });
  };

  const handleSlotClick = (slotIdx) => {
    if (!canInteractPhrase) return;
    if (slots[slotIdx]) return clearSlot(slotIdx);
    if (pickedIndex !== null && bank[pickedIndex] != null)
      return placeWordIntoSlot(slotIdx, bank[pickedIndex]);
  };

  const handlePick = (idx) => {
    if (!canInteractPhrase) return;
    setPickedIndex((cur) => (cur === idx ? null : idx));
  };

  const handleResetPhrase = () => {
    if (!canInteractPhrase) return;
    setSlots(tokens.map(() => ""));
    setBank(initialBank);
    setPickedIndex(null);
  };

  const handleSubmitPhrase = () => {
    if (!canInteractPhrase) return;
    const answer = slots.join(" ").trim();

    setSubmittedPhrase(true);
    try {
      onSubmit?.({
        mode: "phrase",
        answer,
        slots,
        phrase,
        meta: {
          roomCode: roomCode ?? null,
          teamId: teamId ?? null,
          taskType: task?.taskType ?? "word-weaver-duel",
        },
      });
    } catch {
      setSubmittedPhrase(false);
    }

    if (sock && typeof sock.emit === "function" && roomCode && teamId) {
      try {
        sock.emit("wordweaver:submit", { roomCode, teamId, answer });
      } catch {
        // no-op
      }
    }
  };

  const phraseProgress = useMemo(() => {
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

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (!task) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>Word Weaver Duel</div>
        <div style={styles.muted}>No task data received.</div>
      </div>
    );
  }

  // Scrabble-like mode render
  if (scrabbleMode) {
    const prompt =
      task?.prompt ??
      task?.instructions ??
      "Take turns placing words onto the grid. Choose a word, choose an orientation, then drop onto the board.";

    const howToPlay = [
      "Pick a word from the Word Rack.",
      "Choose the direction: Horizontal or Vertical.",
      "Place the word: drag it onto the grid (or click a grid square after selecting).",
      "If a letter overlaps a matching letter, you get bonus points.",
      "Use Next turn to pass the device to the next player.",
    ];

    const activeName = players[activePlayer] || `Player ${activePlayer + 1}`;
    const placedByWord = placed || {};

    const scoreRows = players.map((name, idx) => ({
      name,
      score: Number(scores?.[idx]) || 0,
      isActive: idx === activePlayer,
    }));

    const selectedWord = selectedWordIdx != null ? (scrabbleWords[selectedWordIdx] || "") : "";
    const selectedAlreadyPlaced = selectedWordIdx != null && !!placedByWord[selectedWordIdx];

    return (
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div style={styles.title}>Word Weaver Duel</div>
          <div style={styles.pillsRow}>
            <div style={styles.pill}>{placedCount}/{scrabbleWords.length} words</div>
            {turnkeeper.perTurnSeconds > 0 && (
              <div style={styles.pill}>⏱ {timeLeft ?? turnkeeper.perTurnSeconds}s</div>
            )}
          </div>
        </div>

        <div style={styles.prompt}>{prompt}</div>

        <div style={styles.howBox}>
          <div style={styles.sectionTitle}>How to play</div>
          <ul style={styles.howList}>
            {howToPlay.map((line, i) => (
              <li key={i} style={styles.howItem}>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div style={styles.scrabbleTop}>
          <div style={styles.scoreBox}>
            <div style={styles.sectionTitle}>Turnkeeper</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {scoreRows.map((r, idx) => (
                <div key={idx} style={{ ...styles.scoreChip, ...(r.isActive ? styles.scoreChipActive : null) }}>
                  <div style={{ fontWeight: 900 }}>{r.name}</div>
                  <div style={{ opacity: 0.9 }}>{r.score} pts</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!canInteract}
                onClick={() => setActivePlayer((ap) => (players.length ? (ap + 1) % players.length : ap))}
                style={styles.secondaryBtn}
                title="Advance to the next player (manual)"
              >
                Next turn →
              </button>

              <button
                type="button"
                disabled={!canInteract}
                onClick={() => setOrientation((o) => (o === "H" ? "V" : "H"))}
                style={styles.secondaryBtn}
                title="Toggle placement orientation"
              >
                Orientation: {orientation === "H" ? "Horizontal" : "Vertical"}
              </button>

              <button
                type="button"
                disabled={!canInteract}
                onClick={() => setRotatedView((v) => !v)}
                style={styles.secondaryBtn}
                title="Rotate the board view (visual only)"
              >
                {rotatedView ? "Un-rotate board" : "Rotate board"}
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
              <strong>Current:</strong> {activeName}
            </div>
            {selectedWord ? (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                <strong>Selected word:</strong> {String(selectedWord).toUpperCase()}
                {selectedAlreadyPlaced ? " (already placed)" : ""}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
                Select a word below, then drop it onto a cell.
              </div>
            )}
          </div>

          <div style={styles.boardWrap}>
            <div
              style={{
                ...styles.board,
                transform: rotatedView ? "rotate(90deg)" : "none",
                transformOrigin: "center",
              }}
            >
              {board.map((row, r) => (
                <div key={r} style={styles.boardRow}>
                  {row.map((cell, c) => {
                    const isEmpty = !cell?.ch;
                    return (
                      <div
                        key={`${r}:${c}`}
                        style={{
                          ...styles.cell,
                          ...(isEmpty ? styles.cellEmpty : styles.cellFilled),
                        }}
                        onDragOver={(ev) => {
                          if (!canInteract) return;
                          ev.preventDefault?.();
                        }}
                        onDrop={(ev) => handleCellDrop(ev, r, c)}
                        onClick={() => {
                          if (!canInteract) return;
                          if (selectedWordIdx == null) return;
                          placeWord(r, c, selectedWordIdx);
                        }}
                        title={canInteract ? "Drop a word here (or click after selecting a word)" : ""}
                      >
                        {cell?.ch ? String(cell.ch).toUpperCase() : ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={styles.sectionTitle}>Word Rack</div>
          <div style={styles.wordRack}>
            {scrabbleWords.map((w, idx) => {
              const placedInfo = placedByWord[idx] || null;
              const isSelected = selectedWordIdx === idx;
              const isPlaced = !!placedInfo;

              return (
                <div key={`${w}-${idx}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    type="button"
                    draggable={canInteract && !isPlaced}
                    onDragStart={(ev) => {
                      try {
                        ev.dataTransfer?.setData?.("text/plain", String(idx));
                      } catch {
                        // no-op
                      }
                    }}
                    onClick={() => {
                      if (!canInteract) return;
                      if (isPlaced) return;
                      setSelectedWordIdx((cur) => (cur === idx ? null : idx));
                    }}
                    disabled={!canInteract || isPlaced}
                    style={{
                      ...styles.wordChip,
                      ...(isSelected ? styles.wordChipSelected : null),
                      ...(isPlaced ? styles.wordChipPlaced : null),
                    }}
                    aria-pressed={isSelected}
                    title={isPlaced ? "Already placed" : "Click to select, or drag to the board"}
                  >
                    {String(w).toUpperCase()}
                  </button>

                  {isPlaced && (
                    <div style={styles.placedMeta}>
                      +{placedInfo.points} pts • {players[placedInfo.playerIndex] || `Player ${placedInfo.playerIndex + 1}`} • {placedInfo.orientation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={styles.controls}>
            <button
              type="button"
              onClick={submitScrabble}
              disabled={mode === "review" || placedCount === 0}
              style={styles.submitBtn}
              title={placedCount === 0 ? "Place at least one word first" : "Submit the final score snapshot"}
            >
              {placedCount === 0 ? "Place a word to enable Submit" : "Submit ✅"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!canInteract) return;
                setBoard(emptyBoard);
                setPlaced({});
                setScores({});
                setSelectedWordIdx(null);
                setActivePlayer(0);
              }}
              disabled={!canInteract || mode === "review"}
              style={styles.secondaryBtn}
              title="Clear the board and start again"
            >
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
      </div>
    );
  }

  // Phrase rebuild mode render (legacy)
  if (!phrase || tokens.length === 0) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>Word Weaver Duel</div>
        <div style={styles.muted}>
          This round is missing the main text it needs.
        </div>
        <div style={{ marginTop: 8, ...styles.muted }}>
          Fix: provide a phrase (task.phrase / task.targetPhrase) OR provide a word list (task.words) to play the grid mode.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div style={styles.title}>Word Weaver Duel</div>
        <div style={styles.pillsRow}>
          <div style={styles.pill}>
            {phraseProgress.filled}/{phraseProgress.total}
          </div>
        </div>
      </div>

      <div style={styles.prompt}>{phrasePrompt}</div>

      <div style={styles.howBox}>
        <div style={styles.sectionTitle}>How to play</div>
        <ul style={styles.howList}>
          <li style={styles.howItem}>Tap a word in the Word Bank to select it.</li>
          <li style={styles.howItem}>Tap an empty blank slot to place the selected word.</li>
          <li style={styles.howItem}>Tap a filled slot to remove that word and put it back in the bank.</li>
          <li style={styles.howItem}>When all blanks are filled, press Submit.</li>
        </ul>
      </div>

      {(opponent.teamId || opponent.filled > 0 || opponent.submitted) && (
        <div style={styles.duelBox}>
          <div style={styles.duelTitle}>Duel status</div>
          <div style={styles.duelLine}>
            <span style={styles.duelLabel}>You:</span>
            <span>
              {phraseProgress.filled}/{phraseProgress.total} {submittedPhrase ? "• submitted" : ""}
            </span>
          </div>
          <div style={styles.duelLine}>
            <span style={styles.duelLabel}>Opponent:</span>
            <span>
              {opponent.filled}/{phraseProgress.total} {opponent.submitted ? "• submitted" : ""}
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
              disabled={!canInteractPhrase}
              style={{
                ...styles.slot,
                ...(filled ? styles.slotFilled : styles.slotEmpty),
              }}
              title={
                canInteractPhrase
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

      <div style={styles.sectionTitle}>Word Bank</div>
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
                disabled={!canInteractPhrase}
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
          onClick={handleSubmitPhrase}
          disabled={!canInteractPhrase || slots.some((s) => !s)}
          style={styles.submitBtn}
        >
          Submit ✅
        </button>
        <button
          type="button"
          onClick={handleResetPhrase}
          disabled={!canInteractPhrase}
          style={styles.secondaryBtn}
        >
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
  card: {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
    color: "#0f172a",
  },

  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontWeight: 950, fontSize: 20, letterSpacing: "-0.01em" },
  pillsRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
    fontWeight: 800,
  },

  prompt: { marginTop: 8, color: "#334155", fontWeight: 600, lineHeight: 1.25 },

  sectionTitle: { marginTop: 12, fontWeight: 900, color: "#0f172a" },

  // Scrabble layout
  scrabbleTop: { marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 },
  scoreBox: {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
    padding: 10,
  },
  scoreChip: {
    padding: "8px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
    minWidth: 120,
  },
  scoreChipActive: {
    border: "2px solid rgba(14,165,233,0.9)",
    background: "rgba(14,165,233,0.08)",
  },

  boardWrap: {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
    padding: 10,
    overflow: "hidden",
  },
  board: {
    display: "inline-block",
    borderRadius: 12,
    padding: 6,
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
    border: "1px solid rgba(15,23,42,0.10)",
  },
  boardRow: { display: "flex" },
  cell: {
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 13,
    userSelect: "none",
  },
  cellEmpty: {
    border: "1px dashed rgba(15,23,42,0.18)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
    color: "#94a3b8",
  },
  cellFilled: {
    border: "1px solid rgba(15,23,42,0.14)",
    background: "rgba(14,165,233,0.08)",
    color: "#0f172a",
  },

  wordRack: { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10 },
  wordChip: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 1px 0 rgba(15,23,42,0.04), 0 16px 40px rgba(2,6,23,0.10)",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
    
  },
  wordChipSelected: {
    border: "2px solid rgba(14,165,233,0.9)",
    background: "rgba(14,165,233,0.08)",
  },
  wordChipPlaced: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  placedMeta: { fontSize: 12, color: "#475569", paddingLeft: 4 },

  // Phrase mode
  slotsWrap: { marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 },
  slot: {
    padding: "10px 12px",
    minWidth: 84,
    borderRadius: 12,
    border: "1px dashed rgba(15,23,42,0.18)",
    cursor: "pointer",
    fontSize: 14,
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
  },
  slotEmpty: { opacity: 0.9 },
  slotFilled: { borderStyle: "solid", background: "#f8fafc" },

  bankWrap: { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 },

  controls: { marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" },
  submitBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    background: "#16a34a",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))",
    boxShadow: "0 16px 40px rgba(2,6,23,0.10)",
    cursor: "pointer",
    fontWeight: 800,
    color: "#0f172a",
  },

  muted: { opacity: 0.75, marginTop: 8, color: "#334155" },

  duelBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
  },
  duelTitle: { fontWeight: 900, marginBottom: 6, color: "#0f172a" },
  duelLine: { color: "#334155", display: "flex", gap: 6, flexWrap: "wrap" },
  duelLabel: { opacity: 0.75, minWidth: 72 },

  reviewBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
  },
  reviewTitle: { fontWeight: 900, marginBottom: 6, color: "#0f172a" },
  good: { fontWeight: 900, color: "#16a34a" },
  bad: { fontWeight: 900, color: "#dc2626" },
  feedback: { marginTop: 8, color: "#334155" },
};
