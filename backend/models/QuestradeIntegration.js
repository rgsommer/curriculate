// backend/models/QuestradeIntegration.js
//
// Per-user Questrade OAuth + account-link storage. One doc per user.
// Read-only integration by design — this model has NO fields for
// order-execution state, no idempotency keys for outbound orders,
// no scratch space for pending POSTs. The API client that reads this
// doc likewise only calls GET endpoints. Order execution stays in
// Questrade's own UI where the broker's confirmation modal, buying-
// power check, and fat-finger guard live.
//
// Refresh-token lifecycle (Questrade rotating-token OAuth):
//   1. User pastes the initial refresh token (seeded from App Hub).
//   2. First POST /oauth2/token?grant_type=refresh_token&refresh_token=…
//      returns { access_token, refresh_token (new!), api_server,
//                expires_in }. We store the NEW refresh token and
//      DISCARD the old one — old-token replay yields 400.
//   3. Every subsequent call:
//      a. If access_token still valid → use it directly.
//      b. If expired → refresh using the stored refresh_token,
//         then rotate again.
//   4. If a refresh call returns 400 "unauthorized" (token expired
//      or revoked), we blank the tokens and flag the integration
//      as `needsReconnect: true`. UI surfaces a "reconnect" button.
//
// Encryption: refresh token is stored as an AES-256-GCM envelope
// (envelopeRefreshToken) using the same STOCKS_INTEGRATION_KEY that
// wraps the CIBC email app password. Plain-text never persists.

import mongoose from "mongoose";

const AccountLinkSchema = new mongoose.Schema({
  // Questrade's account number (returned by GET /v1/accounts). String,
  // usually 8 digits (e.g. "51637123") but not guaranteed all-numeric.
  questradeAccountNumber: { type: String, required: true },
  // Which internal Curriculate account this maps to. Matches the id
  // used in StocksPortfolio.accounts[].id (a1 / a2 / a3 or user-set).
  curriculateAccountId: { type: String, required: true },
  // Questrade's own labels — kept for display sanity when the user
  // opens the account-link mapper. e.g. "TFSA", "Individual Margin".
  questradeType: { type: String, default: "" },
  questradeStatus: { type: String, default: "" },
  // Set false to have the poller skip this account without unmapping it
  // (useful when the user wants to freeze a specific account temporarily).
  enabled: { type: Boolean, default: true },
}, { _id: false });

const QuestradeIntegrationSchema = new mongoose.Schema({
  email: {
    type: String, required: true, lowercase: true, trim: true,
    unique: true, index: true,
  },
  // AES-256-GCM envelope holding the current refresh token. Never
  // exposed to the client — UI only sees a mask + last-updated stamp.
  envelopeRefreshToken: { type: String, default: "" },
  // Access-token cache — refreshed on-demand when expired. Not the
  // source of truth; refresh token is. Kept here to avoid a token
  // roundtrip on every API call within its ~30-min TTL.
  accessToken: { type: String, default: "" },
  // Questrade returns a per-user API base URL (e.g.
  // "https://api07.iq.questrade.com/"). We MUST call that host, not
  // a hardcoded api.questrade.com — hardcoded fails with a 401.
  apiServer: { type: String, default: "" },
  accessTokenExpiresAt: { type: Date, default: null },
  // Account mapping — user picks which Questrade account represents
  // their RRSP vs TFSA vs Non-Spousal in our internal schema. Empty
  // array until they run the connect flow + save the mapping.
  accountLinks: { type: [AccountLinkSchema], default: [] },
  // Master enable — user can pause the poller without disconnecting
  // (keeps the token warm, resumes fast).
  enabled: { type: Boolean, default: true },
  // Set true after a refresh call fails with unauthorized. UI shows
  // "Reconnect" button; the user pastes a fresh seed token to clear
  // it. Rotating-token OAuth means one missed refresh window can end
  // the session permanently.
  needsReconnect: { type: Boolean, default: false },
  // Poll heartbeat & health.
  lastPolledAt: { type: Date, default: null },
  lastPollSucceeded: { type: Boolean, default: null },
  lastPollError: { type: String, default: "" },
  // High-water mark on activity timestamps so the poller doesn't
  // re-scan the entire history every tick. ISO string returned by
  // Questrade's activity feed. Reset to null to force a full re-scan.
  lastActivityTs: { type: String, default: null },
  // Rolling counter — informational, not authoritative.
  reconciledCount: { type: Number, default: 0 },
}, { collection: "questradeIntegrations", timestamps: true });

export default mongoose.models.QuestradeIntegration
  || mongoose.model("QuestradeIntegration", QuestradeIntegrationSchema);
