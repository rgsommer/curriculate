// backend/models/StocksEmailIntegration.js
//
// Per-user email-inbox integration for broker-alert polling. Stores the
// encrypted app password + polling status. One row per user email.
//
// Design rules:
//   • App password is stored ONLY in encrypted form (envelopePassword);
//     the plaintext never touches this collection or crosses the wire
//     back to the client. UI shows a mask + last-updated timestamp.
//   • Provider is fixed to "gmail" for now — the poller only knows how
//     to talk to Gmail IMAP. Kept as an enum so future providers slot in
//     without a schema migration.
//   • Poller heartbeat fields (lastPolledAt / lastError / lastMessageId)
//     live here rather than on the portfolio so the poller can read/write
//     them without touching the main user doc.

import mongoose from "mongoose";

const StocksEmailIntegrationSchema = new mongoose.Schema(
  {
    // The user account this integration belongs to. Unique — one
    // integration per user (they'd hit the same inbox otherwise).
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    // Fixed to "gmail" today. Enum so we can add "outlook" / "yahoo"
    // etc without a migration.
    provider: {
      type: String,
      enum: ["gmail"],
      default: "gmail",
      required: true,
    },
    // The inbox address the poller reads from. Different from `email`
    // above (which is the user's Curriculate account login). Users
    // typically point their broker alerts to a dedicated address like
    // `rgsommer.junk@gmail.com` so it doesn't mix with personal mail.
    mailboxAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // AES-256-GCM envelope of the app password. See
    // services/stocksEncryption.js — the poller decrypts on read; the
    // client never receives this field.
    envelopePassword: {
      type: String,
      required: true,
      maxlength: 4096,
    },
    // Optional Gmail search filter to narrow what the poller fetches.
    // Default only reads mail from CIBC's alerts address.
    imapSearchQuery: {
      type: String,
      default: "from:alerts@cibc.com is:unread",
      maxlength: 500,
    },
    // IMAP connection endpoint. Defaults are Gmail's official values;
    // exposed so an admin can point at a different endpoint in tests.
    imapHost: { type: String, default: "imap.gmail.com" },
    imapPort: { type: Number, default: 993 },
    imapUseTls: { type: Boolean, default: true },
    // Polling on/off toggle. Off = paused; the poller cron skips this
    // integration entirely without deleting it.
    enabled: { type: Boolean, default: true },
    // Heartbeat + observability.
    lastPolledAt: { type: Date, default: null },
    lastPollSucceeded: { type: Boolean, default: null },
    lastPollError: { type: String, default: "" },
    // The IMAP internal ID of the most recently processed message. Used
    // as a high-water mark so we don't re-scan the whole inbox each
    // tick. Nullable — first poll walks up to the last N days.
    lastProcessedUid: { type: Number, default: null },
    // Rolling counter of successfully-reconciled trades so the Settings
    // UI can show a running total ("42 trades reconciled since setup").
    reconciledCount: { type: Number, default: 0 },
    // Configured-at stamp for the UI ("connected 2026-07-22").
    configuredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.models.StocksEmailIntegration ||
  mongoose.model("StocksEmailIntegration", StocksEmailIntegrationSchema);
