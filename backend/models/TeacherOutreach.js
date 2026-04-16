// backend/models/TeacherOutreach.js
import mongoose from "mongoose";

const teacherOutreachSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    teacherName: { type: String, default: "" },
    school: { type: String, default: "" },
    // Track every email sent
    emails: [
      {
        template: { type: String, required: true },
        subject: String,
        sentAt: { type: Date, default: Date.now },
        customBody: { type: String, default: "" },
      },
    ],
    lastContactedAt: { type: Date, default: null },
    source: { type: String, default: "grade-review" }, // how we got this teacher's email
  },
  { timestamps: true }
);

// Compound index for quick lookups
teacherOutreachSchema.index({ email: 1 }, { unique: true });

const TeacherOutreach =
  mongoose.models.TeacherOutreach ||
  mongoose.model("TeacherOutreach", teacherOutreachSchema);

export default TeacherOutreach;
