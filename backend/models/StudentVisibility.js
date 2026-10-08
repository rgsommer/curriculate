// backend/models/StudentVisibility.js
//
// Whether one student's feedback is shown to them and their family at all.
//
// Some parents do not want their child's work put through this, and that is
// theirs to decide. The teacher records it here and every family-facing
// surface honours it: the progress portal, a /results/{code} link, the QR on
// a printed slip, and the notification emails.
//
// Kept per student rather than per class. A parent objecting is objecting on
// behalf of their child, not to one subject, so a child in four of this
// teacher's classes is covered by one decision rather than four.
//
// Nothing is deleted. The results stay exactly as they are, the teacher keeps
// every mark and every comment, and switching it back makes the work visible
// again — the row exists to say "do not show this family", not "destroy it".
import mongoose from "mongoose";

const studentVisibilitySchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, index: true, trim: true },

    // Who turned it off. Scoped so one teacher cannot silence another's
    // results, and so the progress screen can show its own decisions.
    teacherEmail: { type: String, required: true, index: true, lowercase: true, trim: true },

    // Default true: a student nobody has opted out is shown, which is what
    // every existing row is and means no migration.
    showFeedback: { type: Boolean, default: true },

    // Free text for the teacher's own record — "parent asked, 12 Oct".
    note: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true }
);

studentVisibilitySchema.index({ teacherEmail: 1, studentId: 1 }, { unique: true });

const StudentVisibility =
  mongoose.models.StudentVisibility || mongoose.model("StudentVisibility", studentVisibilitySchema);

export default StudentVisibility;
