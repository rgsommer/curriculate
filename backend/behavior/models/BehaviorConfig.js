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
    },

    // ── Branding / identity (§5c) ───────────────────────────────────────────
    branding: {
      schoolName: { type: String, default: "" },
      signatureBlock: { type: String, default: "" }, // division-level default signature
      toneGuidance: { type: String, default: "" }, // fed to the AI note composer
    },

    // ── Notification channels (§4) ──────────────────────────────────────────
    // School default/preference; a teacher may override per notice. A notice is
    // delivered on every enabled channel.
    channels: {
      email: { type: Boolean, default: true },
      edsby: { type: Boolean, default: false },
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
  },
  { timestamps: true }
);

export default mongoose.models.BehaviorConfig || mongoose.model("BehaviorConfig", BehaviorConfigSchema);
