// backend/models/SubsOffer.js
//
// A single offer of a sub request to one teacher. The escalation engine
// creates one pending offer at a time per request; when it expires (no
// response within the request's interval) or is declined, the engine
// creates the next offer for the next-ranked teacher.
//
// `token` is an unguessable string embedded in the accept/decline links
// sent by email/SMS, so a teacher can respond straight from the message
// without signing in. Accept/decline is also available from the teacher
// dashboard for signed-in teachers.
//
// Status:
//   pending  → sent, awaiting a response (until expiresAt)
//   accepted → teacher took the job (request becomes filled)
//   declined → teacher said no (engine escalates immediately)
//   expired  → no response in time, or superseded once filled

import mongoose from "mongoose";

const SubsOfferSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsRequest", required: true, index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "SubsTeacher", required: true, index: true },
    rank: { type: Number, required: true },

    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired"],
      default: "pending",
      index: true,
    },
    // Unguessable token for the email/SMS accept-decline links.
    token: { type: String, required: true, index: true },

    sentAt: { type: Date, default: null },
    // When a pending offer stops waiting and the engine escalates.
    expiresAt: { type: Date, default: null, index: true },
    respondedAt: { type: Date, default: null },

    // Channels the engine actually dispatched on (for the audit trail).
    channels: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.models.SubsOffer || mongoose.model("SubsOffer", SubsOfferSchema);
