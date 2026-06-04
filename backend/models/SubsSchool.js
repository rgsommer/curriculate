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
    // School contact details (informational).
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    // School hours — morning session and full day (HH:MM). These give the
    // half-day AM/PM and full-day coverage windows concrete times and feed
    // the morning countdown (dayStart preferred over bellTime).
    hours: {
      morningStart: { type: String, default: "" },
      morningEnd: { type: String, default: "" },
      dayStart: { type: String, default: "" },
      dayEnd: { type: String, default: "" },
    },
    // Emails allowed to administer this school (lowercased).
    adminEmails: { type: [String], default: [], index: true },

    // ── Notification routing on a fill ─────────────────────────────────
    // VP handles lesson plans (default; a grade level may override with its
    // own "appropriate VP"). Finance is notified for budget/payroll. Once a
    // sub accepts, these are emailed automatically — the principal is done.
    // Default VP (name + email + phone). Phone is used for an approval SMS
    // only when the VP is the one who approves (see vpApproval).
    vpEmail: { type: String, default: "", lowercase: true, trim: true },
    vpName: { type: String, default: "", trim: true },
    vpPhone: { type: String, default: "", trim: true },
    financeEmail: { type: String, default: "", lowercase: true, trim: true },
    // Grade-range divisions, each with its own VP (e.g. "JK–Grade 5").
    // A grade level belongs to a division (SubsGradeLevel.division); the
    // division's VP is the "appropriate VP" for that grade.
    divisions: {
      type: [
        {
          name: { type: String, trim: true },
          vpName: { type: String, trim: true },
          vpEmail: { type: String, lowercase: true, trim: true },
          vpPhone: { type: String, trim: true },
        },
      ],
      default: [],
    },
    // Principal/office mobile — used to send a test SMS and to text the
    // admin when a sub is confirmed (optional).
    adminPhone: { type: String, default: "", trim: true },

    // How much approval authority the VP has over teacher-reported
    // absences (principal-controlled):
    //   "none"      → only the principal/admins approve (default)
    //   "sick_only" → VP may approve absences whose reason is "Sick"
    //   "all"       → VP may approve any absence
    vpApproval: { type: String, enum: ["none", "sick_only", "all"], default: "none" },

    // Some principals like to "hear" that a teacher is genuinely sick. When
    // enabled, a sick-day request must include a short voice note, which the
    // principal can play from the approval.
    requireSickVoiceNote: { type: Boolean, default: false },

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
