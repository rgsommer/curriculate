import React from "react";
import { TASK_TYPES } from "../../../../backend/shared/taskTypes.js";
import MultipleChoiceTask from "./types/MultipleChoiceTask";
import TrueFalseTask from "./types/TrueFalseTask";
import ShortAnswerTask from "./types/ShortAnswerTask";
import SortTask from "./types/SortTask";
import SequenceTask from "./types/SequenceTask";
import PhotoTask from "./types/PhotoTask";
import MakeAndSnapTask from "./types/MakeAndSnapTask";
import BodyBreakTask from "./types/BodyBreakTask";

/**
 * Unified runner for all task types.
 *
 * Props:
 *  - task:        the current task object from the server
 *  - onSubmit:    function(answerText: string) => void
 *  - disabled:    boolean – if true, disable interaction & submit
 */
export default function TaskRunner({ task, onSubmit, disabled }) {
  const t = task;
  if (!t) {
    return (
      <div className="p-4 text-center">
        Waiting for next task…
      </div>
    );
  }

  // Support both new and old naming
  const taskType = t.taskType || t.type;

  const commonProps = {
    task: t,
    onSubmit,
    disabled,
  };

  switch (taskType) {
    case TASK_TYPES.MULTIPLE_CHOICE:
      return <MultipleChoiceTask {...commonProps} />;

    case TASK_TYPES.TRUE_FALSE:
      return <TrueFalseTask {...commonProps} />;

    case TASK_TYPES.SORT:
      return <SortTask {...commonProps} />;

    case TASK_TYPES.SEQUENCE:
      return <SequenceTask {...commonProps} />;

    case TASK_TYPES.PHOTO:
      return <PhotoTask {...commonProps} />;

    case TASK_TYPES.MAKE_AND_SNAP:
      return <MakeAndSnapTask {...commonProps} />;

    case TASK_TYPES.BODY_BREAK:
      return <BodyBreakTask {...commonProps} />;

    case TASK_TYPES.SHORT_ANSWER:
    default:
      // Safe fallback – if type is unknown, treat it as short answer
      return <ShortAnswerTask {...commonProps} />;
  }
}
