
import mongoose from "mongoose";

const schema = new mongoose.Schema({
  eventId: { type: String, unique: true },
  type: String,
  created: Number,
  livemode: Boolean,
  processedAt: Date,
});

export default mongoose.model("ProcessedStripeEvent", schema);
