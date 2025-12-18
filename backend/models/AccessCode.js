import mongoose from "mongoose";

const { Schema } = mongoose;

const AccessCodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    planTier: {
      type: String,
      enum: ["FREE", "PLUS", "PRO"],
      default: "FREE",
    },

    maxSeats: {
      type: Number,
      default: 1,
      min: 1,
    },

    // userIds (stringified ObjectIds) who have claimed this code
    claimants: {
      type: [String],
      default: [],
    },

    disabled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Reuse model if already compiled (important for hot reloads)
const AccessCode =
  mongoose.models.AccessCode ||
  mongoose.model("AccessCode", AccessCodeSchema);

export default AccessCode;
