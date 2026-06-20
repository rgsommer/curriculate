// backend/behavior/models/BehaviorConfig.js
//
// The single shared division configuration per school (brief §5b/§5c, §6).
// Editable only by originator/admin; treated as a division agreement. One
// document per school.

import mongoose from "mongoose";

const BehaviorConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "BehaviorSchool", required: true, unique: true, index: true },

    // ── Division thresholds (§5b) ───────────────────────────────────────────
    triggerCount: { type: Number, default: 3 }, // THRESHOLD incidents that fire a notice
    fadeWindowDays: { type: Number, default: 30 }, // older incidents stop counting

    // ── VP / CC rule (§5b, §7) ──────────────────────────────────────────────
    vp: {
      name: { type: String, default: "" },
      email: { type: String, default: "", lowercase: true, trim: true },
      phone: { type: String, default: "" },
      // The VP's Edsby id, so the CC reaches them over Edsby (not email) under
      // the Edsby-only delivery policy.
      edsbyId: { type: String, default: "", trim: true },
    },

    // ── Branding / identity (§5c) ───────────────────────────────────────────
    branding: {
      schoolName: { type: String, default: "" },
      signatureBlock: { type: String, default: "" }, // division-level default signature
      toneGuidance: { type: String, default: "" }, // fed to the AI note composer
    },

    // ── Notification channels (§4) ──────────────────────────────────────────
    // How notices reach PARENTS/VP. Edsby is the safe default. Emailing families
    // is gated behind `emailToParents`, which is OFF unless an admin deliberately
    // turns it on — so AI-written notes are never emailed to a parent by accident
    // (and a per-notice override can't enable it). `email` is the legacy flag and
    // is no longer used for delivery; `emailToParents` supersedes it.
    channels: {
      email: { type: Boolean, default: false }, // legacy — not used for delivery
      edsby: { type: Boolean, default: true },
      emailToParents: { type: Boolean, default: false }, // explicit admin opt-in to email families
    },

    // ── Edsby connection (§4, Phase 3) ──────────────────────────────────────
    // Authenticated cookie/session posting — no public Edsby API. The admin
    // pastes their Edsby session cookie; we store it ENCRYPTED (never plaintext,
    // never sent to the client) and post to each parent's edsbyParentId.
    edsby: {
      enabled: { type: Boolean, default: false },
      baseUrl: { type: String, default: "" }, // e.g. https://yourschool.edsby.com
      cookieEnc: { type: String, default: "" }, // session cookie, AES-256-GCM
      formkeyEnc: { type: String, default: "" }, // CSRF token (short-lived), encrypted
      // Non-secret bundle/account identifiers (from a logged-in Edsby page's
      // openSesame call + your user nid). jver/cver change each Edsby release.
      userNid: { type: String, default: "" }, // your Edsby user/teacher nid
      jver: { type: String, default: "" },
      cver: { type: String, default: "" },
      zoomId: { type: String, default: "" }, // a class/zoom id, used to refresh formkey
      // Bearer token a browser script includes to PUSH fresh creds (cookie etc.)
      // into the app without a login — see POST /edsby/ingest. Revocable.
      ingestToken: { type: String, default: "" },
      // One-shot session slot for an honour-roll run: the Cookie Sync extension
      // can push a cookie here (oneShot:true) instead of into the persistent
      // cookieEnc. The /avgs run uses it, and it auto-expires + is cleared after
      // the run — so the (often admin) session isn't left warm on the server.
      runCookieEnc: { type: String, default: "" },
      runCookieExpiresAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },

    // ── AI note send behaviour (§8) ─────────────────────────────────────────
    // "auto"  → compose + send automatically on trigger (this school's choice).
    // "draft" → compose, hold for one-tap teacher send (toggle for later).
    aiSendMode: { type: String, enum: ["auto", "draft"], default: "auto" },
    // Cancellable window (seconds) after an auto notice is queued, during which
    // a teacher can cancel before it dispatches. 0 = send immediately.
    cancelWindowSeconds: { type: Number, default: 60 },
    // Provider + model are configurable, never hardcoded (§8). Key lives in
    // server-side env only — never in this document.
    aiProvider: { type: String, default: "openai" }, // "openai" | "anthropic"
    aiModel: { type: String, default: "gpt-4o-mini" },

    // ── Notices-home counter reset mode (§6) ────────────────────────────────
    // Drives the CC-VP rule. Division default: start of year.
    noticesResetMode: { type: String, enum: ["year", "fade", "term"], default: "year" },
    termStartDates: { type: [Date], default: [] }, // required only when mode = "term"

    // Repeat-escalation scope for the per-behaviour consequence doubling (§5a).
    // Defaults to the same window as the strike count.
    repeatScopeDays: { type: Number, default: 30 },

    // ── Morning reminders + school calendar (§8b) ──────────────────────────
    // Local HH:MM the daily follow-up digest is sent. Division-wide.
    reminderTime: { type: String, default: "07:30" },
    // Admin-specified non-school days (YYYY-MM-DD) on top of weekends + Ontario
    // statutory holidays — PA days, March break, etc. Used for "next school day".
    manualNonSchoolDays: { type: [String], default: [] },

    // ── Houses (opt-in) ─────────────────────────────────────────────────────
    // Master switch for the whole House aspect (leaderboard, point values,
    // assignment, report). Off by default; when off, all house UI is hidden.
    housesEnabled: { type: Boolean, default: false },

    // 4-digit code students enter at /houses to see this school's standings
    // (so the public portal isn't openly browseable). Blank = portal disabled.
    housePortalCode: { type: String, default: "" },

    // Start-of-term marker: only house points earned AFTER this date count toward
    // the standings (earlier events are kept for history). Null = count all.
    housePointsResetAt: { type: Date, default: null },

    // ── House points report (opt-in) ───────────────────────────────────────
    // A standings email with each house's total + its top-3 contributing
    // students. Off by default; admins enable + send it from Setup.
    houseReport: {
      enabled: { type: Boolean, default: false },
      recipientEmail: { type: String, default: "", lowercase: true, trim: true },
    },

    // ── Homework tab ────────────────────────────────────────────────────────
    homework: {
      // Subject list shown in the assignment form; teachers may append to it.
      subjects: { type: [String], default: ["Math", "History", "Geography", "CE"] },
      // Term start dates (up to 3). Used to bucket assignments into terms and to
      // decide which outstanding work to surface (current + previous term only).
      termStarts: { type: [Date], default: [] },
      // Which term we're in: 0 = Term 1, 1 = Term 2, 2 = Term 3.
      currentTerm: { type: Number, default: 0 },
      // Work older than this many weeks gets the 6.2 partial tap (do-half rule).
      lateWeeks: { type: Number, default: 3 },
      // Don't re-send a whole-class "fallen behind" message within this many days.
      messageCooldownDays: { type: Number, default: 7 },
    },
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorConfig || mongoose.model("BehaviorConfig", BehaviorConfigSchema);
