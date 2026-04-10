import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Public applications to become a Curriculate referral agent/promoter.
 * Separate collection from prospective teachers (ProspectiveTeacher).
 * Admin reviews and can approve → creates a ReferralCode for the applicant.
 */
const ReferralApplicationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },

    // Optional context from the applicant
    organization: { type: String, default: "", trim: true },
    message: { type: String, default: "", trim: true },

    // Admin workflow
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },

    // Populated when admin approves and creates a ReferralCode
    referralCodeId: { type: Schema.Types.ObjectId, ref: "ReferralCode", default: null },
    approvedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    adminNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

ReferralApplicationSchema.index({ email: 1 });
ReferralApplicationSchema.index({ status: 1, createdAt: -1 });

const ReferralApplication =
  mongoose.models.ReferralApplication ||
  mongoose.model("ReferralApplication", ReferralApplicationSchema);

export default ReferralApplication;
