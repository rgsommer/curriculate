// backend/models/Submission.js
import mongoose from "mongoose";

const { Schema, models, model } = mongoose;

const SubmissionSchema = new Schema(
  {
    session: {
      type: Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    taskIndex: { type: Number, required: true },   // index into TaskSet.tasks[]
    teamId: {
      type: Schema.Types.ObjectId,                 // _id of Session.teams subdoc
      required: true,
    },
    answer: { type: Schema.Types.Mixed },          // string, number, etc.
    isCorrect: { type: Boolean, default: false },
    responseTimeMs: { type: Number, default: null },
  },
  { timestamps: true }
);

// one submission per team per task per session
SubmissionSchema.index(
  { session: 1, taskIndex: 1, teamId: 1 },
  { unique: true }
);

const Submission = models.Submission || model("Submission", SubmissionSchema);
export default Submission;
