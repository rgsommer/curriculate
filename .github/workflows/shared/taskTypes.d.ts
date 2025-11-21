// shared/taskTypes.d.ts

export interface TaskTypeMeta {
  label: string;
  implemented: boolean;
  category: "analytical" | "creative" | "physical" | "input" | "other";
}

export const TASK_TYPES: {
  MULTIPLE_CHOICE: "multiple-choice";
  TRUE_FALSE: "true-false";
  SHORT_ANSWER: "short-answer";
  OPEN_TEXT: "open-text";
  SORT: "sort";
  SEQUENCE: "sequence";
  PHOTO: "photo";
  MAKE_AND_SNAP: "make-and-snap";
  BODY_BREAK: "body-break";
  RECORD_AUDIO: "record-audio";
  DRAW: "draw";
  MIME: "mime";
  SCAVENGER: "scavenger";
  HIDE_AND_DRAW: "hide-and-draw";
  QR_SCAN_ONLY: "qr-scan-only";
};

export type TaskTypeValue = (typeof TASK_TYPES)[keyof typeof TASK_TYPES];

export const TASK_TYPE_META: Record<TaskTypeValue, TaskTypeMeta>;

export const TASK_TYPE_LABELS: Record<TaskTypeValue, string>;

export const IMPLEMENTED_TASK_TYPES: TaskTypeValue[];

export const PLANNED_TASK_TYPES: TaskTypeValue[];

export interface TaskTypeOption {
  value: TaskTypeValue;
  label: string;
}

export const IMPLEMENTED_TASK_TYPE_OPTIONS: TaskTypeOption[];

export const ALL_TASK_TYPE_OPTIONS: TaskTypeOption[];

export const TASK_TYPE_GROUPS: {
  ANALYTICAL: TaskTypeValue[];
  CREATIVE: TaskTypeValue[];
  PHYSICAL: TaskTypeValue[];
  INPUT: TaskTypeValue[];
  OTHER: TaskTypeValue[];
};
