// backend/models/Recommendation.js
import mongoose from "mongoose";

const recommendationSchema = new mongoose.Schema(
  {
    recommenderName: { type: String, required: true },
    teacherEmail: { type: String, required: true, index: true },
    message: { type: String, default: "" },
    source: { type: String, default: "ai-grading" }, // which page the recommendation came from
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Recommendation =
  mongoose.models.Recommendation ||
  mongoose.model("Recommendation", recommendationSchema);

export default Recommendation;
