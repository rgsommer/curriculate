// backend/models/StudentContact.js
//
// Persistent contact record for a Curriculate-linked student. Keyed by
// edsbyId (the only identifier the student-app reliably has when they
// pick themselves from a class roster). Holds the student's email
// address — collected once on first link, reused thereafter for both
// scavenger-hunt performance reports and Pulse Grading submission
// reports.
//
// The same student under multiple teachers shares one StudentContact —
// they only have one email. We track which teachers have seen them so
// admins can answer "which classes is this student in?".

import mongoose from "mongoose";

const TeacherTouchSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true },
    className: { type: String, default: "" },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const StudentContactSchema = new mongoose.Schema(
  {
    edsbyId: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },

    // Canonical contact email. May be blank until the student supplies one.
    email: { type: String, default: "" },
    emailUpdatedAt: { type: Date, default: null },

    // Parent / guardian email — collected at end-of-session via the
    // "Would your parents want to see this result?" prompt. Reused on
    // every subsequent session report so parents stay in the loop.
    parentEmail: { type: String, default: "" },
    parentEmailUpdatedAt: { type: Date, default: null },
    // Track whether the student has explicitly declined the prompt, so we
    // stop pestering them. ("Yes" with email = parentEmail set;
    //                       "No"            = parentEmailDeclined: true)
    parentEmailDeclined: { type: Boolean, default: false },

    // Light audit trail of which teachers/classes this student has been seen in.
    knownTeachers: { type: [TeacherTouchSchema], default: [] },
  },
  { timestamps: true }
);

const StudentContact =
  mongoose.models.StudentContact ||
  mongoose.model("StudentContact", StudentContactSchema);

export default StudentContact;
