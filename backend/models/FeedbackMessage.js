// backend/models/FeedbackMessage.js
import mongoose from "mongoose";

const FeedbackMessageSchema = new mongoose.Schema(
  {
    anonId: { type: String, default: null, index: true },
    sessionId: { type: String, default: null, index: true },
    message: { type: String, required: true },
    uses: { type: Number, default: 0 },
    meta: { type: Object, default: {} },
  },
  { timestamps: true } // createdAt, updatedAt
);

FeedbackMessageSchema.index({ createdAt: -1 });

export default mongoose.models.FeedbackMessage ||
  mongoose.model("FeedbackMessage", FeedbackMessageSchema);