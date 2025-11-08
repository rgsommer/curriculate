// backend/models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    name: String,
    role: { type: String, enum: ["teacher", "admin"], default: "teacher" },
    plan: {
      tier: { type: String, enum: ["free", "pro", "school"], default: "free" },
      // you can use these to enforce limits
      taskLimitPerMonth: { type: Number, default: 1 },
      questionLimitPerSet: { type: Number, default: 10 },
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
