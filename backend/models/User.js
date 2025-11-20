// models/User.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: String,
    passwordHash: { type: String, required: true },

    // Your subscription fields
    subscriptionTier: {
      type: String,
      enum: ["FREE", "PLUS", "PRO"],
      default: "FREE",
    },
    subscriptionMeta: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

export default User;
