// backend/models/SubsSchool.js
//
// A school portal in the substitute-teacher staffing app (/subs).
//
// `adminEmails` is the access-control list: any signed-in email on this
// list may manage the school's grade levels, sub rankings, and requests.
// Emails are stored lowercased so membership checks are case-insensitive.

import mongoose from "mongoose";

const SubsSchoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Short code used in offer notifications, e.g. "BCS" → "BCS: teach Gr5…".
    abbrev: { type: String, default: "", trim: true },
    // Free-form location label shown on the admin dashboard.
    location: { type: String, default: "", trim: true },
    // Geocoded coordinates for proximity ranking (challenge #3; scaffold).
    geo: { lat: Number, lng: Number },
    // Default bell time (HH:MM) used for the morning "time-to-bell"
    // countdown when a request doesn't specify its own start time.
    bellTime: { type: String, default: "08:30" },
    // Emails allowed to administer this school (lowercased).
    adminEmails: { type: [String], default: [], index: true },

    // ── Notification routing on a fill ─────────────────────────────────
    // VP handles lesson plans (default; a grade level may override with its
    // own "appropriate VP"). Finance is notified for budget/payroll. Once a
    // sub accepts, these are emailed automatically — the principal is done.
    vpEmail: { type: String, default: "", lowercase: true, trim: true },
    financeEmail: { type: String, default: "", lowercase: true, trim: true },

    // How much approval authority the VP has over teacher-reported
    // absences (principal-controlled):
    //   "none"      → only the principal/admins approve (default)
    //   "sick_only" → VP may approve absences whose reason is "Sick"
    //   "all"       → VP may approve any absence
    vpApproval: { type: String, enum: ["none", "sick_only", "all"], default: "none" },

    // Reusable link the principal broadcasts to all staff. Clicking it
    // (while signed in) connects the teacher to this school's staff roster.
    staffJoinToken: { type: String, default: "", index: true },

    // ── Faith / mission fit config (challenge #11) ─────────────────────
    // When disabled (default), faith-fit attributes are hidden and never
    // required — so non-faith schools can ignore the feature entirely.
    faithFit: { enabled: { type: Boolean, default: false } },

    // ── Budget (challenge #7; scaffold) ────────────────────────────────
    subBudget: { total: { type: Number, default: null }, period: { type: String, default: "year" } },
  },
  { timestamps: true }
);

export default mongoose.models.SubsSchool || mongoose.model("SubsSchool", SubsSchoolSchema);
