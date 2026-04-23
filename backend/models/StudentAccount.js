// backend/models/StudentAccount.js
import mongoose from "mongoose";

const studentAccountSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true }, // full district student ID
    last4: { type: String, index: true },        // last 4 digits for quick lookup
    passwordHash: { type: String, default: "" },   // optional, kept for backward compat
    emails: [{ type: String }],                   // all associated emails (student + parents)
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    edsbyId: { type: String, default: "" },
    teacherEmail: { type: String, default: "" },  // which teacher's roster
    className: { type: String, default: "" },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    parentLoginCount: { type: Number, default: 0 },
    lastParentLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const StudentAccount =
  mongoose.models.StudentAccount ||
  mongoose.model("StudentAccount", studentAccountSchema);

export default StudentAccount;
