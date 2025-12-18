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
import SpeechRecognitionTask from "./types/SpeechRecognitionTask"; // NEW
import PronunciationTask from "./types/PronunciationTask"; // NEW
import AIDebateJudgeTask from "./types/AIDebateJudgeTask"; // NEW
import BrainBlitzTask from "./types/BrainBlitzTask";
import PhotoJournalTask from "./types/PhotoJournalTask";
import HangmanDuelTask from "./types/HangmanDuelTask";

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

    // Timeline
    case "timeline":
      return TASK_TYPES.TIMELINE;

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
      return TASK_TYPES.PHOTO_JOURNAL || "photo-journal";

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
      return TASK_TYPES.HANGMAN_DUEL || "hangman-duel";

    default:
      return raw;
  }
}

/* ─────────────────────────────────────────────
   Multi-part renderer for MC / TF / Short Answer
   ───────────────────────────────────────────── */

function MultiPartTask({ mode, task, review, onSubmit, submitting, disabled }) {
  const isChoice = mode === "choice";
  const isShort = mode === "short";
  const isReview = mode === "review";

  // Prefer AI "items" array; fall back to older shapes;
  // if none exist, treat as a single-question pack.
  const rawItems =
    (Array.isArray(task.items) && task.items.length > 0 && task.items) ||
    (Array.isArray(task.questions) &&
      task.questions.length > 0 &&
      task.questions) ||
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

  // Per-item shuffled options; base options always reconstructed in submit.
  const itemOptions = useMemo(() => {
    const taskKey = String(task?._id || task?.id || "task");

    return items.map((item, idx) => {
      const base =
        (Array.isArray(item.options) &&
          item.options.length > 0 &&
          item.options) ||
        (Array.isArray(item.choices) &&
          item.choices.length > 0 &&
          item.choices) ||
        (task.taskType === TASK_TYPES.TRUE_FALSE || task.type === TASK_TYPES.TRUE_FALSE
          ? ["True", "False"]
          : []);

      if (!base || base.length === 0) return [];

      const itemKey = String(item?.id || item?._id || `i${idx}`);
      // ✅ shuffled, but stable for this task+item
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

      // For choice-based items, compute index in ORIGINAL base options,
      // not in the shuffled order.
      let baseIndex = null;
      if (isChoice && answerVal != null) {
        const base =
          (Array.isArray(item.options) &&
            item.options.length > 0 &&
            item.options) ||
          (Array.isArray(item.choices) &&
            item.choices.length > 0 &&
            item.choices) ||
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
          const opts = isChoice ? itemOptions[idx] || [] : [];
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
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 6,
                  }}
                >
                  {opts.map((opt, optIndex) => {
                    const base =
                      (Array.isArray(item.options) &&
                        item.options.length > 0 &&
                        item.options) ||
                      (Array.isArray(item.choices) &&
                        item.choices.length > 0 &&
                        item.choices) ||
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
                          cursor:
                            submitting || disabled ? "not-allowed" : "pointer",
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
  partnerAnswer,
  showPartnerReply,
  onPartnerReply,
}) {
  if (!task) return null;

  const t = task;
  const type = normalizeTaskType(t.taskType || t.type);

  // Hangman expects socket.current; keep existing socket usage for other tasks.
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket || null;
  }, [socket]);

  const isReview = mode === "review";

  const isChoiceType =
    type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.TRUE_FALSE;
  const isShortType = type === TASK_TYPES.SHORT_ANSWER;

  const hasMultiItems =
    (Array.isArray(t.items) && t.items.length > 1) ||
    (Array.isArray(t.questions) && t.questions.length > 1) ||
    (Array.isArray(t.subItems) && t.subItems.length > 1) ||
    (Array.isArray(t.multiQuestions) && t.multiQuestions.length > 1);

  const meta = TASK_TYPE_META[type];
  const [diffRaceStatus, setDiffRaceStatus] = useState(null);

  // Listen for race events from the server when this is a diff-detective task
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
  if (meta?.label) {
    displayTitle = toTitleCase(meta.label);
  } else if (t.title) {
    displayTitle = toTitleCase(t.title);
  } else if (t.taskType && TASK_TYPE_META[t.taskType]?.label) {
    displayTitle = toTitleCase(TASK_TYPE_META[t.taskType].label);
  }

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

  // MULTI-PART: MC / TF / SHORT-ANSWER with items → render all parts together
  if (hasMultiItems && (isChoiceType || isShortType)) {
    const multiMode = isChoiceType ? "choice" : "short";
    const noop = () => {};
          
    return (
      <div className="space-y-3">
        {displayTitle && (
          <div
            className="task-title-fun text-center mb-1"
            style={{
              fontFamily:
                '"Interstellar Log", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: "1.4rem",
              letterSpacing: "1px",
            }}
          >
            {displayTitle}
          </div>
        )}

        {currentDisplay && (
          <div
            className="rounded-lg border px-3 py-2 text-sm"
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

        <MultiPartTask
          mode={isReview ? "review" : multiMode}
          task={t}
          review={review}
          onSubmit={isReview ? noop : onSubmit}
          submitting={submitting}
          disabled={effectiveDisabled || isReview}
        />
      </div>
    );
  }

  // Single-part / other task types → your existing components
  let content = null;

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE:
      content = (
        <MultiPartTask
          mode={isReview ? "review" : "choice"}
          task={t}
          review={isReview ? review : null}
          onSubmit={isReview ? null : onSubmit}
          submitting={submitting}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;

    case TASK_TYPES.TRUE_FALSE:
      content = (
        <MultiPartTask
          mode={isReview ? "review" : "choice"}
          task={t}
          review={isReview ? review : null}
          onSubmit={isReview ? null : onSubmit}
          submitting={submitting}
          disabled={effectiveDisabled || isReview}
        />
      );
      break;
      
    case TASK_TYPES.SORT:
      content = (
        <SortTask
          task={t}
          onSubmit={onSubmit}
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
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          mode={isReview ? "review" : "play"}
          review={isReview ? review : null}
        />
      );
      break;

    case TASK_TYPES.PHOTO:
      content = <PhotoTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />;
      break;

    case TASK_TYPES.PHOTO_JOURNAL || "photo-journal":
      content = (
        <PhotoJournalTask
          task={t}
          onSubmit={onSubmit}
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
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
      content = (
        <DrawMimeTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.DRAW_MIME:
      content = (
        <DrawMimeTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.BODY_BREAK:
      content = (
        <BodyBreakTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.OPEN_TEXT:
      content = (
        <OpenTextTask
          task={t}
          onSubmit={onSubmit}
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
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;

    case TASK_TYPES.SPEECH_RECOGNITION:
      content = (
        <SpeechRecognitionTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.JEOPARDY:
      content = (
        <BrainBlitzTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.PRONUNCIATION:
      content = (
        <PronunciationTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.SHORT_ANSWER:
      content = (
        <ShortAnswerTask
          task={t}
          onSubmit={onSubmit}
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
          onSubmit={onSubmit}
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
        <MusicalChairsTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.MYSTERY_CLUES:
      content = (
        <MysteryCluesTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.TRUE_FALSE_TICTACTOE:
      content = (
        <TrueFalseTicTacToeTask
          task={t}
          onSubmit={onSubmit}
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
        <MadDashSequenceTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.LIVE_DEBATE:
      content = (
        <LiveDebateTask
          task={t}
          onSubmit={onSubmit}
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
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
        />
      );
      break;

    case TASK_TYPES.FLASHCARDS:
      content = (
        <FlashcardsTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.FLASHCARDS_RACE:
      return <FlashcardsRaceTask socket={socket} roomCode={roomCode} playerTeam={playerTeam} />;

    case TASK_TYPES.TIMELINE:
      content = (
        <TimelineTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.PET_FEEDING:
      content = (
        <PetFeedingTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.MOTION_MISSION:
      content = (
        <MotionMissionTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.BRAINSTORM_BATTLE:
      content = (
        <BrainstormBattleTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.MIND_MAPPER:
      content = (
        <MindMapperTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.SPEED_DRAW:
      content = (
        <SpeedDrawTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} socket={socket} />
      );
      break;

    case TASK_TYPES.DIFF_DETECTIVE:
      content = (
        <DiffDetectiveTask
          task={t}
          onSubmit={onSubmit}
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
        <BrainSparkNotesTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case TASK_TYPES.HIDENSEEK:
      content = (
        <HideNSeekTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;

    case (TASK_TYPES.HANGMAN_DUEL || "hangman-duel"): {
      const effectiveTeamId =
        t?.teamId || playerTeam?.id || playerTeam?.teamId || playerTeam?.teamID || null;

      content = (
        <HangmanDuelTask
          task={t}
          onSubmit={onSubmit}
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
          <div className="font-semibold">
            ⚠ Unsupported task type from server.
          </div>
          <div className="text-sm text-red-500">
            Received type: <strong>{String(type)}</strong>
          </div>
        </div>
      );
  }

  return (
    <div className="space-y-3">
      {displayTitle && (
        <div
          className="task-title-fun text-center mb-1"
          style={{
            fontFamily:
              '"Interstellar Log", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: "1.4rem",
            letterSpacing: "1px",
          }}
        >
          {displayTitle}
        </div>
      )}

      {currentDisplay && (
        <div
          className="rounded-lg border px-3 py-2 text-sm"
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

      {content}
    </div>
  );
}
