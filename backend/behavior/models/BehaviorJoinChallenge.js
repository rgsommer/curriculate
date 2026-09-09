// backend/behavior/models/BehaviorJoinChallenge.js
//
// Proof that someone asking to join a school can actually RECEIVE mail at the
// address they signed up with.
//
// Signup does not verify email ownership (POST /auth/signup creates the User
// outright), so a matching email domain is a hint, not proof. Without this a
// student could sign up as a real teacher who has not joined yet —
// jsmith@school.org — ask to join, and an admin would see a plausible name in
// the approval list with nothing contradicting it. A code emailed to that
// address closes the gap: the request never reaches an admin until someone
// reading that mailbox enters it.
//
// The code is stored HASHED. A leaked database row must not be usable to
// complete someone else's join.

import mongoose from "mongoose";

const BehaviorJoinChallengeSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    codeHash: { type: String, required: true },
    // Wrong guesses so far. A 6-digit code is only 10^6 wide, so unlimited
    // attempts would be brute-forceable in minutes.
    attempts: { type: Number, default: 0 },
    // Mongo removes the document at this time, so an unused code cannot linger.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

// One live challenge per user per school; requesting again replaces it.
BehaviorJoinChallengeSchema.index({ schoolId: 1, userId: 1 }, { unique: true });

export default mongoose.models.BehaviorJoinChallenge ||
  mongoose.model("BehaviorJoinChallenge", BehaviorJoinChallengeSchema);
