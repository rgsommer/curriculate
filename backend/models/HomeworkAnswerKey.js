// backend/models/HomeworkAnswerKey.js
//
// Answer keys for Homework Check mode. A teacher uploads the answer section of
// a workbook once per book; the extractor splits it into one document per
// lesson so a later batch only has to name its lesson code ("NS7-3") to pick
// up the right key.
//
// Storing per-lesson (rather than one fat book document) means:
//   - lookup by lessonCode is a single index hit,
//   - a teacher can add more lessons later without rewriting the book doc,
//   - a bad extraction can be re-uploaded for one lesson without touching the rest.

import mongoose from "mongoose";

const keyQuestionSchema = new mongoose.Schema(
  {
    // Question label exactly as printed in the book: "1a", "3bc", "10".
    q: { type: String, default: "" },
    // The expected answer, as text. Kept as a string (not parsed into numbers)
    // because JUMP answers include expressions, units, and short explanations.
    answer: { type: String, default: "" },
  },
  { _id: false }
);

const homeworkAnswerKeySchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, index: true },

    // Free-text book label the teacher gives, e.g. "JUMP Math AP Book 7.1".
    // Lets one teacher keep keys for several books side by side.
    bookName: { type: String, default: "", index: true },

    // Lesson code as printed, e.g. "NS7-3". Uppercased on write so lookups
    // are case-insensitive without a collation.
    lessonCode: { type: String, required: true, index: true },

    questions: [keyQuestionSchema],

    // The lesson's Key Idea, in one or two sentences. Used when a student's
    // answer is wrong but the slip isn't identifiable from the answer alone —
    // rather than inventing a diagnosis, the feedback points back at this.
    // Teacher-supplied (or read off the lesson page); never invented.
    keyIdea: { type: String, default: "" },

    // Where this key came from, for auditing a bad extraction.
    sourcePageCount: { type: Number, default: 0 },
    extractionNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// One key per lesson per book per teacher. Re-uploading the same lesson
// replaces it (upsert) rather than silently creating a duplicate that the
// lookup would then pick between arbitrarily.
homeworkAnswerKeySchema.index(
  { teacherEmail: 1, bookName: 1, lessonCode: 1 },
  { unique: true }
);

const HomeworkAnswerKey =
  mongoose.models.HomeworkAnswerKey ||
  mongoose.model("HomeworkAnswerKey", homeworkAnswerKeySchema);

export default HomeworkAnswerKey;
