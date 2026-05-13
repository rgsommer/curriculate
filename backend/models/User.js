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

    // Referral attribution — which agent code was used at checkout
    referralCode: { type: String, default: null },

    // Blast-campaign attribution — captured from utm_* params on the landing
    // page that brought this user here. Lets us answer "principal at School X
    // got the email -> teacher Y at School X signed up 3 days later".
    blastUtmContent:  { type: String, default: "" }, // = BlastRecipient._id
    blastUtmCampaign: { type: String, default: "" }, // = product (curriculate/pulse/fieldday)
    blastUtmSource:   { type: String, default: "" }, // = "blast"

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
