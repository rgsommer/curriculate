// models/User.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: String,

    // ✅ Allow users created via checkout before password is set
    passwordHash: { type: String, default: null },

    // Stripe / billing
    stripeCustomerId: { type: String, default: null },
    hasUsedTrial: { type: Boolean, default: false },

    // Subscription fields
    subscriptionTier: {
      type: String,
      enum: ["FREE", "PLUS", "PRO"],
      default: "FREE",
    },
    subscriptionMeta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // ✅ Admin & roles (server-truth)
    isAdmin: { type: Boolean, default: false },
    roles: { type: [String], default: [] },

    // Optional compatibility fields (in case older code checks these)
    role: { type: String, default: null },     // e.g. "admin"
    userType: { type: String, default: null }, // e.g. "admin"
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", UserSchema);

export default User;
