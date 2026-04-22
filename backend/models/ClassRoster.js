// backend/models/ClassRoster.js
import mongoose from "mongoose";

const studentEntrySchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    edsbyId: { type: String, default: "" },     // Edsby platform ID (e.g. "24354412")
    studentId: { type: String, default: "" },    // District student ID (e.g. "328400224")
    last4: { type: String, default: "" },        // Last 4 digits of studentId (for quick lookup)
  },
  { _id: false }
);

const classRosterSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, index: true },
    className: { type: String, default: "" },     // e.g. "CED8A" — parsed from filename or header
    sourceFile: { type: String, default: "" },     // original CSV filename
    students: [studentEntrySchema],
  },
  { timestamps: true }
);

const ClassRoster =
  mongoose.models.ClassRoster ||
  mongoose.model("ClassRoster", classRosterSchema);

export default ClassRoster;
