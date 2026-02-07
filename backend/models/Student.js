// backend/models/Student.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Simple roster-style Student model.
 * Does NOT imply login or accounts for students.
 */
const StudentSchema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName:  { type: String, required: true },

    // Teacher that "owns" this roster entry
    teacherId: { type: Schema.Types.ObjectId, ref: "User" },

    // Optional metadata
    gradeLevel: { type: String },
    externalId: { type: String },  // e.g. SIS or spreadsheet ID
  },
  { timestamps: true }
);

// Convenience: full name
StudentSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

const Student = mongoose.model("Student", StudentSchema);
export default Student;
