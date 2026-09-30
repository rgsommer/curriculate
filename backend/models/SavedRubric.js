// backend/models/SavedRubric.js
//
// A teacher's rubric library. These lived in localStorage, which meant a
// rubric written on the classroom desktop did not exist on the phone or at
// home — and a rubric is exactly the kind of thing written once and reused for
// a term, so per-device was the wrong home for it.
//
// One document per (teacherEmail, name): saving under a name that already
// exists replaces it, which is what the UI has always done locally.
import mongoose from "mongoose";

const savedRubricSchema = new mongoose.Schema(
  {
    teacherEmail: { type: String, required: true, index: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    text: { type: String, default: "" },
  },
  { timestamps: true }
);

savedRubricSchema.index({ teacherEmail: 1, name: 1 }, { unique: true });

const SavedRubric =
  mongoose.models.SavedRubric || mongoose.model("SavedRubric", savedRubricSchema);

export default SavedRubric;
