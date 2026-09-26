// backend/models/HomeworkCheckBatch.js
//
// One document per photographed homework batch: the teacher walks the room
// shooting each student's workbook page(s), uploads the set, and this is what
// comes back out. Kept under the class so a student's homework history across
// the term is a single indexed query.
//
// Deliberately stores BOTH scores separately (completeness and correctness)
// and never a merged number — they answer different questions and merging them
// would hide a student who did all the work but misunderstood the lesson.

import mongoose from "mongoose";

// Per-question outcome for one student. Two independent axes:
//   work    — did the student write anything (completeness)
//   correct — does it match the supplied key (correctness)
// `correct` stays null when there's no key on file or the work wasn't attempted.
const questionResultSchema = new mongoose.Schema(
  {
    q: { type: String, default: "" },
    work: {
      type: String,
      enum: ["attempted", "not_attempted", "unreadable", "sample"],
      default: "not_attempted",
    },
    correct: {
      type: String,
      enum: ["correct", "incorrect", "no_key", null],
      default: null,
    },
    // Why it was unreadable, or what the student wrote when it's wrong.
    // TEACHER-FACING ONLY — never shown in the student portal.
    note: { type: String, default: "" },

    // STUDENT-FACING formative line for this question. Written to the student,
    // second person, next-step oriented, two sentences max. Empty for
    // questions the student got right (nothing to act on) and for anything
    // flagged unreadable (that goes to the teacher only).
    studentNote: { type: String, default: "" },

    // Whether this question was actually set. "bonus" leaves the completeness
    // denominator — work nobody was asked to do is not work left undone —
    // while "unclear" is counted as core, so an ambiguous page errs towards
    // asking rather than quietly excusing.
    scope: { type: String, enum: ["core", "bonus", "unclear"], default: "unclear" },
  },
  { _id: false }
);

const studentResultSchema = new mongoose.Schema(
  {
    // Roster identity. studentName is the ROSTER name once matched — never the
    // model's guess at the handwriting (that lives in nameAsWritten).
    studentName: { type: String, default: "" },
    studentId: { type: String, default: "" },
    edsbyId: { type: String, default: "" },

    // What the handwriting actually looked like, kept so the teacher can see
    // why a match failed.
    nameAsWritten: { type: String, default: "" },
    matched: { type: Boolean, default: false },
    matchConfidence: { type: String, enum: ["high", "medium", "low", "none"], default: "none" },

    // A roster student with no page anywhere in the batch. Reported loudly —
    // silently dropping a student is the worst failure mode for this tool.
    noPageFound: { type: Boolean, default: false },

    // Two separate marks, each out of 10. correctness is null with no key.
    completeness: { type: Number, default: null },
    correctness: { type: Number, default: null },

    // Raw tallies behind the marks, so the teacher can see the arithmetic.
    attemptedCount: { type: Number, default: 0 },
    assignedCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    keyedAttemptedCount: { type: Number, default: 0 },

    questions: [questionResultSchema],

    // Loose-paper mode: answers the student wrote whose question number could
    // not be matched to the assignment page. Reported rather than guessed at —
    // attaching an answer to the wrong question is worse than saying "check this".
    unmatchedAnswers: [
      {
        _id: false,
        labelAsWritten: { type: String, default: "" },
        answerAsWritten: { type: String, default: "" },
        note: { type: String, default: "" },
      },
    ],

    // Which uploaded photos (0-based, in upload order) belong to this student.
    photoIndexes: [{ type: Number }],

    // One earned, specific encouraging line per check — names something the
    // student actually did well on this piece of work. Never generic praise,
    // never a comparison to anyone else. Student-facing.
    encouragement: { type: String, default: "" },

    // Per-student notes surfaced above the table. TEACHER-FACING ONLY.
    flags: [{ type: String }],

    // Set when the model produced a page it could not attach to any roster
    // student — the teacher assigns it by hand.
    unmatched: { type: Boolean, default: false },

    error: { type: String, default: "" },
  },
  { _id: false }
);

// What the app read off the 1-3 photos of the textbook page being assigned.
// This is supplied BEFORE the capture lap and is what labels the batch.
const assignmentPageSchema = new mongoose.Schema(
  {
    pageLabel: { type: String, default: "" },   // "p. 142" / "Unit 3 Review"
    questions: [
      {
        _id: false,
        number: { type: String, default: "" },  // "7"
        text: { type: String, default: "" },    // the printed question, for loose-paper matching
        parts: [{ type: String }],              // ["a","b","c"] when the question has parts
      },
    ],
    // Whether this assignment has discrete checkable answers at all. Extended
    // writing can't be correctness-checked against a key — we say so and point
    // at the rubric grading mode instead of inventing a score.
    workType: {
      type: String,
      enum: ["discrete", "extended_writing", "mixed", "unknown"],
      default: "unknown",
    },
    workTypeReason: { type: String, default: "" },
    subjectGuess: { type: String, default: "" },
  },
  { _id: false }
);

const homeworkCheckBatchSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, index: true },

    // Class identity. className is denormalised so history lists don't need a
    // join, rosterId keeps the link for re-matching later.
    className: { type: String, default: "", index: true },
    rosterId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassRoster", default: null },

    // What was checked.
    // What the teacher called this assignment. With the assignment page now
    // optional, the lesson code may be the only other label a batch carries —
    // and "NS7-3" is not what a teacher recognises their own homework by.
    assignmentName: { type: String, default: "" },
    // What the teacher said was set, in their own words. Applied per question
    // by the model against what is printed on the page.
    assignmentScope: { type: String, default: "" },
    lessonCode: { type: String, default: "", index: true },
    bookName: { type: String, default: "" },
    batchDate: { type: Date, default: Date.now, index: true },

    // The assignment page(s) the teacher photographed before the capture lap.
    assignment: { type: assignmentPageSchema, default: () => ({}) },

    // How the teacher narrowed the page down to what was actually set.
    subsetMode: {
      type: String,
      enum: ["all", "odds", "evens", "custom"],
      default: "all",
    },
    // The question list actually assigned, both raw and parsed.
    assignedQuestionsRaw: { type: String, default: "" },
    assignedQuestions: [{ type: String }],

    // Where the student wrote: in the printed book, or on loose paper/notebook
    // where the answers carry hand-written question numbers and no questions.
    workSurface: {
      type: String,
      enum: ["workbook", "loose"],
      default: "workbook",
    },

    photoCount: { type: Number, default: 0 },

    // Whether an answer key was in play. Most textbooks print odd answers only,
    // so coverage is usually partial — uncovered questions are excluded from
    // correctness, never counted wrong.
    hasAnswerKey: { type: Boolean, default: false },
    keyCoverage: {
      covered: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      uncovered: [{ type: String }],
    },
    // Set false when there is nothing to compare against (no key, or extended
    // writing). correctness stays null everywhere and the reason is shown.
    correctnessAvailable: { type: Boolean, default: false },
    correctnessSkippedReason: { type: String, default: "" },

    results: [studentResultSchema],

    // Batch-level flags shown above the table.
    unmatchedPhotoIndexes: [{ type: Number }],
    missingStudents: [{ type: String }],
    unreadableCount: { type: Number, default: 0 },

    // ── Teacher release gate ────────────────────────────────────────────
    // NOTHING reaches the student portal automatically. A batch lands here for
    // the teacher to review — check the flags, fix a mis-grouping or a misread
    // — and only a deliberate Release makes it visible at /progress.
    released: { type: Boolean, default: false, index: true },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: String, default: "" },

    // Separate, later toggle: whether the correct answers themselves are shown.
    // Held back by default so the portal is somewhere to try the question again
    // rather than somewhere to copy the answer.
    answersReleased: { type: Boolean, default: false },
    answersReleasedAt: { type: Date, default: null },

    // Housekeeping.
    model: { type: String, default: "" },
    responseTimeMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// History view: "this class, newest first".
homeworkCheckBatchSchema.index({ teacherEmail: 1, className: 1, batchDate: -1 });

const HomeworkCheckBatch =
  mongoose.models.HomeworkCheckBatch ||
  mongoose.model("HomeworkCheckBatch", homeworkCheckBatchSchema);

export default HomeworkCheckBatch;
