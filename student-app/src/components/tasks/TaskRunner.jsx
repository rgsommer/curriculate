// student-app/src/components/tasks/TaskRunner.jsx
import React, { useMemo, useState, useEffect } from "react";
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
import BrainSparkNotesTask from "./types/BrainSparkNotesTask"; // NEW

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
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

    // Photo / Media
    case "photo":
      return TASK_TYPES.PHOTO;

    case "make-and-snap":
    case "make_and_snap":
      return TASK_TYPES.MAKE_AND_SNAP;

    case "record-audio":
    case "record_audio":
      return TASK_TYPES.RECORD_AUDIO;

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

    default:
      return raw;
  }
}

/* ─────────────────────────────────────────────
   Multi-part renderer for MC / TF / Short Answer
   ───────────────────────────────────────────── */

function MultiPartTask({ mode, task, onSubmit, submitting, disabled }) {
  const isChoice = mode === "choice";
  const isShort = mode === "short";

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
    if (!isChoice) return null;
    return items.map((item) => {
      const base =
        (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
        (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
        (task.taskType === TASK_TYPES.TRUE_FALSE ||
        task.type === TASK_TYPES.TRUE_FALSE
          ? ["True", "False"]
          : []);
      if (!base || base.length === 0) return [];
      return shuffleArray(base);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isChoice, task.taskType, task.type]);

  const [answers, setAnswers] = useState(() =>
    items.map(() => ({
      value: isChoice ? null : "",
    }))
  );

  const handleChoiceClick = (itemIndex, option) => {
    setAnswers((prev) =>
      prev.map((ans, idx) =>
        idx === itemIndex ? { ...ans, value: option } : ans
      )
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
      const answerVal = answers[idx]?.value ?? null;

      // For choice-based items, compute index in ORIGINAL base options,
      // not in the shuffled order.
      let baseIndex = null;
      if (isChoice && answerVal != null) {
        const base =
          (Array.isArray(item.options) && item.options.length > 0 && item.options) ||
          (Array.isArray(item.choices) && item.choices.length > 0 && item.choices) ||
          (task.taskType === TASK_TYPES.TRUE_FALSE ||
          task.type === TASK_TYPES.TRUE_FALSE
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

    onSubmit &&
      onSubmit({
        type: isChoice ? "multi-choice" : "multi-short",
        answers: payload,
      });
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
          }}
        >
          {task.prompt}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, idx) => {
          const label =
            item.label ||
            item.question ||
            item.prompt ||
            item.stem ||
            item.text ||
            item.title ||
            item.description;
          const opts = isChoice ? itemOptions[idx] || [] : [];
          const answerVal = answers[idx]?.value ?? "";

          return (
            <div
              key={item.id ?? idx}
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
              }}
            >
              {label && (
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: "0.95rem",
                    fontWeight: 500,
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
                  {opts.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleChoiceClick(idx, opt)}
                      disabled={submitting || disabled}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 999,
                        border:
                          answerVal === opt
                            ? "2px solid #0ea5e9"
                            : "1px solid #d1d5db",
                        background:
                          answerVal === opt
                            ? "rgba(14,165,233,0.12)"
                            : "#ffffff",
                        textAlign: "left",
                        cursor:
                          submitting || disabled ? "not-allowed" : "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      {opt}
                    </button>
                  ))}
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
                    border: "1px solid " + "#d1d5db",
                    fontSize: "0.9rem",
                    resize: "vertical",
                  }}
                  placeholder="Type your answer…"
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
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
            cursor:
              !allAnswered || submitting || disabled
                ? "not-allowed"
                : "pointer",
          }}
        >
          {submitting
            ? "Sending…"
            : items.length > 1
            ? "Submit all"
            : "Submit"}
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
    const mode = isChoiceType ? "choice" : "short";
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
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-800">
              Look at this station object:
            </div>
            <div className="text-slate-900">
              {currentDisplay.name || currentDisplay.key}
            </div>
            {currentDisplay.description && (
              <div className="mt-1 text-xs text-slate-600">
                {currentDisplay.description}
              </div>
            )}
          </div>
        )}

        <MultiPartTask
          mode={mode}
          task={t}
          onSubmit={onSubmit}
          submitting={submitting}
          disabled={effectiveDisabled}
        />
      </div>
    );
  }

  // Single-part / other task types → your existing components
  let content = null;

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE:
      content = (
        <MultipleChoiceTask
          task={t}
          disabled={effectiveDisabled}
          onSubmit={onSubmit}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;
    case TASK_TYPES.TRUE_FALSE:
      content = (
        <TrueFalseTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;
    case TASK_TYPES.SORT:
      content = (
        <SortTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
      );
      break;
    case TASK_TYPES.SEQUENCE:
      content = (
        <SequenceTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.PHOTO:
      content = (
        <PhotoTask task={t} onSubmit={onSubmit} disabled={effectiveDisabled} />
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
        <DrawMimeTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
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
        <BodyBreakTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
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
    case TASK_TYPES.SHORT_ANSWER:
      content = (
        <ShortAnswerTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          onAnswerChange={onAnswerChange}
          answerDraft={answerDraft}
        />
      );
      break;
    case TASK_TYPES.COLLABORATION:
      content = (
        <CollaborationTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          // drafting + partner flow
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
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.MYSTERY_CLUES:
      content = (
        <MysteryCluesTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    case TASK_TYPES.TRUE_FALSE_TICTACTOE:
      content = (
        <TrueFalseTicTacToeTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          teamRole={t.teamRole}
        />
      );
      break;
    case TASK_TYPES.MAD_DASH:
    case TASK_TYPES.MAD_DASH_SEQUENCE:
      content = (
        <MadDashSequenceTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
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
    case TASK_TYPES.FLASHCARDS:
      content = (
        <FlashcardsTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.FLASHCARDS_RACE:
      return (
        <FlashcardsRaceTask
          socket={socket}
          roomCode={roomCode}
          playerTeam={playerTeam}
        />
      );
    case TASK_TYPES.TIMELINE:
      content = (
        <TimelineTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.PET_FEEDING:
      content = (
        <PetFeedingTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    case TASK_TYPES.MOTION_MISSION:
      content = (
        <MotionMissionTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    case TASK_TYPES.BRAINSTORM_BATTLE:
      content = (
        <BrainstormBattleTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.MIND_MAPPER:
      content = (
        <MindMapperTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;
    case TASK_TYPES.SPEED_DRAW:
      content = (
        <SpeedDrawTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
        />
      );
      break;
    case TASK_TYPES.DIFF_DETECTIVE:
      content = (
        <DiffDetectiveTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
          socket={socket}
          raceStatus={diffRaceStatus}
        />
      );
      break;
    case TASK_TYPES.BRAIN_SPARK_NOTES:
      content = (
        <BrainSparkNotesTask
          task={t}
          onSubmit={onSubmit}
          disabled={effectiveDisabled}
        />
      );
      break;

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
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <div className="font-semibold text-slate-800">
            Look at this station object:
          </div>
          <div className="text-slate-900">
            {currentDisplay.name || currentDisplay.key}
          </div>
          {currentDisplay.description && (
            <div className="mt-1 text-xs text-slate-600">
              {currentDisplay.description}
            </div>
          )}
        </div>
      )}

      {content}
    </div>
  );
}
