// student-app/src/components/tasks/DemoTaskHost.jsx
import React from "react";
import { TASK_TYPES } from "../../../shared/taskTypes.js";

// import the SAME task components TaskRunner uses:
import MoodCheckinTask from "./MoodCheckinTask.jsx";
import TrueFalseTask from "./TrueFalseTask.jsx";
import MultipleChoiceTask from "./MultipleChoiceTask.jsx";
import OpenTextTask from "./OpenTextTask.jsx";
import PhotoTask from "./PhotoTask.jsx";
import PhotoJournalTask from "./PhotoJournalTask.jsx";
import HangmanDuelTask from "./HangmanDuelTask.jsx";
// ...etc: add all task components you support

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
