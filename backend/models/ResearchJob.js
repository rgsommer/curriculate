// backend/models/ResearchJob.js
//
// (B) Research trickle queue. Each job is one "region/network to research".
// The worker picks up ONE pending job per tick (default: nightly) so we
// never blow Anthropic/OpenAI usage caps in a single burst.
//
// Typical lifecycle:
//   pending  → scheduled at a future date (e.g. tomorrow 2am)
//   running  → worker has claimed it
//   done     → finished, contactsAdded populated
//   failed   → errorMessage populated; can be re-queued by setting status back to pending

import mongoose from "mongoose";

const researchJobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },         // e.g. "TDSB schools"
    boardName: { type: String, default: "" },       // tag for resulting contacts
    indexUrl: { type: String, required: true },     // top-level school directory page

    // Tuning
    maxSchools: { type: Number, default: 30 },      // cap per job to keep API cost predictable
    extractRole: { type: String, default: "Principal" }, // primary role to look for

    // Scheduling
    status: {
      type: String,
      enum: ["pending", "running", "done", "failed", "paused"],
      default: "pending",
      index: true,
    },
    scheduledFor: { type: Date, default: Date.now, index: true },
    lastRunAt:    { type: Date, default: null },
    lastError:    { type: String, default: "" },

    // Results
    contactsAdded: { type: Number, default: 0 },
    schoolsAttempted: { type: Number, default: 0 },

    createdBy: { type: String, default: "admin" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

const ResearchJob =
  mongoose.models.ResearchJob ||
  mongoose.model("ResearchJob", researchJobSchema);

export default ResearchJob;
