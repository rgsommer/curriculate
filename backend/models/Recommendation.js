// backend/models/Recommendation.js
import mongoose from "mongoose";

const recommendationSchema = new mongoose.Schema(
  {
    recommenderName: { type: String, required: true },
    recommenderEmail: { type: String, default: "", index: true }, // for referral credit tracking
    teacherName: { type: String, default: "" },
    teacherEmail: { type: String, required: true, index: true },
    message: { type: String, default: "" },
    source: { type: String, default: "prism" }, // which page the recommendation came from
    sentAt: { type: Date, default: Date.now },
    // Referral credit tracking
    creditMonths: { type: Number, default: 1 }, // months earned for this referral
    creditApplied: { type: Boolean, default: false }, // whether credit has been redeemed
  },
  { timestamps: true }
);

const Recommendation =
  mongoose.models.Recommendation ||
  mongoose.model("Recommendation", recommendationSchema);

export default Recommendation;
