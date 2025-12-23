// student-app/src/components/tasks/DemoTaskHost.jsx
import React from "react";
import { TASK_TYPES } from "../../../shared/taskTypes.js";

// import the SAME task components TaskRunner uses:
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

export default function DemoTaskHost({ task, onSubmit, disabled }) {
  if (!task) return null;

  const type = task.taskType || task.type;

  switch (type) {
    case TASK_TYPES.MOOD_CHECKIN:
    case "mood-checkin":
      return <MoodCheckinTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.TRUE_FALSE:
    case "true-false":
      return <TrueFalseTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.MULTIPLE_CHOICE:
    case "multiple-choice":
      return <MultipleChoiceTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.OPEN_TEXT:
    case "open-text":
      return <OpenTextTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.PHOTO:
    case "photo":
      return <PhotoTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.PHOTO_JOURNAL:
    case "photo-journal":
      return <PhotoJournalTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    case TASK_TYPES.HANGMAN_DUEL:
    case "hangman-duel":
      return <HangmanDuelTask task={task} onSubmit={onSubmit} disabled={disabled} />;

    default:
      return (
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Unsupported task type in demo</div>
          <pre style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>
            {JSON.stringify(task, null, 2)}
          </pre>
        </div>
      );
  }
}
