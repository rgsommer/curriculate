// models/SubscriptionPlan.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const subscriptionPlanSchema = new Schema(
  {
    name: {
      type: String,
      enum: ["FREE", "TEACHER_PLUS", "SCHOOL"],
      unique: true,
      required: true,
    },
    monthlyPriceCents: { type: Number, default: 0 },
    features: {
      maxAiGenerationsPerMonth: { type: Number, default: 5 },
      canSaveTasksets: { type: Boolean, default: false },
      canEditGeneratedTasksets: { type: Boolean, default: false },
      canAccessSharedLibrary: { type: Boolean, default: false },
      allowedCurriculumLenses: [{ type: String }],
      hasAnalyticsDashboard: { type: Boolean, default: false },
      canViewTasksetAnalytics: { type: Boolean, default: false },
      canEmailReports: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

const SubscriptionPlan = mongoose.model(
  "SubscriptionPlan",
  subscriptionPlanSchema
);

export default SubscriptionPlan;
