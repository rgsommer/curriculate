// backend/models/Submission.js
import mongoose from "mongoose";

const { Schema, models, model } = mongoose;

const SubmissionSchema = new Schema(
  {
    // Link to Session doc if available; optional because some sessions
    // are purely in-memory during the live phase.
    session: {
      type: Schema.Types.ObjectId,
      ref: "Session",
      index: true,
      default: null,
    },
    roomCode: { type: String, index: true },         // room code for lookup
    taskIndex: { type: Number, required: true },      // index into TaskSet.tasks[]
    teamId: { type: String, required: true },         // team socket-room ID
    teamName: { type: String, default: "" },
    playerId: { type: String, default: null },        // individual player if known
    answer: { type: Schema.Types.Mixed },             // student's answer payload
    isCorrect: { type: Boolean, default: null },
    points: { type: Number, default: 0 },             // points earned
    aiScore: { type: Schema.Types.Mixed, default: null }, // AI scoring details
    photoUrl: { type: String, default: null },
    responseTimeMs: { type: Number, default: null },
    submittedAt: { type: Number, default: null },      // epoch ms
  },
  { timestamps: true }
);

// Allow multiple submissions per team per task (retries, mystery box replays)
// but index for fast lookup
SubmissionSchema.index({ roomCode: 1, teamId: 1, taskIndex: 1 });
SubmissionSchema.index({ roomCode: 1, submittedAt: 1 });

const Submission = models.Submission || model("Submission", SubmissionSchema);
export default Submission;
