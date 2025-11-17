// backend/models/Submission.js
import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
    taskIndex: { type: Number, required: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, required: true },
    answer: mongoose.Schema.Types.Mixed,
    isCorrect: { type: Boolean, default: false },
    responseTimeMs: { type: Number, default: null },
  },
  { timestamps: true }
);

// Prevent duplicate submissions from the same team for the same session+task
submissionSchema.index({ session: 1, taskIndex: 1, teamId: 1 }, { unique: true });

export default mongoose.model("Submission", submissionSchema);
