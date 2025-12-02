// student-app/src/components/tasks/TaskRunner.jsx
import React from "react";
import { TASK_TYPES, TASK_TYPE_META } from "../../../../shared/taskTypes.js";
//import VictoryScreen from "./VictoryScreen.jsx";

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
import TimelineTask from "./types/TimelineTask";
import PetFeedingTask from "./types/PetFeedingTask";
import MotionMissionTask from "./types/MotionMissionTask";
import BrainstormBattleTask from "./types/BrainstormBattleTask";
import MindMapperTask from "./types/MindMapperTask";
import SpeedDrawTask from "./types/SpeedDrawTask";

/**
 * Normalize any legacy / shorthand strings coming from the backend
 * into the canonical TASK_TYPES values.
 */
function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;

  switch (raw) {
    case "mc":
    case "multiple-choice":
      return TASK_TYPES.MULTIPLE_CHOICE;

    case "tf":
    case "true_false":
    case "true-false":
      return TASK_TYPES.TRUE_FALSE;

    case "open":
    case "short":
    case "short-answer":
      return TASK_TYPES.SHORT_ANSWER;

    case "open-text":
    case "open_text":
      return TASK_TYPES.OPEN_TEXT;

    case "sort":
      return TASK_TYPES.SORT;

    case "seq":
    case "sequence":
      return TASK_TYPES.SEQUENCE;

    case "photo":
      return TASK_TYPES.PHOTO;

    case "make-and-snap":
    case "make_snap":
      return TASK_TYPES.MAKE_AND_SNAP;

    case "body-break":
    case "body_break":
      return TASK_TYPES.BODY_BREAK;

    case "record-audio":
    case "record_audio":
      return TASK_TYPES.RECORD_AUDIO;

    // NEW: map raw strings to DRAW and MIME
    case "Draw":
    case "draw":
    case "drawing":
      return TASK_TYPES.DRAW;

    case "mime":
    case "act":
    case "act-out":
      return TASK_TYPES.MIME;

    default:
      // Already canonical, or truly unknown
      return raw;
  }
}

/**
 * Unified runner for all task types.
 *
 * Props:
 *  - task:           the current task object from the server
 *  - onSubmit:       function(answer: any) => void
 *  - disabled:       boolean – if true, disable interaction & submit
 *  - onAnswerChange: (optional) function(draft: any) => void
 *                    used by StudentApp to track live drafts for timeout
 *  - answerDraft:    (optional) current draft value from parent
 *
 * Anchored displays:
 *  The server sends each task with:
 *    - task.displayKey   → string key of the linked display
 *    - task.displays     → array of { key, name, description, stationColor, ... }
 *  (emitted as: { ...task, displays: taskSet.displays })
 */
export default function TaskRunner({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  if (!task) {
    return <div className="p-4 text-center">Waiting for next task…</div>;
  }

  const t = task;
  const type = normalizeTaskType(t.taskType || t.type);
  const meta = TASK_TYPE_META[type];

  // Find the physical display this task is anchored to (if any)
  const currentDisplay =
    Array.isArray(t.displays) && t.displayKey
      ? t.displays.find((d) => d.key === t.displayKey) || null
      : null;

  // If we know about this type but have not implemented it yet,
  // show a clear message instead of silently mis-rendering.
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

  // Common props passed to all concrete task components.
  // onAnswerChange + answerDraft are optional; components may ignore them
  // if they do not support draft tracking.
  const commonProps = {
    task: t,
    onSubmit,
    disabled,
    onAnswerChange,
    answerDraft,
  };

  let content = null;

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <MultipleChoiceTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.TRUE_FALSE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <TrueFalseTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.SORT:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <SortTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.SEQUENCE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <SequenceTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.PHOTO:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <PhotoTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.MAKE_AND_SNAP:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <MakeAndSnapTask {...commonProps} />;
      </div>
      break;

    // DRAW and MIME both use the unified DrawMimeTask UI
    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <DrawMimeTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.BODY_BREAK:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <BodyBreakTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.OPEN_TEXT:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <OpenTextTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.RECORD_AUDIO:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <RecordAudioTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.SHORT_ANSWER:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <ShortAnswerTask {...commonProps} />;
      </div>
      break;

    case TASK_TYPES.COLLABORATION:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = (
        <CollaborationTask
          {...commonProps}
          partnerAnswer={task.partnerAnswer}
          showPartnerReply={!!task.partnerAnswer}
          onPartnerReply={(reply) => onSubmit({ reply })}
        />
        );
        </div>
      break;
      
    case TASK_TYPES.MUSICAL_CHAIRS:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = (
        <MusicalChairsTask
          task={task}
          onSubmit={onSubmit}
          disabled={disabled}
          socket={socket}
        />
      );
      </div>
      break;

    case TASK_TYPES.MYSTERY_CLUES:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <MysteryCluesTask task={task} onSubmit={onSubmit} disabled={disabled} />;
      </div>
      break;

    case TASK_TYPES.TRUE_FALSE_TICTACTOE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = (
        <TrueFalseTicTacToeTask
          task={task}
          onSubmit={onSubmit}
          disabled={disabled}
          socket={socket}
          teamRole={task.teamRole}
        />
      );
      </div>
      break;

    case TASK_TYPES.MAD_DASH_SEQUENCE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = (
        <MadDashSequenceTask
          task={task}
          onSubmit={onSubmit}
          disabled={disabled}
          socket={socket}
        />
        );
      </div>
      break;

    case TASK_TYPES.LIVE_DEBATE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = (
        <LiveDebateTask
          task={task}
          onSubmit={onSubmit}
          disabled={disabled}
          socket={socket}
          teamMembers={task.teamMembers || ["Alice", "Bob", "Charlie", "Dana"]}
        />
        );
      </div>
      break;

    case TASK_TYPES.FLASHCARDS:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <FlashcardsTask task={task} onSubmit={onSubmit} disabled={disabled} socket={socket} />;
      </div>
      break;

    case TASK_TYPES.TIMELINE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <TimelineTask task={task} onSubmit={onSubmit} disabled={disabled} socket={socket} />;
      </div>
      break;

    case TASK_TYPES.PET_FEEDING:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <PetFeedingTask task={task} onSubmit={onSubmit} disabled={disabled} />;
      </div>
      break;

    case TASK_TYPES.MOTION_MISSION:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <MotionMissionTask task={task} onSubmit={onSubmit} disabled={disabled} />;
      </div>
      break;

    case TASK_TYPES.BRAINSTORM_BATTLE:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
      content = <BrainstormBattleTask task={task} onSubmit={onSubmit} disabled={disabled} socket={socket} />;
      </div>
      break;

    case TASK_TYPES.MIND_MAPPER:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <MindMapperTask task={task} onSubmit={onSubmit} disabled={disabled} />;
      </div>
      break;
 
    case TASK_TYPES.SPEED_DRAW:
      <div className="h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden">
        content = <SpeedDrawTask task={task} onSubmit={onSubmit} disabled={disabled} socket={socket} />;
      </div>
      break;

    default:
      // Unknown / typo / not in registry at all
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
      {/* Anchored display banner (only if this task links to a display) */}
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

      {/* Actual task UI */}
      {content}
    </div>
  );
}
