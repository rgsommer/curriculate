// backend/models/SubsTeacher.js
//
// A substitute teacher. Identified by email (their sign-in identity). A
// teacher exists independently of any one school — schools reference the
// same teacher in their per-grade preference rankings.
//
// `contactPrefs` controls which channels the escalation engine uses when
// it sends an offer: SMS, email, or both. SMS requires a phone number.

import mongoose from "mongoose";

const SubsTeacherSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    contactPrefs: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
    // Inactive teachers are skipped by the escalation engine even if they
    // still appear in a school's ranking.
    active: { type: Boolean, default: true },

    // ── Matching profile (challenges #1, #5, #10) ──────────────────────
    // What this sub is certified/comfortable to do. Requests filter on
    // these as HARD requirements (see services/subsMatching.js).
    qualifications: { type: [String], default: [] }, // e.g. "French", "HS Math", "Chemistry", "SpEd"
    roleTypes: { type: [String], default: ["teacher"] }, // teacher | ea | specialist | tech
    gradeComfort: { type: [String], default: [] }, // grade names the sub is comfortable with

    // ── Faith / mission fit (challenge #11; self-declared) ─────────────
    faithFit: {
      statementOfFaith: { type: Boolean, default: false },
      prayer: { type: Boolean, default: false }, // comfortable leading prayer/devotions
      christianEd: { type: Boolean, default: false }, // understands Christian education
      values: { type: Boolean, default: false }, // shares school values
    },

    // ── Proximity / availability (challenge #3; scaffold) ──────────────
    location: { address: String, lat: Number, lng: Number },
    maxTravelKm: { type: Number, default: null },
    preferredSchoolIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    availability: { note: { type: String, default: "" }, daysOfWeek: { type: [Number], default: [] } },

    // ── Multi-school registration (cross-school offers) ────────────────
    // Schools this sub is registered with. Set when an admin invites them;
    // lets one sub serve several schools and see all their registrations.
    schoolIds: { type: [mongoose.Schema.Types.ObjectId], default: [], index: true },

    // ── Budget (challenge #7; scaffold) ────────────────────────────────
    dayRate: { type: Number, default: null },

    // ── Reliability / quality (challenge #9; aggregates) ───────────────
    reliability: {
      acceptanceRate: { type: Number, default: null }, // 0..1
      cancellationRate: { type: Number, default: null },
      onTimeRate: { type: Number, default: null },
      adminRating: { type: Number, default: null }, // avg 1..5
      ratingCount: { type: Number, default: 0 },
      tags: { type: [String], default: [] }, // e.g. "great with junior high"
    },
  },
  { timestamps: true }
);

export default mongoose.models.SubsTeacher || mongoose.model("SubsTeacher", SubsTeacherSchema);
