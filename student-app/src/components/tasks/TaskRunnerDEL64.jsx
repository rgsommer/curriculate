// student-app/src/components/tasks/TaskRunner.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { TASK_TYPES, TASK_TYPE_META } from "../../../../shared/taskTypes.js";

import BodyBreakTask from "./types/BodyBreakTask";
import MakeAndSnapTask from "./types/MakeAndSnapTask";
import MultipleChoiceTask from "./types/MultipleChoiceTask";
import OpenTextTask from "./types/OpenTextTask";
import PhotoTask from "./types/PhotoTask";
import RecordAudioTask from "./types/RecordAudioTask";
import SequenceTask from "./types/SequenceTask";
import ShortAnswerTask from "./types/ShortAnswerTask";
import SortTask from "./types/SortTask";
import TrueFalseTask from "./types/TrueFalseTask";
import DrawMimeTask from "./types/DrawMimeTask";
import CollaborationTask from "./types/CollaborationTask";
import MusicalChairsTask from "./types/MusicalChairsTask";
import MysteryCluesTask from "./types/MysteryCluesTask";
import FakeOutTask from "./types/FakeOutTask";
import TrueFalseTicTacToeTask from "./types/TrueFalseTicTacToeTask";
import MadDashSequenceTask from "./types/MadDashSequenceTask";
import LiveDebateTask from "./types/LiveDebateTask";
import FlashcardsTask from "./types/FlashcardsTask";
import FlashcardsRaceTask from "./types/FlashcardsRaceTask";
import TimelineTask from "./types/TimelineTask";
import PetFeedingTask from "./types/PetFeedingTask";
import MotionMissionTask from "./types/MotionMissionTask";
import BrainstormBattleTask from "./types/BrainstormBattleTask";
import MindMapperTask from "./types/MindMapperTask";
import SpeedDrawTask from "./types/SpeedDrawTask";
import DiffDetectiveTask from "./types/DiffDetectiveTask";
import BrainSparkNotesTask from "./types/BrainSparkNotesTask";
import HideNSeekTask from "./types/HideNSeekTask";
import SpeechRecognitionTask from "./types/SpeechRecognitionTask";
import PronunciationTask from "./types/PronunciationTask";
import AIDebateJudgeTask from "./types/AIDebateJudgeTask";
import BrainBlitzTask from "./types/BrainBlitzTask";
import PhotoJournalTask from "./types/PhotoJournalTask";
import HangmanDuelTask from "./types/HangmanDuelTask";
import MatchingTask from "./types/MatchingTask";
import WordWeaverDuelTask from "./types/WordWeaverDuelTask";
import MoodCheckInTask from "./types/MoodCheckInTask"; // ✅ NEW
import TreasureRunnerTask from "./types/TreasureRunnerTask"; // ✅ NEW
import VennSortTask from "./types/VennSortTask";
import GuessWhoTask from "./types/GuessWhoTask"; // ✅ NEW (Guess Who)
import NarrationSynthesizeTask from "./types/NarrationSynthesizeTask";

import ScriptPlayTask from "./types/ScriptPlayTask";
import RolePlayDeckTask from "./types/RolePlayDeckTask";
// High-contrast neutrals for inner task cards / text
const CONTRAST_TEXT_DARK = "#0f172a";
const CONTRAST_BG_LIGHT = "#f9fafb";
const CONTRAST_BORDER = "#d1d5db";
const CONTRAST_ACCENT = "#0ea5e9";

function seededShuffle(array, seedStr) {
  const copy = [...array];

  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }

  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed >>>= 0;
    seed ^= seed << 5;
    seed >>>= 0;
    return (seed >>> 0) / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Convert "quick_response" → "Quick Response"
function toTitleCase(str) {
  if (!str) return "";
  return str
    .replace(/[_-]+/g, " ")
    .replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
    );
}

function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;

  switch (raw) {
    // MC / TF / SHORT
    case "mc":
    case "multiple-choice":
      return TASK_TYPES.MULTIPLE_CHOICE;

    case "tf":
    case "true_false":
    case "true-false":
      return TASK_TYPES.TRUE_FALSE;

    case "short":
    case "short-answer":
    case "open":
      return TASK_TYPES.SHORT_ANSWER;

    case "open-text":
    case "open_text":
      return TASK_TYPES.OPEN_TEXT;

    // Sorting & Sequence
    case "sort":
      return TASK_TYPES.SORT;

    case "seq":
    case "sequence":
      return TASK_TYPES.SEQUENCE;

    // ✅ Matching (NEW)
    case "matching":
    case "match":
    case "match-up":
    case "match_up":
    case "matchup":
    case "pairs":
      return TASK_TYPES.MATCHING;

    // Timeline
    case "timeline":
      return TASK_TYPES.TIMELINE;

    // VennSort (2–3 circles)
    case "vennsort":
    case "venn-sort":
    case "venn_sort":
    case "venn":
    case "venn-diagram":
    case "venn_diagram":
    case "venndiagram":
      return TASK_TYPES.VENNSORT;

    // Photo / Media
    case "photo":
      return TASK_TYPES.PHOTO;

    case "make-and-snap":
    case "make_and_snap":
      return TASK_TYPES.MAKE_AND_SNAP;

    // Photo Journal
    case "photo-journal":
    case "photo_journal":
    case "photojournal":
      return TASK_TYPES.PHOTO_JOURNAL;

    case "record-audio":
    case "record_audio":
      return TASK_TYPES.RECORD_AUDIO;

    // Speech recognition
    case "speech-recognition":
    case "speech_recognition":
      return TASK_TYPES.SPEECH_RECOGNITION;

    // Pronunciation (NEW)
    case "pronunciation":
    case "pronounce":
    case "speech-practice":
      return TASK_TYPES.PRONUNCIATION;

    // Body break
    case "body-break":
    case "body_break":
      return TASK_TYPES.BODY_BREAK;

    // ✅ Mood check-in (NEW)
    case "mood-checkin":
    case "mood-check-in":
    case "mood_checkin":
    case "moodcheckin":
    case "mood_check_in":
      return TASK_TYPES.MOOD_CHECKIN;

    // ✅ Guess Who (NEW)
    case "guesswho":
    case "guess-who":
    case "guess_who":
    case "guess-who-task":
      return TASK_TYPES.GUESS_WHO;

    // ✅ Echo Chain (NEW)
    case "echochain":
    case "echo-chain":
    case "echo_chain":
    case "echo chain":
      return TASK_TYPES.ECHO_CHAIN;

    // Draw-only tasks
    case "Draw":
    case "draw":
    case "drawing":
      return TASK_TYPES.DRAW;

    // Mime-only tasks
    case "mime":
    case "act":
    case "act-out":
      return TASK_TYPES.MIME;

    // Combined draw–mime tasks
    case "draw-mime":
    case "draw_mime":
      return TASK_TYPES.DRAW_MIME;

    // Diff Detective
    case "diff-detective":
    case "diff_detective":
    case "diff":
      return TASK_TYPES.DIFF_DETECTIVE;

    // Hide & Seek
    case "hidenseek":
    case "hide-n-seek":
    case "hide_and_seek":
    case "hide-and-seek":
      return TASK_TYPES.HIDENSEEK;

    // Speed Draw (aliases)
    case "speed-draw":
    case "speed_draw":
      return TASK_TYPES.SPEED_DRAW;

    // AI Debate Judge (NEW)
    case "ai-debate-judge":
    case "ai_debate_judge":
    case "debate-judge":
      return TASK_TYPES.AI_DEBATE_JUDGE;

    // Hangman (NEW)
    case "hangman":
    case "hangman-duel":
    case "hangman_duel":
    case "hangmanduel":
      return TASK_TYPES.HANGMAN_DUEL;

    // ✅ WordWeaver Duel (NEW)
    case "word-weaver":
    case "word_weaver":
    case "wordweaver":
    case "word-weaver-duel":
    case "word_weaver_duel":
    case "wordweaverduel":
      return TASK_TYPES.WORD_WEAVER_DUEL;

    // already normalized constant coming through
    case TASK_TYPES.WORD_WEAVER_DUEL:
      return TASK_TYPES.WORD_WEAVER_DUEL;

    // ✅ Script Play
    case "script-play":
    case "script_play":
    case "scriptplay":
    case "script":
      return TASK_TYPES.SCRIPT_PLAY;

    // ✅ Role Play Deck
    case "role-play":
    case "roleplay":
    case "role-play-deck":
    case "role_play_deck":
    case "roleplaydeck":
    case "role-play-task":
      return TASK_TYPES.ROLE_PLAY_DECK;

    default:
      return raw;
  }
}

function EchoChainInline({ task, onSubmit, disabled, readOnly = false }) {
  const seed = String(task?.seedTerm || task?.config?.seedTerm || "").trim();
  const perTurnSeconds = Number(task?.config?.perTurnSeconds ?? task?.perTurnSeconds ?? 10) || 0;
  const rotationBonus = Number(task?.config?.rotationBonusPoints ?? 25) || 0;

  const [chain, setChain] = useState(() => (seed ? [seed] : []));
  const [nextWord, setNextWord] = useState("");
  const [turn, setTurn] = useState(1);

  // Simple per-turn timer (optional). This is a UI helper only; scoring is handled by backend/session rules.
  const [timeLeft, setTimeLeft] = useState(perTurnSeconds > 0 ? perTurnSeconds : null);
  useEffect(() => {
    if (readOnly) return;
    if (!perTurnSeconds || perTurnSeconds <= 0) return;
    setTimeLeft(perTurnSeconds);
  }, [perTurnSeconds, turn, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (timeLeft == null) return;
    if (timeLeft <= 0) return;

    const tId = setTimeout(() => setTimeLeft((t) => (t == null ? null : t - 1)), 1000);
    return () => clearTimeout(tId);
  }, [timeLeft, readOnly]);

  const addWord = () => {
    if (disabled || readOnly) return;
    const w = String(nextWord || "").trim();
    if (!w) return;
    setChain((prev) => [...prev, w]);
    setNextWord("");
    setTurn((t) => t + 1);
  };

  const reset = () => {
    if (disabled || readOnly) return;
    setChain(seed ? [seed] : []);
    setNextWord("");
    setTurn(1);
  };

  const finish = () => {
    if (disabled || readOnly) return;
    onSubmit?.({
      type: TASK_TYPES.ECHO_CHAIN,
      completed: true,
      chain,
      chainLength: chain.length,
      perTurnSeconds,
      rotationBonusPoints: rotationBonus,
    });
  };

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${CONTRAST_BORDER}`,
        background: CONTRAST_BG_LIGHT,
        padding: 12,
        color: CONTRAST_TEXT_DARK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: "1rem" }}>🔊 Echo Chain</div>

        {perTurnSeconds > 0 && (
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#ffffff",
              fontWeight: 700,
              fontSize: "0.9rem",
            }}
            aria-label="Turn timer"
            title="Optional per-turn timer"
          >
            ⏱ {timeLeft ?? perTurnSeconds}s
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: "0.95rem" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>How to play</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.35 }}>
          <li>
            Start with: <strong>{seed || "the seed term"}</strong>
          </li>
          <li>Player 1 repeats it aloud and adds one related term.</li>
          <li>Next player repeats the full chain in order and adds one.</li>
          <li>If someone forgets or changes order, the chain breaks—reset and try again.</li>
        </ul>
        {rotationBonus > 0 && (
          <div style={{ marginTop: 6, fontSize: "0.9rem", color: "#334155" }}>
            ⭐ Bonus idea: +{rotationBonus} points for a full rotation without errors.
          </div>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Current chain <span style={{ fontWeight: 700 }}>({chain.length})</span>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            padding: 10,
            borderRadius: 14,
            background: "#ffffff",
            border: `1px solid ${CONTRAST_BORDER}`,
            minHeight: 52,
          }}
        >
          {chain.length ? (
            chain.map((w, i) => (
              <span
                key={`${w}:${i}`}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "#eef2ff",
                  border: "1px solid #c7d2fe",
                  fontSize: "0.9rem",
                }}
              >
                {i + 1}. {w}
              </span>
            ))
          ) : (
            <span style={{ color: "#64748b", fontSize: "0.9rem" }}>
              Waiting for the seed term…
            </span>
          )}
        </div>
      </div>

      {!readOnly && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={nextWord}
            onChange={(e) => setNextWord(e.target.value)}
            disabled={disabled}
            placeholder="Type the next word your team adds…"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              fontSize: "0.95rem",
              outline: "none",
            }}
          />

          <button
            type="button"
            onClick={addWord}
            disabled={disabled || !String(nextWord || "").trim()}
            style={{
              padding: "10px 12px",
              borderRadius: 999,
              border: "none",
              background: !String(nextWord || "").trim() ? "#9ca3af" : CONTRAST_ACCENT,
              color: "#ffffff",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          onClick={reset}
          disabled={disabled || readOnly}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: `1px solid ${CONTRAST_BORDER}`,
            background: "#ffffff",
            color: CONTRAST_TEXT_DARK,
            fontWeight: 700,
            cursor: disabled || readOnly ? "not-allowed" : "pointer",
          }}
        >
          Reset
        </button>

        <button
          type="button"
          onClick={finish}
          disabled={disabled || readOnly}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "none",
            background: "#16a34a",
            color: "#ffffff",
            fontWeight: 800,
            cursor: disabled || readOnly ? "not-allowed" : "pointer",
          }}
          title="Submit a completion snapshot (optional)"
        >
          Done ✅
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Multi-part renderer for MC / TF / Short Answer
   ───────────────────────────────────────────── */

function MultiPartTask({
  mode,
  task,
  review,
  readOnly = false,
  onSubmit,
  submitting,
  disabled,
}) {
  const isChoice = mode === "choice";
  const isReview = !!readOnly;

  const rawItems =
    (Array.isArray(task.items) && task.items.length > 0 && task.items) ||
    (Array.isArray(task.questions) && task.questions.length > 0 && task.questions) ||
    (Array.isArray(task.subItems) && task.subItems.length > 0 && task.subItems) ||
    (Array.isArray(task.multiQuestions) && task.multiQuestions.length > 0 && task.multiQuestions) ||
    [];

  const items =
    rawItems.length > 0
      ? rawItems
      : [
          {
            id: task.id || "only",
            prompt: task.prompt,
            options: task.options || [],
            correctAnswer: task.correctAnswer ?? null,
          },
        ];

  const itemOptions = useMemo(() => {
    const taskKey = String(task?._id || task?.id || "task");

    return items.map((item, idx) => {
      const base =
        (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
        (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
        (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
          ? ["True", "False"]
          : []);

      if (!base || base.length === 0) return [];

      const itemKey = String(item?.id || item?._id || `i${idx}`);
      return seededShuffle(base, `${taskKey}:${itemKey}`);
    });
  }, [task?._id, task?.id, items]);

  const [answers, setAnswers] = useState(() =>
    items.map(() => ({ value: isChoice ? null : "" }))
  );

  const handleChoiceClick = (itemIndex, option) => {
    setAnswers((prev) =>
      prev.map((ans, idx) => (idx === itemIndex ? { ...ans, value: option } : ans))
    );
  };

  const handleTextChange = (itemIndex, value) => {
    setAnswers((prev) =>
      prev.map((ans, idx) => (idx === itemIndex ? { ...ans, value } : ans))
    );
  };

  const allAnswered = answers.every(
    (ans) => ans.value !== null && String(ans.value).trim() !== ""
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submitting || disabled || !allAnswered) return;

    const payload = items.map((item, idx) => {
      let answerVal = answers[idx]?.value ?? null;

      const isTF = task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE;

      if (isTF && typeof answerVal === "string") {
        const v = answerVal.trim().toLowerCase();
        if (v === "true" || v === "false") answerVal = v;
      }

      let baseIndex = null;
      if (isChoice && answerVal != null) {
        const base =
          (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
          (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
          (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
            ? ["True", "False"]
            : []);

        if (base && base.length > 0) {
          const idxBase = base.findIndex(
            (opt) => String(opt).trim() === String(answerVal).trim()
          );
          baseIndex = idxBase >= 0 ? idxBase : null;
        }
      }

      return {
        itemId: item.id ?? idx,
        prompt: item.prompt ?? item.text ?? "",
        value: answerVal,
        baseIndex,
      };
    });

    const payloadObj = {
      type: mode === "choice" ? "multi-choice" : "multi-short",
      answers: payload,
    };

    onSubmit?.(payloadObj);
  };

  return (
    <form onSubmit={handleSubmit}>
      {task.prompt && (
        <p
          style={{
            marginTop: 0,
            marginBottom: 12,
            fontSize: "1rem",
            fontWeight: 500,
            color: CONTRAST_TEXT_DARK,
          }}
        >
          {task.prompt}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, idx) => {
          const labelRaw =
            item?.label ??
            item?.question ??
            item?.prompt ??
            item?.stem ??
            item?.text ??
            item?.title ??
            item?.description ??
            "";

          const label =
            typeof labelRaw === "string" && labelRaw.trim()
              ? labelRaw.trim()
              : `Question ${idx + 1}`;
          const opts = itemOptions[idx] || [];
          const answerVal = answers[idx]?.value ?? "";
          const correctIndex = item?.correctAnswer ?? null;
          const studentIndex =
            review?.answers?.[idx]?.baseIndex ?? review?.studentAnswer?.[idx]?.baseIndex ?? null;

          return (
            <div
              key={item.id ?? idx}
              style={{
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: CONTRAST_BG_LIGHT,
                color: CONTRAST_TEXT_DARK,
              }}
            >
              {label && (
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    color: CONTRAST_TEXT_DARK,
                  }}
                >
                  <span style={{ marginRight: 4 }}>{idx + 1}.</span>
                  {label}
                </div>
              )}

              {isChoice ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                  {opts.map((opt, optIndex) => {
                    const base =
                      (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
                      (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
                      (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
                        ? ["True", "False"]
                        : []);

                    const optBaseIndex = base.findIndex(
                      (x) => String(x).trim() === String(opt).trim()
                    );

                    const isSelected = answerVal === opt;
                    const isCorrect = isReview && optBaseIndex === correctIndex;
                    const isChosen = isReview && optBaseIndex === studentIndex;

                    const border =
                      isReview && isCorrect
                        ? "2px solid #16a34a"
                        : isReview && isChosen && !isCorrect
                        ? "2px solid #dc2626"
                        : isSelected
                        ? `2px solid ${CONTRAST_ACCENT}`
                        : `1px solid ${CONTRAST_BORDER}`;

                    const background = isSelected ? CONTRAST_ACCENT : "#ffffff";
                    const color = isSelected ? "#ffffff" : CONTRAST_TEXT_DARK;

                    return (
                      <button
                        key={`${item.id ?? idx}:${optIndex}`}
                        type="button"
                        onClick={() => handleChoiceClick(idx, opt)}
                        disabled={submitting || disabled}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          border,
                          background,
                          color,
                          textAlign: "left",
                          cursor: submitting || disabled ? "not-allowed" : "pointer",
                          fontSize: "0.9rem",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  rows={2}
                  value={answerVal}
                  onChange={(e) => handleTextChange(idx, e.target.value)}
                  disabled={submitting || disabled}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 10,
                    border: `1px solid ${CONTRAST_BORDER}`,
                    fontSize: "0.9rem",
                    resize: "vertical",
                    color: CONTRAST_TEXT_DARK,
                  }}
                  placeholder="Type your answer…"
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={!allAnswered || submitting || disabled}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "none",
            background: allAnswered ? "#16a34a" : "#9ca3af",
            color: "#ffffff",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: !allAnswered || submitting || disabled ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Sending…" : items.length > 1 ? "Submit all" : "Submit"}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────
   Main TaskRunner
   ───────────────────────────────────────────── */

export default function TaskRunner({
  task,
  taskTypes,
  onSubmit,
  submitting = false,
  onAnswerChange,
  answerDraft,
  disabled = false,
  socket,

  mode = "play", // play || review
  review = null,

  // for FlashcardsRace
  roomCode,
  playerTeam,
  memberNames = [],
  partnerAnswer,
  showPartnerReply,
  onPartnerReply,
}) {
  if (!task) return null;

  const t = task || null;
  const type = t ? normalizeTaskType(t.taskType || t.type) : null;

  const handleTaskSubmit = (payload) => {
    let outgoing = payload;
    if (payload != null && typeof payload !== "object") {
      outgoing = { type, answer: payload };
    }
    try {
      onSubmit && onSubmit(outgoing);
    } catch {}
  };

  // Hangman expects socket.current; keep existing socket usage for other tasks.
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket || null;
  }, [socket]);

  const isReview = mode === "review";

  const isChoiceType = type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.TRUE_FALSE;
  const isShortType = type === TASK_TYPES.SHORT_ANSWER;

  const hasMultiItems =
    (Array.isArray(t.items) && t.items.length > 1) ||
    (Array.isArray(t.questions) && t.questions.length > 1) ||
    (Array.isArray(t.subItems) && t.subItems.length > 1) ||
    (Array.isArray(t.multiQuestions) && t.multiQuestions.length > 1);

  const meta = TASK_TYPE_META[type];
  const [diffRaceStatus, setDiffRaceStatus] = useState(null);

  useEffect(() => {
    if (!socket) return;

    const isDiffDetective =
      (t.taskType || t.type) === TASK_TYPES.DIFF_DETECTIVE || (t.taskType || t.type) === "diff-detective";

    if (!isDiffDetective) {
      setDiffRaceStatus(null);
      return;
    }

    const handleRaceStart = (payload) => {
      setDiffRaceStatus({
        startedAt: payload.startedAt || Date.now(),
        leader: null,
        timeLeft: null,
      });
    };

    const handleRaceWinner = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        leader: payload.teamName,
        winnerTeamId: payload.teamId,
      }));
    };

    const handleRaceTick = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        timeLeft: payload.timeLeft ?? null,
      }));
    };

    const handleRaceUpdate = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        leader: payload.teamName ?? prev?.leader ?? null,
      }));
    };

    const handleRaceFinish = (payload) => {
      setDiffRaceStatus((prev) => ({
        ...(prev || {}),
        lastFinish: {
          teamId: payload.teamId,
          teamName: payload.teamName,
          rank: payload.rank,
          correct: payload.correct,
        },
      }));
    };

    socket.on("diff:race-start", handleRaceStart);
    socket.on("diff:race-tick", handleRaceTick);
    socket.on("diff:race-update", handleRaceUpdate);
    socket.on("diff:race-end", handleRaceFinish);

    return () => {
      socket.off("diff:race-start", handleRaceStart);
      socket.off("diff:race-tick", handleRaceTick);
      socket.off("diff:race-update", handleRaceUpdate);
      socket.off("diff:race-end", handleRaceFinish);
    };
  }, [socket, t.taskType, t.type]);

  const effectiveDisabled = disabled || submitting;

  const currentDisplay =
    Array.isArray(t.displays) && t.displayKey ? t.displays.find((d) => d.key === t.displayKey) || null : null;

  let displayTitle = "";
  if (meta?.label) displayTitle = toTitleCase(meta.label);
  else if (t.title) displayTitle = toTitleCase(t.title);
  else if (t.taskType && TASK_TYPE_META[t.taskType]?.label) displayTitle = toTitleCase(TASK_TYPE_META[t.taskType].label);

  console.log("[TaskRunner] Task received:", {
    rawTask: t,
    normalizedType: type,
    multiItems: hasMultiItems,
  });

  if (meta && meta.implemented === false) {
    return (
      <div className="p-4 text-center text-red-600 space-y-2">
        <div className="font-semibold">⚠ This task type is not available yet on student devices.</div>
        <div className="text-sm text-red-500">
          Task type: <strong>{meta.label || type}</strong>
        </div>
      </div>
    );
  }

  // ✅ IMPORTANT: Height-aware wrapper so tasks like Flashcards can truly "fill the task card section"
  const Wrap = ({ children }) => (
    <div className="h-full flex flex-col">
      {/* header blocks should not steal flex space from the task itself */}
      {displayTitle && (
        <div
          className="task-title-fun text-center mb-1 shrink-0"
          style={{
            fontFamily: '"Interstellar Log", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: "1.4rem",
            letterSpacing: "1px",
          }}
        >
          {displayTitle}
        </div>
      )}

      {currentDisplay && (
        <div
          className="rounded-lg border px-3 py-2 text-sm shrink-0"
          style={{
            borderColor: CONTRAST_BORDER,
            background: CONTRAST_BG_LIGHT,
            color: CONTRAST_TEXT_DARK,
          }}
        >
          <div className="font-semibold">Look at this station object:</div>
          <div>{currentDisplay.name || currentDisplay.key}</div>
          {currentDisplay.description && (
            <div className="mt-1 text-xs" style={{ color: "#4b5563" }}>
              {currentDisplay.description}
            </div>
          )}
        </div>
      )}

      {/* This is the key: gives children a real height to fill */}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );

  if (hasMultiItems && (isChoiceType || isShortType)) {
    const multiMode = isChoiceType ? "choice" : "short";
    return (
      <Wrap>
        <div className="h-full overflow-auto">
          <MultiPartTask
            mode={multiMode}
            readOnly={isReview}
            task={t}
            review={review}
            onSubmit={isReview ? () => {} : handleTaskSubmit}
            submitting={submitting}
            disabled={effectiveDisabled || isReview}
          />
        </div>
      </Wrap>
    );
  }

  let content = null;

  switch (type) {
    // ✅ Mood Check-in (NEW)
    case TASK_TYPES.MOOD_CHECKIN:
    case "mood-checkin": {
      const effectiveTeamId = t?.teamId || playerTeam?.id || playerTeam?.teamId || playerTeam?.teamID || null;

      content = (
        <MoodCheckInTask
          task={t}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    // ✅ Treasure Runner (warm-up while waiting)
    case TASK_TYPES.TREASURE_RUNNER:
    case "treasure-runner": {
      content = (
        <TreasureRunnerTask
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    // ✅ Guess Who (NEW)
    case TASK_TYPES.GUESS_WHO:
    case "guess-who": {
      content = <GuessWhoTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled || isReview} />;
      break;
    }

    // ✅ Echo Chain (NEW)
    case TASK_TYPES.ECHO_CHAIN:
    case "echo-chain": {
      content = (
        <EchoChainInline
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
        />
      );
      break;
    }


    // ✅ Narration Synthesize (NEW)
    case TASK_TYPES.NARRATION_SYNTHESIZE:
    case "narration-synthesize": {
      content = (
        <NarrationSynthesizeTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
        />
      );
      break;
    }


// ✅ Script Play (NEW)
case TASK_TYPES.SCRIPT_PLAY:
case "script-play": {
  content = (
    <ScriptPlayTask
      task={t}
      onSubmit={handleTaskSubmit}
      disabled={effectiveDisabled || isReview}
      readOnly={isReview}
    />
  );
  break;
}

    // ✅ Role Play Deck (NEW)
    case TASK_TYPES.ROLE_PLAY_DECK:
    case "role-play":
    case "role-play-deck":
    case "roleplay": {
      const effectiveTeamId = t?.teamId || playerTeam?.id || playerTeam?.teamId || playerTeam?.teamID || null;

      content = (
        <RolePlayDeckTask
          task={t}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

    case TASK_TYPES.MULTIPLE_CHOICE:
      content = (
        <MultiPartTask
          mode="choice"
          readOnly={isReview}
          task={t}
          review={isReview ? review : null}
          onSubmit={isReview ? null : handleTaskSubmit}
          submitting={submitting}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;

    case TASK_TYPES.TRUE_FALSE:
      content = (
        <MultiPartTask
          mode="choice"
          readOnly={isReview}
          task={t}
          review={isReview ? review : null}
          onSubmit={isReview ? null : handleTaskSubmit}
          submitting={submitting}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;

    case TASK_TYPES.VENNSORT:
    case "vennsort":
    case "venn-sort":
      content = (
        <VennSortTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.SORT:
      content = (
        <SortTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.SEQUENCE:
      content = (
        <SequenceTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.MATCHING:
    case "matching":
      content = (
        <MatchingTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.PHOTO:
      content = <PhotoTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.PHOTO_JOURNAL:
    case "photo-journal":
      content = (
        <PhotoJournalTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.MAKE_AND_SNAP:
      content = (
        <MakeAndSnapTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
      content = <DrawMimeTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.DRAW_MIME:
      content = (
        <DrawMimeTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.BODY_BREAK:
      content = <BodyBreakTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.OPEN_TEXT:
      content = (
        <OpenTextTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.RECORD_AUDIO:
      content = (
        <RecordAudioTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.SPEECH_RECOGNITION:
      content = <SpeechRecognitionTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.JEOPARDY:
      content = <BrainBlitzTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.PRONUNCIATION:
      content = <PronunciationTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.WORD_WEAVER_DUEL:
    case "word-weaver-duel": {
      const effectiveTeamId = t?.teamId || playerTeam?.id || playerTeam?.teamId || playerTeam?.teamID || null;

      content = (
        <WordWeaverDuelTask
          task={t}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          disabled={effectiveDisabled || isReview}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;
    }

    case TASK_TYPES.SHORT_ANSWER:
      content = (
        <ShortAnswerTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.COLLABORATION:
      content = (
        <CollaborationTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
          partnerAnswer={partnerAnswer}
          showPartnerReply={showPartnerReply}
          onPartnerReply={onPartnerReply}
        />
      );
      break;

    case TASK_TYPES.MUSICAL_CHAIRS:
      content = <MusicalChairsTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.MYSTERY_CLUES:
      content = <MysteryCluesTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;


    case TASK_TYPES.FAKE_OUT:
      content = (
        <FakeOutTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          readOnly={isReview}
        />
      );
      break;
    case TASK_TYPES.TRUE_FALSE_TICTACTOE:
      content = (
        <TrueFalseTicTacToeTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          teamRole={t.teamRole}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.MAD_DASH:
    case TASK_TYPES.MAD_DASH_SEQUENCE:
      content = <MadDashSequenceTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.LIVE_DEBATE:
      content = (
        <LiveDebateTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          teamMembers={t.teamMembers || ["Alice", "Bob", "Charlie", "Dana"]}
        />
      );
      break;

    case TASK_TYPES.AI_DEBATE_JUDGE:
      content = (
        <AIDebateJudgeTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.FLASHCARDS:
      content = (
        <FlashcardsTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
        />
      );
      break;

    case TASK_TYPES.FLASHCARDS_RACE:
      // ✅ no early return; keep consistent wrapper/theming
      content = (
        <FlashcardsRaceTask
          task={t}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;

    case TASK_TYPES.TIMELINE:
      content = <TimelineTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.PET_FEEDING:
      content = <PetFeedingTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.MOTION_MISSION:
      content = <MotionMissionTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.BRAINSTORM_BATTLE:
      content = <BrainstormBattleTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.MIND_MAPPER:
      content = <MindMapperTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.SPEED_DRAW:
      content = <SpeedDrawTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />;
      break;

    case TASK_TYPES.DIFF_DETECTIVE:
      content = (
        <DiffDetectiveTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
          socket={socket}
          raceStatus={diffRaceStatus}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.BRAIN_SPARK_NOTES:
      content = <BrainSparkNotesTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.HIDENSEEK:
      content = <HideNSeekTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.HANGMAN_DUEL:
    case "hangman-duel": {
      const effectiveTeamId = t?.teamId || playerTeam?.id || playerTeam?.teamId || playerTeam?.teamID || null;

      const stationIndex = Number.isFinite(t?.stationIndex) ? t.stationIndex : null;

      const wordFromItems =
        Array.isArray(t?.items) && stationIndex != null
          ? (t.items?.[stationIndex]?.word ||
            t.items?.[stationIndex]?.hangmanWord ||
            t.items?.[stationIndex]?.answer ||
            t.items?.[stationIndex]?.value)
          : null;

      const wordFallback =
        t?.word ||
        t?.hangmanWord ||
        t?.data?.word ||
        wordFromItems ||
        (Array.isArray(t?.options) ? t.options?.[0] : null) ||
        t?.correctAnswer ||
        t?.displayKey ||
        "";

      const tFixed = { ...t, word: wordFallback };

      content = (
        <HangmanDuelTask
          task={tFixed}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
        />
      );
      break;
    }

    default:
      return (
        <div className="p-4 text-center text-red-600 space-y-2">
          <div className="font-semibold">⚠ Unsupported task type from server.</div>
          <div className="text-sm text-red-500">
            Received type: <strong>{String(type)}</strong>
          </div>
        </div>
      );
  }

  return <Wrap>{content}</Wrap>;
}