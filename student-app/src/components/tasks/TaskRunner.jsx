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
import MultiPlayerFeedbackTask from "./types/MultiPlayerFeedbackTask";
import GuessWhoTask from "./types/GuessWhoTask"; // ✅ NEW (Guess Who)
import NarrationSynthesizeTask from "./types/NarrationSynthesizeTask";
import PhysicalMultipleChoiceTask from "./types/PhysicalMultipleChoiceTask";

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

    case "brain-spark-notes":
    case "brain_spark_notes":
    case "brainsparknotes":
    case "brain spark notes":
      return TASK_TYPES.BRAIN_SPARK_NOTES;

    case "mind-mapper":
    case "mind_mapper":
    case "mindmapper":
    case "mind map":
    case "mind-map":
      return TASK_TYPES.MIND_MAPPER;

    case "physical-multiple-choice":
    case "physical_multiple_choice":
    case "physical-mc":
    case "pmc":
      return TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;

    case "tf":
    case "true_false":
    case "true-false":
      return TASK_TYPES.TRUE_FALSE;

    case "short":
    case "short-answer":
      return TASK_TYPES.SHORT_ANSWER;

    case "open":
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

    
// Feedback / reflection
case "multi-player-feedback":
case "multi_player_feedback":
case "multiplayerfeedback":
case "feedback":
  return TASK_TYPES.MULTI_PLAYER_FEEDBACK;

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


    // Motion Mission
    case "motion-mission":
    case "motion_mission":
    case "motionmission":
      return TASK_TYPES.MOTION_MISSION;

    // Musical Chairs
    case "musical-chairs":
    case "musical_chairs":
    case "musicalchairs":
      return TASK_TYPES.MUSICAL_CHAIRS;

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

    // ✅ Fake Out (NEW)
    case "fakeout":
    case "fake-out":
    case "fake_out":
    case "fake out":
      return TASK_TYPES.FAKE_OUT;

    // Brainstorm Battle
    case "brainstorm-battle":
    case "brainstorm_battle":
    case "brainstormbattle":
      return TASK_TYPES.BRAINSTORM_BATTLE;

    // Collaboration
    case "collaboration":
    case "collab":
      return TASK_TYPES.COLLABORATION;

    // Live Debate
    case "live-debate":
    case "live_debate":
    case "debate":
      return TASK_TYPES.LIVE_DEBATE;

    // Brain Blitz / Jeopardy
    case "brain-blitz":
    case "brain_blitz":
    case "brainblitz":
    case "jeopardy":
      return TASK_TYPES.JEOPARDY;

    // Pet Feeding
    case "pet-feeding":
    case "pet_feeding":
    case "petfeeding":
    case "feed-the-pet":
      return TASK_TYPES.PET_FEEDING;


    default:
      return raw;
  }
}

function EchoChainInline({ task, onSubmit, disabled, readOnly = false }) {
  const seed = String(task?.seedTerm || task?.config?.seedTerm || "").trim();
  const perTurnSeconds =
    Number(task?.config?.perTurnSeconds ?? task?.perTurnSeconds ?? 10) || 0;
  const rotationBonus = Number(task?.config?.rotationBonusPoints ?? 25) || 0;

  const [chain, setChain] = useState(() => (seed ? [seed] : []));
  const [nextWord, setNextWord] = useState("");
  const [turn, setTurn] = useState(1);

  // Simple per-turn timer (optional). This is a UI helper only; scoring is handled by backend/session rules.
  const [timeLeft, setTimeLeft] = useState(
    perTurnSeconds > 0 ? perTurnSeconds : null
  );
  useEffect(() => {
    if (readOnly) return;
    if (!perTurnSeconds || perTurnSeconds <= 0) return;
    setTimeLeft(perTurnSeconds);
  }, [perTurnSeconds, turn, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (timeLeft == null) return;
    if (timeLeft <= 0) return;

    const tId = setTimeout(
      () => setTimeLeft((t) => (t == null ? null : t - 1)),
      1000
    );
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
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
          <li>
            If someone forgets or changes order, the chain breaks—reset and try
            again.
          </li>
        </ul>
        {rotationBonus > 0 && (
          <div style={{ marginTop: 6, fontSize: "0.9rem", color: "#334155" }}>
            ⭐ Bonus idea: +{rotationBonus} points for a full rotation without
            errors.
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
        <div
          style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}
        >
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
              background: !String(nextWord || "").trim()
                ? "#9ca3af"
                : CONTRAST_ACCENT,
              color: "#ffffff",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
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
    (Array.isArray(task.multiQuestions) &&
      task.multiQuestions.length > 0 &&
      task.multiQuestions) ||
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

      const isTF =
        task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE;

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
            review?.answers?.[idx]?.baseIndex ??
            review?.studentAnswer?.[idx]?.baseIndex ??
            null;

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
                      (task.taskType === TASK_TYPES.TRUE_FALSE ||
                      task.type === TASK_TYPES.TRUE_FALSE
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
   Physical Multiple Choice (scan-to-submit)
   ───────────────────────────────────────────── */

function PhysicalMultipleChoiceInline({
  task,
  onSubmit,
  disabled,
  socket,
  mode = "play", // play | review
  review = null,
}) {
  const isReview = mode === "review";

  const fixedStationColors =
    (Array.isArray(task?.config?.stationColors) && task.config.stationColors.length >= 8
      ? task.config.stationColors
      : ["Red", "Orange", "Yellow", "Green", "Blue", "Teal", "Purple", "Pink"]);

  const rawItems =
    (Array.isArray(task.items) && task.items.length > 0 && task.items) ||
    (Array.isArray(task.questions) && task.questions.length > 0 && task.questions) ||
    [];

  const items =
    rawItems.length > 0
      ? rawItems
      : [
          {
            id: task.id || "q1",
            prompt: task.prompt || "Choose the best answer.",
            options: Array.isArray(task.options) ? task.options : [],
            correctAnswer: task.correctAnswer ?? null,
          },
        ];

  const taskKey = String(task?._id || task?.id || task?.taskId || "task");

  // Answer state per question (canonical option index 0..3)
  const [qIndex, setQIndex] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [answers, setAnswers] = useState(() => new Array(items.length).fill(null));

  // last scanned station color (from socket or window event)
  const [lastScanColor, setLastScanColor] = useState(null);
  const lastScanAtRef = useRef(0);

  // stable color map per question
  const colorMapByQuestion = useMemo(() => {
    return items.map((it, idx) => {
      const qId = String(it?.id ?? `q${idx + 1}`);
      const pick4 = seededShuffle(fixedStationColors, `${taskKey}:${qId}:colors`).slice(0, 4);
      // map letters A-D to colors
      return {
        A: pick4[0],
        B: pick4[1],
        C: pick4[2],
        D: pick4[3],
        byIndex: pick4, // 0..3
      };
    });
  }, [items.length, fixedStationColors.join("|"), taskKey]);

  // reset when task changes
  useEffect(() => {
    setQIndex(0);
    setSelectedIdx(null);
    setAnswers(new Array(items.length).fill(null));
    setLastScanColor(null);
    lastScanAtRef.current = 0;
  }, [taskKey, items.length]);

  // socket listeners (best-effort; payload shape may vary)
  useEffect(() => {
    if (!socket || isReview) return;

    const handler = (payload) => {
      const color =
        payload?.color ||
        payload?.stationColor ||
        payload?.station?.color ||
        payload?.station?.stationColor ||
        payload?.qrColor ||
        payload?.data?.color ||
        null;

      const s = String(color || "").trim();
      if (!s) return;

      // debounce identical scans
      const now = Date.now();
      if (now - lastScanAtRef.current < 250) return;
      lastScanAtRef.current = now;

      setLastScanColor(s);
    };

    socket.on?.("station:scan", handler);
    socket.on?.("station-scan", handler);
    socket.on?.("qr:scan", handler);
    socket.on?.("scan", handler);

    return () => {
      socket.off?.("station:scan", handler);
      socket.off?.("station-scan", handler);
      socket.off?.("qr:scan", handler);
      socket.off?.("scan", handler);
    };
  }, [socket, isReview]);

  // window event hook (so StudentApp can dispatch without socket if needed)
  useEffect(() => {
    if (isReview) return;

    const handler = (ev) => {
      const color = ev?.detail?.color || ev?.detail?.stationColor || null;
      const s = String(color || "").trim();
      if (!s) return;
      setLastScanColor(s);
    };

    window.addEventListener("curriculate:stationScan", handler);
    return () => window.removeEventListener("curriculate:stationScan", handler);
  }, [isReview]);

  const current = items[qIndex] || null;
  const optionsRaw = Array.isArray(current?.options) ? current.options : [];

  // Enforce 4 visible options for UI (pad/truncate defensively)
  const options = useMemo(() => {
    const base = optionsRaw.slice(0, 4);
    while (base.length < 4) base.push(`Option ${String.fromCharCode(65 + base.length)}`);
    return base;
  }, [optionsRaw.join("|"), qIndex]);

  const map = colorMapByQuestion[qIndex] || { byIndex: ["Red", "Teal", "Purple", "Green"] };
  const expectedColor = selectedIdx == null ? null : map.byIndex?.[selectedIdx] || null;

  const allAnswered = answers.every((a) => a != null);

  // When a scan arrives, auto-submit that answer if it matches expected
  useEffect(() => {
    if (disabled || isReview) return;
    if (!lastScanColor) return;
    if (selectedIdx == null) return;
    if (!expectedColor) return;

    const ok = String(lastScanColor).toLowerCase() === String(expectedColor).toLowerCase();
    if (!ok) return;

    setAnswers((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[qIndex] = selectedIdx;
      return next;
    });

    // move to next question or finish
    setSelectedIdx(null);
    setLastScanColor(null);

    setQIndex((prev) => {
      const nextIdx = prev + 1;
      return nextIdx < items.length ? nextIdx : prev;
    });
  }, [lastScanColor, expectedColor, selectedIdx, disabled, isReview, qIndex, items.length]);

  // If we just answered the last question, submit payload
  useEffect(() => {
    if (disabled || isReview) return;
    if (!allAnswered) return;

    const payload = {
      kind: "multi-mc",
      answers, // canonical per question (0..3)
      // helpful for transcript/debugging (does not affect scoring)
      physical: true,
      colorMapByQuestion: colorMapByQuestion.map((m) => ({ A: m.A, B: m.B, C: m.C, D: m.D })),
      stationColors: fixedStationColors,
    };

    const payloadString = JSON.stringify(payload);
    onSubmit?.(payloadString);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnswered]);

  const correctIdx =
    isReview && Number.isInteger(current?.correctAnswer) ? current.correctAnswer : null;

  const selectedIsCorrect = isReview && selectedIdx != null && correctIdx != null && selectedIdx === correctIdx;

  return (
    <div
      className="h-full flex flex-col"
      style={{
        borderRadius: 16,
        border: `1px solid ${CONTRAST_BORDER}`,
        background: CONTRAST_BG_LIGHT,
        padding: 12,
        color: CONTRAST_TEXT_DARK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>🚶‍♂️ Physical Multiple Choice</div>

        <div
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${CONTRAST_BORDER}`,
            background: "#ffffff",
            fontWeight: 800,
            fontSize: "0.9rem",
          }}
        >
          {qIndex + 1}/{items.length}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: "1rem", fontWeight: 700 }}>
        {typeof current?.prompt === "string" && current.prompt.trim()
          ? current.prompt.trim()
          : "Choose the best answer."}
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        {["A", "B", "C", "D"].map((letter, i) => {
          const isSelected = selectedIdx === i;

          const isCorrect = isReview && correctIdx === i;
          const isWrongChoice = isReview && isSelected && correctIdx != null && !isCorrect;

          const border =
            isReview && isCorrect
              ? "2px solid #16a34a"
              : isReview && isWrongChoice
              ? "2px solid #dc2626"
              : isSelected
              ? `2px solid ${CONTRAST_ACCENT}`
              : `1px solid ${CONTRAST_BORDER}`;

          const bg =
            isReview && isCorrect
              ? "#dcfce7"
              : isReview && isWrongChoice
              ? "#fee2e2"
              : isSelected
              ? "#e0f2fe"
              : "#ffffff";

          return (
            <button
              key={letter}
              type="button"
              disabled={disabled || isReview}
              onClick={() => setSelectedIdx(i)}
              style={{
                padding: "10px 12px",
                borderRadius: 16,
                border,
                background: bg,
                textAlign: "left",
                cursor: disabled || isReview ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: "#0ea5e9",
                    color: "#ffffff",
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 auto",
                  }}
                >
                  {letter}
                </div>

                <div style={{ fontSize: "0.98rem", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(options[i] ?? "")}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
                <div
                  title={`Scan ${map.byIndex?.[i] || ""}`}
                  aria-label={`Scan ${map.byIndex?.[i] || ""}`}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    background: map.byIndex?.[i] ? String(map.byIndex[i]).toLowerCase() : "#94a3b8",
                    border: "2px solid rgba(15,23,42,0.15)",
                  }}
                />
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#334155" }}>
                  {map.byIndex?.[i] || ""}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!isReview && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: `1px solid ${CONTRAST_BORDER}`, background: "#ffffff" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>How to submit</div>
          {selectedIdx == null ? (
            <div style={{ color: "#475569" }}>Tap A–D to choose, then walk to the matching colored QR station and scan.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ color: "#0f172a", fontWeight: 700 }}>
                Scan the <span style={{ fontWeight: 900 }}>{expectedColor}</span> station to submit{" "}
                <span style={{ fontWeight: 900 }}>{["A", "B", "C", "D"][selectedIdx]}</span>.
              </div>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: String(expectedColor || "").toLowerCase(),
                  border: "2px solid rgba(15,23,42,0.15)",
                }}
              />
              {lastScanColor && (
                <div style={{ fontSize: "0.9rem", color: "#64748b" }}>
                  Last scan: <strong>{lastScanColor}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isReview && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: `1px solid ${CONTRAST_BORDER}`, background: "#ffffff" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Review</div>
          <div style={{ color: "#475569" }}>
            Correct answer is highlighted in green. (Physical station scanning is disabled in review mode.)
          </div>
        </div>
      )}
    </div>
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

  // Derived team id for tasks that need it (media uploads, inter-team routing, etc.)
  const derivedTeamId =
    t?.teamId ||
    playerTeam?.id ||
    playerTeam?.teamId ||
    playerTeam?.teamID ||
    null;

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
      (t.taskType || t.type) === TASK_TYPES.DIFF_DETECTIVE ||
      (t.taskType || t.type) === "diff-detective";

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
    Array.isArray(t.displays) && t.displayKey
      ? t.displays.find((d) => d.key === t.displayKey) || null
      : null;

  let displayTitle = "";
  if (meta?.label) displayTitle = toTitleCase(meta.label);
  else if (t.title) displayTitle = toTitleCase(t.title);
  else if (t.taskType && TASK_TYPE_META[t.taskType]?.label)
    displayTitle = toTitleCase(TASK_TYPE_META[t.taskType].label);

  console.log("[TaskRunner] Task received:", {
    rawTask: t,
    normalizedType: type,
    multiItems: hasMultiItems,
  });

  if (meta && meta.implemented === false) {
    return (
      <div className="p-4 text-center text-red-600 space-y-2">
        <div className="font-semibold">
          ⚠ This task type is not available yet on student devices.
        </div>
        <div className="text-sm text-red-500">
          Task type: <strong>{meta.label || type}</strong>
        </div>
      </div>
    );
  }

  // --- Unified task theming (TaskFrame) ---------------------------------

const THEME_PRESETS = {
  default: {
    bg: "linear-gradient(135deg, #e0f2fe 0%, #ffffff 45%, #e0e7ff 100%)",
    card: "rgba(255,255,255,0.92)",
    border: "rgba(15,23,42,0.12)",
    title: "#0f172a",
    sub: "#475569",
    accent: "#0ea5e9",
    badgeBg: "rgba(14,165,233,0.12)",
    badgeText: "#0369a1",
  },

  physical: {
    bg: "linear-gradient(135deg, #fff7ed 0%, #ffffff 45%, #ecfccb 100%)",
    card: "rgba(255,255,255,0.92)",
    border: "rgba(15,23,42,0.12)",
    title: "#0f172a",
    sub: "#475569",
    accent: "#16a34a",
    badgeBg: "rgba(22,163,74,0.12)",
    badgeText: "#166534",
  },

  battle: {
    bg: "linear-gradient(135deg, #0b1220 0%, #111827 55%, #1e293b 100%)",
    card: "rgba(255,255,255,0.08)",
    border: "rgba(255,255,255,0.14)",
    title: "#ffffff",
    sub: "rgba(255,255,255,0.75)",
    accent: "#a78bfa",
    badgeBg: "rgba(167,139,250,0.18)",
    badgeText: "#ede9fe",
  },

  notes: {
    bg: "linear-gradient(135deg, #fffbeb 0%, #ffffff 50%, #fef3c7 100%)",
    card: "rgba(255,255,255,0.94)",
    border: "rgba(15,23,42,0.12)",
    title: "#0f172a",
    sub: "#475569",
    accent: "#f59e0b",
    badgeBg: "rgba(245,158,11,0.16)",
    badgeText: "#92400e",
  },
};

  function pickThemeForTask(type, t) {
    // Allow JSON overrides from backend/AI
    const ui = t?.ui || t?.config?.ui || null;
    const presetId = ui?.themeId || ui?.preset;

    if (presetId && THEME_PRESETS[presetId]) return { ...THEME_PRESETS[presetId], ...ui };

    // Lightweight defaults by type
    if (type === TASK_TYPES.BODY_BREAK || type === TASK_TYPES.MOTION_MISSION) {
      return { ...THEME_PRESETS.physical, ...ui };
    }
    if (type === TASK_TYPES.BRAINSTORM_BATTLE) return { ...THEME_PRESETS.battle, ...ui };
    if (type === TASK_TYPES.BRAIN_SPARK_NOTES) return { ...THEME_PRESETS.notes, ...ui };

    return { ...THEME_PRESETS.default, ...ui };
  }

  function secondsToClock(s) {
    if (!Number.isFinite(s)) return null;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  // ✅ Unified TaskFrame wrapper (every task inherits the same “beautiful shell”)
  const TaskFrame = ({ children }) => {
    const theme = pickThemeForTask(type, t);

    const hideTitle =
      !!t?.ui?.hideTitle || !!t?.config?.ui?.hideTitle || !!t?.config?.hideTaskRunnerTitle;

    const badge =
      t?.ui?.badge ||
      t?.config?.ui?.badge ||
      (theme === THEME_PRESETS.physical ? "PHYSICAL" : null);

    const showTimer =
      Number.isFinite(t?.timeLimitSeconds) && t.timeLimitSeconds > 0 && !isReview;

    const timerText = showTimer ? secondsToClock(t.timeLimitSeconds) : null;

    return (
      <div
        className="h-full flex flex-col"
        style={{
          borderRadius: 18,
          padding: 12,
          background: theme.bg,
        }}
      >
        {/* Header row */}
        {!hideTitle && (
          <div
            className="shrink-0"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {/* Badge */}
              {(badge || t?.ui?.icon) && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: `1px solid ${theme.border}`,
                    background: theme.badgeBg,
                    color: theme.badgeText,
                    fontWeight: 900,
                    fontSize: 12,
                    letterSpacing: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t?.ui?.icon ? <span style={{ fontSize: 16 }}>{t.ui.icon}</span> : null}
                  <span>{String(badge || "").toUpperCase()}</span>
                </div>
              )}

              {/* Title */}
              {displayTitle && (
                <div
                  className="task-title-fun"
                  style={{
                    fontFamily:
                      '"Interstellar Log", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    fontSize: "1.3rem",
                    letterSpacing: "0.5px",
                    color: theme.title,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={displayTitle}
                >
                  {displayTitle}
                </div>
              )}
            </div>

            {/* Right-side pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {timerText && (
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: `1px solid ${theme.border}`,
                    background: theme.card,
                    color: theme.title,
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                  title="Time limit"
                >
                  ⏱ {timerText}
                </div>
              )}

              {isReview && (
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: `1px solid ${theme.border}`,
                    background: theme.card,
                    color: theme.title,
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                >
                  REVIEW
                </div>
              )}
            </div>
          </div>
        )}

        {/* Optional display block (kept, but styled to match frame) */}
        {currentDisplay && (
          <div
            className="shrink-0"
            style={{
              borderRadius: 16,
              border: `1px solid ${theme.border}`,
              background: theme.card,
              padding: 10,
              marginBottom: 10,
              color: theme.title,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Station object</div>
            <div style={{ fontWeight: 800 }}>{currentDisplay.name || currentDisplay.key}</div>
            {currentDisplay.description && (
              <div style={{ marginTop: 4, fontSize: 12, color: theme.sub }}>
                {currentDisplay.description}
              </div>
            )}
          </div>
        )}

        {/* Inner card (the big win) */}
        <div
          className="flex-1 min-h-0"
          style={{
            borderRadius: 18,
            border: `1px solid ${theme.border}`,
            background: theme.card,
            boxShadow: "0 20px 60px rgba(0,0,0,0.10)",
            overflow: "hidden",
          }}
        >
          <div className="h-full w-full" style={{ padding: 12 }}>
            {children}
          </div>
        </div>
      </div>
    );
  };

  if (hasMultiItems && (isChoiceType || isShortType)) {
    const multiMode = isChoiceType ? "choice" : "short";
    return (
      <TaskFrame>
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
      </TaskFrame>
    );
  }

  let content = null;

  switch (type) {
    case TASK_TYPES.MOOD_CHECKIN:
    case "mood-checkin": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

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

    case TASK_TYPES.GUESS_WHO:
    case "guess-who": {
      content = (
        <GuessWhoTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
    }

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

    case TASK_TYPES.ROLE_PLAY_DECK:
    case "role-play":
    case "role-play-deck":
    case "roleplay": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

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
        <MultipleChoiceTask
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

    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE:
      content = (
        <PhysicalMultipleChoiceTask
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

    case TASK_TYPES.TRUE_FALSE:
      // In review mode, keep the canonical MultiPart renderer so teachers can see the correct/selected overlay.
      // In play mode, use the dedicated TrueFalseTask for a more polished, deterministic (per-team) UI.
      if (isReview) {
        content = (
          <MultiPartTask
            mode="choice"
            readOnly={isReview}
            task={t}
            review={review}
            onSubmit={null}
            submitting={submitting}
            disabled={true}
          />
        );
      } else {
        content = (
          <TrueFalseTask
            task={t}
            onSubmit={handleTaskSubmit}
            disabled={effectiveDisabled}
            onAnswerChange={onAnswerChange}
            answerDraft={answerDraft}
          />
        );
      }
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

case TASK_TYPES.MULTI_PLAYER_FEEDBACK:
case "multi-player-feedback":
case "multi_player_feedback":
  content = (
    <MultiPlayerFeedbackTask
      roomCode={roomCode}
      teamId={
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null
      }
      teamName={
        t?.teamName ||
        playerTeam?.name ||
        playerTeam?.teamName ||
        null
      }
      socket={socket}
      onSubmit={handleTaskSubmit}
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
      content = (
        <PhotoTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.PHOTO_JOURNAL:
    case "photo-journal":
      content = (
        <PhotoJournalTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
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
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
      content = (
        <DrawMimeTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
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
      content = (
        <BodyBreakTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.OPEN_TEXT:
      content = (
        <OpenTextTask
          task={t}
          onSubmit={handleTaskSubmit}
          // OpenTextTask historically used `answered`; we support both.
          disabled={effectiveDisabled || isReview}
          answered={effectiveDisabled || isReview}
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
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.SPEECH_RECOGNITION:
      content = (
        <SpeechRecognitionTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          roomCode={roomCode}
          teamId={derivedTeamId}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.JEOPARDY:
      content = (
        <BrainBlitzTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;

    case TASK_TYPES.PRONUNCIATION:
      content = (
        <PronunciationTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;

    case TASK_TYPES.WORD_WEAVER_DUEL:
    case "word-weaver-duel": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

      content = (
        <WordWeaverDuelTask
          task={t}
          onSubmit={handleTaskSubmit}
          socket={socketRef}
          roomCode={roomCode}
          teamId={effectiveTeamId}
          memberNames={memberNames}
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
      content = (
        <MusicalChairsTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;

    case TASK_TYPES.MYSTERY_CLUES:
      content = (
        <MysteryCluesTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
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
      content = (
        <MadDashSequenceTask
          task={t}
          onSubmit={handleTaskSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
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
      content = (
        <FlashcardsRaceTask
          task={t}
          onSubmit={handleTaskSubmit}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;

    case TASK_TYPES.TIMELINE:
      content = (
        <TimelineTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.PET_FEEDING:
      content = (
        <PetFeedingTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.MOTION_MISSION:
      content = (
        <MotionMissionTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.BRAINSTORM_BATTLE:
      content = (
        <BrainstormBattleTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.MIND_MAPPER:
      content = (
        <MindMapperTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.SPEED_DRAW:
      content = (
        <SpeedDrawTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} socket={socket} />
      );
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
      content = (
        <BrainSparkNotesTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.HIDENSEEK:
      content = (
        <HideNSeekTask task={t} onSubmit={handleTaskSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.HANGMAN_DUEL:
    case "hangman-duel": {
      const effectiveTeamId =
        t?.teamId ||
        playerTeam?.id ||
        playerTeam?.teamId ||
        playerTeam?.teamID ||
        null;

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

  return <TaskFrame>{content}</TaskFrame>;
}
