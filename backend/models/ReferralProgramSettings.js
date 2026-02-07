import mongoose from "mongoose";

// Single-row settings doc (keyed by a constant) so Admin can tune the program.
const ReferralProgramSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // "default"
    enabled: { type: Boolean, default: true },
    threshold: { type: Number, default: 5 }, // number of distinct successful shares required
    rewardMonths: { type: Number, default: 1 }, // informational (billing credit wiring can come later)
  },
  { timestamps: true }
);

export default mongoose.model(
  "ReferralProgramSettings",
  ReferralProgramSettingsSchema
);
