// backend/models/SubsVoiceNote.js
//
// A short voice clip a teacher records when reporting a sick day, so the
// principal can "hear" that they're genuinely unwell (some principals
// require this — see SubsSchool.requireSickVoiceNote).
//
// The clip is stored base64-encoded in its own collection to keep the
// SubsRequest document small. Clips are short (capped on the client and by
// the upload size limit). For production scale, move the bytes to S3
// (already a backend dependency) and keep just a key here — TODO.

import mongoose from "mongoose";

const SubsVoiceNoteSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsRequest", index: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsSchool", index: true },
    mimeType: { type: String, default: "audio/webm" },
    // Base64 (no data: prefix). Reassembled into a data URL when served.
    dataB64: { type: String, required: true },
    durationSec: { type: Number, default: 0 },
    createdByEmail: { type: String, default: "", lowercase: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.SubsVoiceNote || mongoose.model("SubsVoiceNote", SubsVoiceNoteSchema);
