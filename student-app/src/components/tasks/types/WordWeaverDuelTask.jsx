import React, { useEffect, useMemo, useRef, useState } from "react";
import { useThemeMode } from "../../../utils/ThemeModeContext.js";
import { isDarkTheme } from "../../../utils/themeHelpers.js";
import StepCircle from "../StepCircle";

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
  const themeMode = useThemeMode();
  const isDark = isDarkTheme(themeMode);
  const s = useMemo(() => getStyles(isDark), [isDark]);

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
  const [orientation, setOrientation] = useState("H"); // H | V (legacy, kept for compatibility)
  const [wordOrientations, setWordOrientations] = useState(() => ({})); // {wordIdx: "H" | "V"}
  const [placementError, setPlacementError] = useState(null); // error message for placement feedback
  const [badDropFlash, setBadDropFlash] = useState(false);     // 600ms red flash on bad drop
  const badDropTimerRef = useRef(null);
  const [touchDragIdx, setTouchDragIdx] = useState(null); // touch-drag word index
  const [touchDragPos, setTouchDragPos] = useState(null); // {x,y} for touch ghost
  const boardRef = useRef(null); // ref to grid container for hit-testing touch drops

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
    setWordOrientations({});
    setBoard(emptyBoard);
    setPlaced({});
    setPlacementError(null);
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

    // Check for conflicts and count intersections with matching letters
    let hasIntersection = false;
    for (let i = 0; i < w.length; i++) {
      const rr = ori === "V" ? r + i : r;
      const cc = ori === "H" ? c + i : c;
      const cell = b[rr][cc];
      const existing = cell?.ch ? String(cell.ch).toUpperCase() : "";
      const want = w[i];
      if (existing && existing !== want) return {
        ok: false,
        reason: `That spot already has "${existing}" — your word needs a "${want}" there.`,
      };
      if (existing && existing === want) hasIntersection = true;
    }

    // Enforce intersection rule: after the first word, subsequent words must
    // cross an existing word. We KEEP this requirement whenever a crossing is
    // possible — the strategic puzzle is precisely "find an arrangement where
    // they all interlock," and ↩ Un-place lets the player rearrange to make
    // room. We ONLY waive it for a word that can NEVER cross because it shares
    // no letter with ANY OTHER word in the set (a generator slip-up — the case
    // behind "words didn't have enough in common"). That keeps the challenge
    // intact while never producing a truly-unplaceable dead-end.
    if (placedCount > 0 && !hasIntersection) {
      const wordLetters = new Set(w.split(""));
      let selfSkipped = false;
      const sharesWithSet = (scrabbleWords || []).some((other) => {
        const o = String(other || "").toUpperCase();
        if (!selfSkipped && o === w) { selfSkipped = true; return false; } // skip this word itself once
        for (const ch of o) if (wordLetters.has(ch)) return true;
        return false;
      });
      if (sharesWithSet) {
        return {
          ok: false,
          reason: "This word needs to cross another word at a shared letter. Tip: tap ↩ Un-place on a placed word to rearrange and make room.",
        };
      }
      // else: this word shares no letter with any other word → it can never
      // cross; allow placing it on its own so the board is still completable.
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

    // Get the orientation for this specific word (use per-word orientation if set, otherwise use global)
    const wordOri = wordOrientations[wordIdx] ?? orientation;

    setBoard((prev) => {
      const b = prev.map((row) => row.map((cell) => ({ ...cell })));

      // First try the literal drop position (start cell = drop cell).
      let check = canPlaceWord(r, c, word, wordOri, b);
      let anchorR = r, anchorC = c;
      let finalOri = wordOri;

      // If literal placement fails, be generous. Crucially, a crossing word
      // must run PERPENDICULAR to the word it crosses, so the user's currently
      // selected orientation is often "wrong" for an obvious cross. Try the
      // selected orientation first, then the opposite — so dropping a word onto
      // a shared letter just works regardless of orientation.
      // (Tester: "if the user places a word so that two identical letters
      // intersect — accept it!")
      if (!check.ok) {
        const dropChar = String(b[r]?.[c]?.ch || "").toUpperCase();
        const orientationsToTry = wordOri === "H" ? ["H", "V"] : ["V", "H"];

        // Pass 1: anchor a matching letter of the word onto the drop cell.
        if (dropChar) {
          for (const ori of orientationsToTry) {
            for (let i = 0; i < word.length; i++) {
              if (word[i] !== dropChar) continue;
              const tryR = ori === "V" ? r - i : r;
              const tryC = ori === "H" ? c - i : c;
              if (tryR < 0 || tryC < 0) continue;
              const tryCheck = canPlaceWord(tryR, tryC, word, ori, b);
              if (tryCheck.ok) { check = tryCheck; anchorR = tryR; anchorC = tryC; finalOri = ori; break; }
            }
            if (check.ok) break;
          }
        }

        // Pass 2: tolerance — try a small shift along each orientation's axis.
        // Helps when the user drops near (but not exactly on) a valid cell.
        if (!check.ok) {
          for (const ori of orientationsToTry) {
            for (const delta of [-1, 1, -2, 2]) {
              const tryR = ori === "V" ? r + delta : r;
              const tryC = ori === "H" ? c + delta : c;
              if (tryR < 0 || tryC < 0) continue;
              const tryCheck = canPlaceWord(tryR, tryC, word, ori, b);
              if (tryCheck.ok) { check = tryCheck; anchorR = tryR; anchorC = tryC; finalOri = ori; break; }
            }
            if (check.ok) break;
          }
        }
      }

      if (!check.ok) {
        setPlacementError(check.reason);
        // Trigger a 600ms red flash on the board so a bad drag has
        // unmistakable visual feedback (tester ask).
        setBadDropFlash(true);
        if (badDropTimerRef.current) window.clearTimeout(badDropTimerRef.current);
        badDropTimerRef.current = window.setTimeout(() => setBadDropFlash(false), 600);
        return prev;
      }

      setPlacementError(null);
      setBadDropFlash(false);

      const intersections = computeIntersections(anchorR, anchorC, word, finalOri, b);
      const points = word.length + intersections * 2;

      for (let i = 0; i < word.length; i++) {
        const rr = finalOri === "V" ? anchorR + i : anchorR;
        const cc = finalOri === "H" ? anchorC + i : anchorC;
        const cur = b[rr][cc];
        b[rr][cc] = { ch: word[i], wordId: cur?.wordId ?? wordIdx }; // preserve earlier ownership on intersections
      }

      setPlaced((p) => ({
        ...(p || {}),
        [wordIdx]: { r: anchorR, c: anchorC, orientation: finalOri, playerIndex: activePlayer, points, intersections },
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

  // Take a word back off the board. Letters on shared intersections
  // remain only if another placed word still owns the cell.
  const unplaceWord = (wordIdx) => {
    if (!canInteract) return;
    const info = placed?.[wordIdx];
    if (!info) return;

    const wordRaw = scrabbleWords[wordIdx] ?? "";
    const word = String(wordRaw).trim().toUpperCase();
    if (!word) return;

    setBoard((prev) => {
      const b = prev.map((row) => row.map((cell) => ({ ...cell })));
      for (let i = 0; i < word.length; i++) {
        const rr = info.orientation === "V" ? info.r + i : info.r;
        const cc = info.orientation === "H" ? info.c + i : info.c;
        const cell = b[rr]?.[cc];
        if (!cell) continue;
        // If the cell was owned by this word AND no other placed word
        // also covers it, clear the cell. Otherwise leave intact for
        // the other word that shares this letter.
        const sharedWith = Object.entries(placed || {}).some(([otherIdxStr, otherInfo]) => {
          const otherIdx = Number(otherIdxStr);
          if (otherIdx === wordIdx) return false;
          if (!otherInfo) return false;
          const otherWord = String(scrabbleWords[otherIdx] || "").toUpperCase();
          for (let j = 0; j < otherWord.length; j++) {
            const orr = otherInfo.orientation === "V" ? otherInfo.r + j : otherInfo.r;
            const occ = otherInfo.orientation === "H" ? otherInfo.c + j : otherInfo.c;
            if (orr === rr && occ === cc) return true;
          }
          return false;
        });
        if (!sharedWith) {
          b[rr][cc] = { ch: "", wordId: null };
        }
      }
      return b;
    });

    // Subtract the points awarded for this word and clear from `placed`.
    setScores((s) => ({
      ...(s || {}),
      [info.playerIndex]: Math.max(0, (Number(s?.[info.playerIndex]) || 0) - (info.points || 0)),
    }));
    setPlaced((p) => {
      const next = { ...(p || {}) };
      delete next[wordIdx];
      return next;
    });
    setPlacementError(null);
    setBadDropFlash(false);
    // Step the turn back so the same player can try again.
    setActivePlayer((ap) => (players.length ? (ap - 1 + players.length) % players.length : ap));
  };

  // --- Custom drag image for HTML5 drag ---
  const createDragImage = (word) => {
    const el = document.createElement("div");
    el.style.cssText =
      "display:inline-flex;gap:1px;padding:4px;border-radius:6px;" +
      "background:rgba(14,165,233,0.12);border:1px solid rgba(14,165,233,0.4);" +
      "position:fixed;top:-200px;left:-200px;pointer-events:none;z-index:99999;";
    String(word).toUpperCase().split("").forEach((ch) => {
      const tile = document.createElement("div");
      tile.style.cssText =
        "width:28px;height:28px;display:flex;align-items:center;justify-content:center;" +
        "background:rgba(139,106,58,0.55);border:1px solid rgba(255,255,255,0.3);" +
        "border-radius:2px;font-weight:900;font-size:13px;color:rgba(255,255,255,0.85);";
      tile.textContent = ch;
      el.appendChild(tile);
    });
    document.body.appendChild(el);
    return el;
  };

  const handleTileDragStart = (ev, idx) => {
    if (!canInteract) return;
    if (placed?.[idx]) return;
    const word = scrabbleWords[idx] || "";
    setSelectedWordIdx(idx);
    try {
      ev.dataTransfer?.setData?.("text/plain", String(idx));
      ev.dataTransfer?.setData?.("wordIdx", String(idx));
      const ghost = createDragImage(word);
      ev.dataTransfer?.setDragImage?.(ghost, 14, 14);
      // Clean up after a tick
      requestAnimationFrame(() => setTimeout(() => ghost.remove(), 100));
    } catch { /* no-op */ }
  };

  // --- Touch drag support for mobile ---
  const handleTouchStart = (ev, idx) => {
    if (!canInteract) return;
    if (placed?.[idx]) return;
    setTouchDragIdx(idx);
    setSelectedWordIdx(idx);
    const touch = ev.touches?.[0];
    if (touch) setTouchDragPos({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (ev, idx) => {
    if (touchDragIdx == null) return;
    const touch = ev.touches?.[0];
    if (touch) {
      ev.preventDefault?.(); // prevent scroll while dragging
      setTouchDragPos({ x: touch.clientX, y: touch.clientY });
    }
  };

  const handleTouchEnd = (ev) => {
    if (touchDragIdx == null) return;
    const touch = ev.changedTouches?.[0];
    if (touch && boardRef.current) {
      // Hit-test which grid cell is under the finger
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        const cellData = el.closest?.("[data-cell]")?.dataset;
        if (cellData?.row != null && cellData?.col != null) {
          placeWord(Number(cellData.row), Number(cellData.col), touchDragIdx);
        }
      }
    }
    setTouchDragIdx(null);
    setTouchDragPos(null);
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
      <div style={s.card}>
        <div style={s.title}>Word Weaver Duel</div>
        <div style={s.muted}>No task data received.</div>
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
      "Words must cross at a shared letter — overlapping a matching letter earns bonus points.",
      "Stuck fitting them all? Tap ↩ Un-place on any placed word to take it back and try a different arrangement — interlocking every word is the puzzle!",
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
      <div style={s.card}>
        <div style={s.headerRow}>
          <div style={s.title}>Word Weaver Duel</div>
          <div style={s.pillsRow}>
            <div style={s.pill}>{placedCount}/{scrabbleWords.length} words</div>
            {turnkeeper.perTurnSeconds > 0 && (
              <div style={s.pill}>⏱ {timeLeft ?? turnkeeper.perTurnSeconds}s</div>
            )}
          </div>
        </div>

        <div style={s.prompt}>{prompt}</div>

        <div style={s.howBox}>
          <div style={s.sectionTitle}>How to play</div>
          <div>
            {howToPlay.map((line, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <StepCircle n={i + 1} /> <span style={{ fontSize: 13, color: s.howList?.color }}>{line}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={s.scrabbleTop}>
          <div style={s.scoreBox}>
            <div style={s.sectionTitle}>Turnkeeper</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {scoreRows.map((r, idx) => (
                <div key={idx} style={{ ...s.scoreChip, ...(r.isActive ? s.scoreChipActive : null) }}>
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
                style={s.secondaryBtn}
                title="Advance to the next player (manual)"
              >
                Next turn →
              </button>

              <button
                type="button"
                disabled={!canInteract}
                onClick={() => setOrientation((o) => (o === "H" ? "V" : "H"))}
                style={s.secondaryBtn}
                title="Toggle placement orientation"
              >
                Orientation: {orientation === "H" ? "Horizontal" : "Vertical"}
              </button>

              {/* Removed the "Rotate board" view toggle: it applied a cosmetic
                  CSS rotate(90deg) that made the grid LOOK transposed while
                  placement/intersection logic stayed on the true orientation —
                  tester read this as "the grid is rotated" and hit spurious
                  "words must cross at a shared letter" confusion. */}
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

          <div
            style={{
              ...s.boardWrap,
              outline: badDropFlash ? "3px solid #ef4444" : "none",
              borderRadius: 8,
              boxShadow: badDropFlash ? "0 0 0 8px rgba(239,68,68,0.18)" : "none",
              transition: "box-shadow 0.2s, outline 0.2s",
            }}
          >
            <div
              ref={boardRef}
              style={{
                ...s.board,
                transformOrigin: "center",
              }}
            >
              {board.map((row, r) => (
                <div key={r} style={s.boardRow}>
                  {row.map((cell, c) => {
                    const isEmpty = !cell?.ch;
                    const selectedWord = selectedWordIdx != null ? (scrabbleWords[selectedWordIdx] || "") : "";
                    const wordOri = wordOrientations[selectedWordIdx] ?? orientation;

                    // Check if this cell would be covered by the selected word preview
                    let isPreview = false;
                    if (selectedWord && selectedWordIdx != null && !placedByWord[selectedWordIdx]) {
                      for (let i = 0; i < selectedWord.length; i++) {
                        const previewR = wordOri === "V" ? r - i : r;
                        const previewC = wordOri === "H" ? c - i : c;
                        if (previewR === r && previewC === c) {
                          isPreview = true;
                          break;
                        }
                      }
                    }

                    return (
                      <div
                        key={`${r}:${c}`}
                        data-cell=""
                        data-row={r}
                        data-col={c}
                        style={{
                          ...s.cell,
                          ...(isEmpty ? s.cellEmpty : s.cellFilled),
                          ...(isPreview ? { background: "rgba(14,165,233,0.15)", borderStyle: "dashed", borderColor: "rgba(14,165,233,0.5)" } : {}),
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
          <div style={s.sectionTitle}>Word Rack</div>
          <div style={s.wordRack}>
            {scrabbleWords.map((w, idx) => {
              const placedInfo = placedByWord[idx] || null;
              const isSelected = selectedWordIdx === idx;
              const isPlaced = !!placedInfo;
              const wordOri = wordOrientations[idx] ?? "H";

              return (
                <div key={`${w}-${idx}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Tile strip — draggable + clickable */}
                  <div
                    draggable={canInteract && !isPlaced}
                    onDragStart={(ev) => handleTileDragStart(ev, idx)}
                    onTouchStart={(ev) => handleTouchStart(ev, idx)}
                    onTouchMove={(ev) => handleTouchMove(ev, idx)}
                    onTouchEnd={handleTouchEnd}
                    onClick={() => {
                      if (!canInteract || isPlaced) return;
                      setSelectedWordIdx((cur) => (cur === idx ? null : idx));
                    }}
                    style={{
                      ...s.tileStrip,
                      ...(isPlaced ? { opacity: 0.5, cursor: "not-allowed" } : { cursor: "grab" }),
                      ...(isSelected ? { border: "2px solid rgba(14,165,233,0.9)", background: "rgba(14,165,233,0.08)" } : {}),
                    }}
                    title={isPlaced ? "Already placed" : "Drag to the board, or tap to select"}
                  >
                    {String(w)
                      .toUpperCase()
                      .split("")
                      .map((letter, i) => (
                        <div key={i} style={s.tile}>
                          {letter}
                        </div>
                      ))}
                  </div>

                  {/* Status label */}
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      opacity: isPlaced ? 0.5 : 0.8,
                      color: isSelected ? "rgba(14,165,233,0.9)" : undefined,
                    }}
                  >
                    {isPlaced ? "Placed ✓" : isSelected ? "Selected" : "Tap or drag"}
                  </div>

                  {/* Per-word rotation toggle */}
                  {!isPlaced && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!canInteract) return;
                        setWordOrientations((prev) => ({
                          ...prev,
                          [idx]: prev[idx] === "V" ? "H" : "V",
                        }));
                      }}
                      disabled={!canInteract}
                      style={{
                        padding: "4px 6px",
                        borderRadius: 4,
                        border: "1px dashed rgba(15,23,42,0.18)",
                        background: "transparent",
                        cursor: canInteract ? "pointer" : "not-allowed",
                        fontSize: 11,
                        opacity: 0.75,
                        fontWeight: 600,
                      }}
                      title="Rotate this word 90 degrees"
                    >
                      {wordOri === "H" ? "↻ Horizontal" : "↻ Vertical"}
                    </button>
                  )}

                  {isPlaced && (
                    <>
                      <div style={s.placedMeta}>
                        +{placedInfo.points} pts • {players[placedInfo.playerIndex] || `Player ${placedInfo.playerIndex + 1}`} • {placedInfo.orientation}
                      </div>
                      {/* Allow a player to take a word back if they see
                          a better play. Lifts the letters off the board,
                          subtracts the points awarded, returns the turn. */}
                      {canInteract && mode !== "review" && (
                        <button
                          type="button"
                          onClick={() => unplaceWord(idx)}
                          style={{
                            padding: "4px 6px",
                            borderRadius: 4,
                            border: "1px dashed rgba(239,68,68,0.45)",
                            background: "transparent",
                            color: "#b91c1c",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                            opacity: 0.85,
                            marginTop: 2,
                          }}
                          title="Take this word back and try a different placement"
                        >
                          ↩ Un-place
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error message display */}
          {placementError && (
            <div style={s.placementErrorBox}>
              ⚠ {placementError}
            </div>
          )}

          <div style={s.controls}>
            <button
              type="button"
              onClick={submitScrabble}
              disabled={mode === "review" || placedCount === 0}
              style={s.submitBtn}
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
                setWordOrientations({});
                setPlacementError(null);
              }}
              disabled={!canInteract || mode === "review"}
              style={s.secondaryBtn}
              title="Clear the board and start again"
            >
              Reset
            </button>
          </div>

          {mode === "review" && (
            <div style={s.reviewBox}>
              <div style={s.reviewTitle}>Review</div>
              {reviewCorrect === null ? (
                <div style={s.muted}>Feedback not available.</div>
              ) : reviewCorrect ? (
                <div style={s.good}>Correct ✅</div>
              ) : (
                <div style={s.bad}>Not quite ❌</div>
              )}
              {review?.feedback && <div style={s.feedback}>{String(review.feedback)}</div>}
            </div>
          )}

          {/* Touch-drag floating ghost */}
          {touchDragIdx != null && touchDragPos && (
            <div
              style={{
                position: "fixed",
                left: touchDragPos.x - 20,
                top: touchDragPos.y - 20,
                pointerEvents: "none",
                zIndex: 99999,
                display: "inline-flex",
                gap: 1,
                padding: 4,
                borderRadius: 6,
                background: "rgba(14,165,233,0.15)",
                border: "1px solid rgba(14,165,233,0.5)",
                opacity: 0.85,
              }}
            >
              {String(scrabbleWords[touchDragIdx] || "")
                .toUpperCase()
                .split("")
                .map((ch, i) => (
                  <div
                    key={i}
                    style={{
                      width: 26,
                      height: 26,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(139,106,58,0.55)",
                      border: "1px solid rgba(255,255,255,0.35)",
                      borderRadius: 2,
                      fontWeight: 900,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    {ch}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Phrase rebuild mode render (legacy)
  if (!phrase || tokens.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.title}>Word Weaver Duel</div>
        <div style={s.muted}>
          This round is missing the main text it needs.
        </div>
        <div style={{ marginTop: 8, ...s.muted }}>
          Fix: provide a phrase (task.phrase / task.targetPhrase) OR provide a word list (task.words) to play the grid mode.
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.headerRow}>
        <div style={s.title}>Word Weaver Duel</div>
        <div style={s.pillsRow}>
          <div style={s.pill}>
            {phraseProgress.filled}/{phraseProgress.total}
          </div>
        </div>
      </div>

      <div style={s.prompt}>{phrasePrompt}</div>

      <div style={s.howBox}>
        <div style={s.sectionTitle}>How to play</div>
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={1} /> <span style={{ fontSize: 13 }}>Tap a word in the Word Bank to select it.</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={2} /> <span style={{ fontSize: 13 }}>Tap an empty blank slot to place the selected word.</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={3} /> <span style={{ fontSize: 13 }}>Tap a filled slot to remove that word and put it back in the bank.</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={4} /> <span style={{ fontSize: 13 }}>When all blanks are filled, press Submit.</span></div>
        </div>
      </div>

      {(opponent.teamId || opponent.filled > 0 || opponent.submitted) && (
        <div style={s.duelBox}>
          <div style={s.duelTitle}>Duel status</div>
          <div style={s.duelLine}>
            <span style={s.duelLabel}>You:</span>
            <span>
              {phraseProgress.filled}/{phraseProgress.total} {submittedPhrase ? "• submitted" : ""}
            </span>
          </div>
          <div style={s.duelLine}>
            <span style={s.duelLabel}>Opponent:</span>
            <span>
              {opponent.filled}/{phraseProgress.total} {opponent.submitted ? "• submitted" : ""}
            </span>
          </div>
        </div>
      )}

      <div style={s.slotsWrap}>
        {tokens.map((_, i) => {
          const filled = !!slots[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSlotClick(i)}
              disabled={!canInteractPhrase}
              style={{
                ...s.slot,
                ...(filled ? s.slotFilled : s.slotEmpty),
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

      <div style={s.sectionTitle}>Word Bank</div>
      <div style={s.bankWrap}>
        {bank.length === 0 ? (
          <div style={s.muted}>No words left in the bank.</div>
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
                  ...s.wordChip,
                  ...(selected ? s.wordChipSelected : null),
                }}
                aria-pressed={selected}
              >
                {w}
              </button>
            );
          })
        )}
      </div>

      <div style={s.controls}>
        <button
          type="button"
          onClick={handleSubmitPhrase}
          disabled={!canInteractPhrase || slots.some((s) => !s)}
          style={s.submitBtn}
        >
          Submit ✅
        </button>
        <button
          type="button"
          onClick={handleResetPhrase}
          disabled={!canInteractPhrase}
          style={s.secondaryBtn}
        >
          Reset
        </button>
      </div>

      {mode === "review" && (
        <div style={s.reviewBox}>
          <div style={s.reviewTitle}>Review</div>
          {reviewCorrect === null ? (
            <div style={s.muted}>Feedback not available.</div>
          ) : reviewCorrect ? (
            <div style={s.good}>Correct ✅</div>
          ) : (
            <div style={s.bad}>Not quite ❌</div>
          )}
          {review?.feedback && <div style={s.feedback}>{String(review.feedback)}</div>}
        </div>
      )}
    </div>
  );
}

function getStyles(isDark) {
  const border = isDark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(15,23,42,0.14)";
  const cardBg = isDark
    ? "linear-gradient(135deg, rgba(30,30,50,0.95), rgba(20,20,40,0.92))"
    : "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))";
  const textPrimary = isDark ? "#e0e7ff" : "#0f172a";
  const textSecondary = isDark ? "#94a3b8" : "#334155";
  const surfaceBg = isDark ? "rgba(255,255,255,0.06)" : "#f8fafc";
  const shadow = isDark ? "0 16px 40px rgba(0,0,0,0.25)" : "0 16px 40px rgba(2,6,23,0.10)";

  return {
    card: {
      padding: 12,
      borderRadius: 16,
      border,
      background: cardBg,
      boxShadow: shadow,
      color: textPrimary,
    },

    headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    title: { fontWeight: 950, fontSize: 20, letterSpacing: "-0.01em" },
    pillsRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    pill: {
      padding: "6px 10px",
      borderRadius: 999,
      fontSize: 12,
      border,
      background: surfaceBg,
      fontWeight: 800,
    },

    prompt: { marginTop: 8, color: textSecondary, fontWeight: 600, lineHeight: 1.25 },

    sectionTitle: { marginTop: 12, fontWeight: 900, color: textPrimary },

    // Scrabble layout
    scrabbleTop: { marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 },
    scoreBox: {
      borderRadius: 16,
      border,
      background: surfaceBg,
      padding: 10,
    },
    scoreChip: {
      padding: "8px 10px",
      borderRadius: 14,
      border,
      background: cardBg,
      boxShadow: shadow,
      minWidth: 120,
    },
    scoreChipActive: {
      border: "2px solid rgba(14,165,233,0.9)",
      background: isDark ? "rgba(14,165,233,0.15)" : "rgba(14,165,233,0.08)",
    },

    boardWrap: {
      borderRadius: 16,
      border,
      background: surfaceBg,
      padding: 10,
      overflow: "hidden",
    },
    board: {
      display: "inline-block",
      borderRadius: 12,
      padding: 6,
      background: cardBg,
      boxShadow: shadow,
      border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(15,23,42,0.10)",
    },
    boardRow: { display: "flex" },
    cell: {
      width: 30,
      height: 30,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 900,
      fontSize: 14,
      userSelect: "none",
      cursor: "pointer",
    },
    cellEmpty: {
      border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.14)",
      background: isDark ? "rgba(255,255,255,0.04)" : "#f5f5f0",
      color: isDark ? "#64748b" : "#94a3b8",
    },
    cellFilled: {
      border: isDark ? "1px solid rgba(212,165,116,0.5)" : "1px solid rgba(15,23,42,0.14)",
      background: isDark ? "#9a7045" : "#d4a574",
      color: isDark ? "#fff" : "#0f172a",
      fontWeight: 900,
    },

    // Tile strip styles
    tileStrip: {
      marginTop: 8,
      display: "inline-flex",
      gap: 1,
      padding: 4,
      borderRadius: 6,
      border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
      background: isDark ? "rgba(255,255,255,0.06)" : "#fef9f3",
    },
    tile: {
      width: 30,
      height: 30,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: isDark ? "#8a6a3a" : "#dbb895",
      border: isDark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(15,23,42,0.25)",
      borderRadius: 2,
      fontWeight: 900,
      fontSize: 14,
      color: isDark ? "#fff" : "#0f172a",
      userSelect: "none",
    },
    tileVertical: {
      flexDirection: "column",
    },
    rotationIcon: {
      fontSize: 11,
      opacity: 0.7,
      marginTop: 2,
    },

    wordRack: { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10 },
    wordChip: {
      padding: "10px 12px",
      borderRadius: 999,
      border,
      background: cardBg,
      boxShadow: shadow,
      cursor: "pointer",
      fontWeight: 900,
      fontSize: 13,
      color: textPrimary,
    },
    wordChipSelected: {
      border: "2px solid rgba(14,165,233,0.9)",
      background: isDark ? "rgba(14,165,233,0.15)" : "rgba(14,165,233,0.08)",
    },
    wordChipPlaced: {
      opacity: 0.55,
      cursor: "not-allowed",
    },
    placedMeta: { fontSize: 12, color: textSecondary, paddingLeft: 4 },

    // Phrase mode
    slotsWrap: { marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 },
    slot: {
      padding: "10px 12px",
      minWidth: 84,
      borderRadius: 12,
      border: isDark ? "1px dashed rgba(255,255,255,0.2)" : "1px dashed rgba(15,23,42,0.18)",
      cursor: "pointer",
      fontSize: 14,
      background: cardBg,
      boxShadow: shadow,
      color: textPrimary,
    },
    slotEmpty: { opacity: 0.9 },
    slotFilled: { borderStyle: "solid", background: surfaceBg },

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
      border,
      background: cardBg,
      boxShadow: shadow,
      cursor: "pointer",
      fontWeight: 800,
      color: textPrimary,
    },

    muted: { opacity: 0.75, marginTop: 8, color: textSecondary },

    duelBox: {
      marginTop: 12,
      padding: 10,
      borderRadius: 12,
      border,
      background: surfaceBg,
    },
    duelTitle: { fontWeight: 900, marginBottom: 6, color: textPrimary },
    duelLine: { color: textSecondary, display: "flex", gap: 6, flexWrap: "wrap" },
    duelLabel: { opacity: 0.75, minWidth: 72 },

    reviewBox: {
      marginTop: 12,
      padding: 10,
      borderRadius: 12,
      border,
      background: surfaceBg,
    },
    reviewTitle: { fontWeight: 900, marginBottom: 6, color: textPrimary },
    good: { fontWeight: 900, color: "#16a34a" },
    bad: { fontWeight: 900, color: "#dc2626" },
    feedback: { marginTop: 8, color: textSecondary },

    howBox: {
      marginTop: 10,
      padding: 10,
      borderRadius: 12,
      border,
      background: surfaceBg,
    },
    howList: { margin: 0, paddingLeft: 18, fontSize: 13, color: textSecondary },
    howItem: { marginTop: 4 },

    placementErrorBox: {
      marginTop: 8,
      padding: 8,
      borderRadius: 8,
      background: isDark ? "rgba(220,38,38,0.15)" : "#fee2e2",
      border: isDark ? "1px solid rgba(248,113,113,0.4)" : "1px solid #fca5a5",
      color: isDark ? "#fca5a5" : "#991b1b",
      fontSize: 13,
      fontWeight: 600,
    },
  };
}
