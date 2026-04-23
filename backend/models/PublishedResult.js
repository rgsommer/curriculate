// models/PublishedResult.js
import mongoose from "mongoose";

const PublishedResultSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // AA123
    payload: { type: mongoose.Schema.Types.Mixed, required: true },     // your feedback object/string
    meta: { type: mongoose.Schema.Types.Mixed },                        // optional (subject, grade, etc.)
    teacherId: { type: String },                                        // optional
    sessionId: { type: String },                                        // optional
    viewCount: { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { minimize: false }
);

// TTL index (Mongo will delete after expiresAt)
PublishedResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Student progress portal lookup
PublishedResultSchema.index({ "meta.studentId": 1, createdAt: -1 });

export default mongoose.models.PublishedResult ||
  mongoose.model("PublishedResult", PublishedResultSchema);
