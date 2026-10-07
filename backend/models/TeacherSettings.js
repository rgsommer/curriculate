// backend/models/TeacherSettings.js
//
// Per-teacher preferences that affect what students and parents see.
// Keyed by teacherEmail, the same identity the rosters, rubrics, published
// results and homework batches use.
import mongoose from "mongoose";

const teacherSettingsSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },

    // Hide the numeric mark from students and parents, everywhere they can
    // see it: the progress portal and the /results/{code} page a QR or a link
    // leads to. Feedback, next steps and the level bars all stay.
    //
    // The teacher keeps seeing every mark — the results table, the exports,
    // the Edsby posting are all unaffected. The point is that the mark Pulse
    // suggests is not always the mark awarded: a teacher may give 7 where
    // Pulse said 6, and the family sees the 6 and is alarmed by a number that
    // was never the grade. The gradebook is the record; this stops a draft
    // competing with it.
    hideGradesFromStudents: { type: Boolean, default: false },

    // Email students and parents when a new result is published for them.
    //
    // On by default — a family that never hears is a family that never looks.
    // But a teacher on a free sending tier has a daily cap, and one batch of
    // thirty papers can spend most of it, so a teacher who releases work in
    // bulk needs to be able to turn it off without losing the portal. With it
    // off nothing is withheld: the results, the codes and the progress pages
    // all work exactly as before, and families read them when they visit.
    notifyStudentsOnNewResult: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const TeacherSettings =
  mongoose.models.TeacherSettings || mongoose.model("TeacherSettings", teacherSettingsSchema);

export default TeacherSettings;
