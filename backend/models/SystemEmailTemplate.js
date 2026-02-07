import mongoose from "mongoose";

const SystemEmailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // share-invite | share-followup-7 | share-followup-30
    label: { type: String, default: "" },

    subject: { type: String, default: "" },
    html: { type: String, default: "" },

    enabled: { type: Boolean, default: true },

    // follow-up control (days after initial invite)
    followupDays: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SystemEmailTemplate", SystemEmailTemplateSchema);
