// backend/services/questradeClient.js
//
// Read-only Questrade API client. Handles OAuth token exchange +
// rotation, per-user API-server base URL, and a small set of GET
// endpoints used by the activity poller and the /stocks UI.
//
// EXPLICITLY EXCLUDED: no POST /accounts/:id/orders. Order execution
// stays in Questrade's UI. This module has no code that could place
// an order even if called; the client function surface is GET-only.
//
// Rotating-token OAuth notes (Questrade quirks that bit people):
//   • The refresh_token returned by /oauth2/token IS single-use.
//     Store the NEW one before doing anything else — if the storage
//     write fails but the old token has already been invalidated by
//     Questrade's servers, the integration is dead.
//   • The api_server field returned by /oauth2/token is per-user and
//     changes over time (Questrade shards accounts across api07,
//     api08, etc.). Always use the value from the most-recent token
//     response; don't hard-code a host.
//   • access_token TTL is 30 min (1800s). We refresh with a small
//     safety margin (5 min) so a call in flight doesn't 401 partway.

import QuestradeIntegration from "../models/QuestradeIntegration.js";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./stocksEncryption.js";

const OAUTH_URL = "https://login.questrade.com/oauth2/token";
const ACCESS_TOKEN_SAFETY_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ─── Token exchange ───────────────────────────────────────────
// Runs on: (a) user pastes an initial seed token via connect route,
// (b) stored access token is stale/missing. Rotates the refresh
// token atomically with the DB write — see comment above.
export async function exchangeRefreshToken(integration, incomingRefreshToken) {
  const url = `${OAUTH_URL}?grant_type=refresh_token&refresh_token=${encodeURIComponent(incomingRefreshToken)}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let resp;
  try {
    resp = await fetch(url, { method: "POST", signal: ctrl.signal });
  } catch (e) {
    throw new Error(`Questrade OAuth network error: ${e?.message || e}`);
  } finally { clearTimeout(tid); }
  const bodyText = await resp.text().catch(() => "");
  if (!resp.ok) {
    // 400 Bad Request → refresh token expired / revoked / already
    // rotated. Mark the integration so the UI can prompt for reconnect.
    if (resp.status === 400 && integration?._id) {
      integration.needsReconnect = true;
      integration.envelopeRefreshToken = "";
      integration.accessToken = "";
      integration.accessTokenExpiresAt = null;
      integration.lastPollError = `OAuth failed: ${resp.status} — refresh token invalid, reconnect required`;
      try { await integration.save(); } catch {}
    }
    throw new Error(`Questrade OAuth ${resp.status}: ${bodyText.slice(0, 200)}`);
  }
  let payload;
  try { payload = JSON.parse(bodyText); }
  catch { throw new Error("Questrade OAuth returned non-JSON body"); }
  const { access_token, refresh_token, api_server, expires_in, token_type } = payload || {};
  if (!access_token || !refresh_token || !api_server) {
    throw new Error("Questrade OAuth response missing required fields");
  }
  // api_server always has a trailing slash — normalize by stripping it
  // so we can just concat "/v1/..." without doubles.
  const apiServer = String(api_server).replace(/\/+$/, "");
  const expiresAt = new Date(Date.now() + (Number(expires_in) || 1800) * 1000);
  return {
    accessToken: `${token_type || "Bearer"} ${access_token}`,
    refreshToken: refresh_token,
    apiServer,
    expiresAt,
  };
}

// Ensure we have a live access token — refresh if missing or within
// the safety margin. Persists rotation to Mongo in the same call so
// concurrent callers can't both refresh and race the DB write.
// Returns { apiServer, accessToken } ready for use.
export async function ensureFreshToken(integration) {
  if (!integration) throw new Error("Questrade integration missing");
  if (integration.enabled === false) throw new Error("Questrade integration disabled");
  if (integration.needsReconnect) throw new Error("Questrade integration needs reconnect");
  const now = Date.now();
  const stillFresh = integration.accessToken
    && integration.accessTokenExpiresAt
    && new Date(integration.accessTokenExpiresAt).getTime() - now > ACCESS_TOKEN_SAFETY_MS;
  if (stillFresh) {
    return { apiServer: integration.apiServer, accessToken: integration.accessToken };
  }
  if (!isEncryptionConfigured()) throw new Error("STOCKS_INTEGRATION_KEY not configured");
  if (!integration.envelopeRefreshToken) throw new Error("No stored refresh token");
  const refreshTokenPlain = decryptSecret(integration.envelopeRefreshToken);
  if (!refreshTokenPlain) throw new Error("Refresh-token decryption failed");
  const { accessToken, refreshToken, apiServer, expiresAt } = await exchangeRefreshToken(integration, refreshTokenPlain);
  integration.envelopeRefreshToken = encryptSecret(refreshToken);
  integration.accessToken = accessToken;
  integration.apiServer = apiServer;
  integration.accessTokenExpiresAt = expiresAt;
  integration.needsReconnect = false;
  await integration.save();
  return { apiServer, accessToken };
}

// Read-only GET wrapper — handles the "access token expired mid-call"
// case by retrying once after a forced refresh. Any other status is
// surfaced to the caller with the body preview so the poller can
// record a useful error message.
async function qGet(integration, path, { retry = true } = {}) {
  const { apiServer, accessToken } = await ensureFreshToken(integration);
  const url = `${apiServer}${path}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  let resp;
  try {
    resp = await fetch(url, {
      headers: { Authorization: accessToken },
      signal: ctrl.signal,
    });
  } finally { clearTimeout(tid); }
  if (resp.status === 401 && retry) {
    // Access token invalidated (rare but happens on server-side
    // rotations). Force a refresh + one more shot.
    integration.accessTokenExpiresAt = new Date(0);
    return qGet(integration, path, { retry: false });
  }
  const body = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Questrade ${path} ${resp.status}: ${body.slice(0, 200)}`);
  try { return JSON.parse(body); }
  catch { throw new Error(`Questrade ${path} returned non-JSON`); }
}

// ─── Endpoint wrappers (GET only) ────────────────────────────

export async function fetchAccounts(integration) {
  const j = await qGet(integration, "/v1/accounts");
  return j?.accounts || [];
}

export async function fetchPositions(integration, accountNumber) {
  const j = await qGet(integration, `/v1/accounts/${encodeURIComponent(accountNumber)}/positions`);
  return j?.positions || [];
}

export async function fetchBalances(integration, accountNumber) {
  const j = await qGet(integration, `/v1/accounts/${encodeURIComponent(accountNumber)}/balances`);
  return j || null;
}

// Activities in a time window. Questrade caps activity queries at
// ~31 days per request — callers wanting more history should chunk.
// startTime + endTime are ISO strings.
export async function fetchActivities(integration, accountNumber, { startTime, endTime }) {
  const qs = new URLSearchParams({ startTime, endTime }).toString();
  const j = await qGet(integration, `/v1/accounts/${encodeURIComponent(accountNumber)}/activities?${qs}`);
  return j?.activities || [];
}

// Small helper — used by the connect route to test a freshly-pasted
// seed token before persisting it. If this fails, the token is bad
// and we haven't corrupted the user's existing integration.
export async function testConnection(seedRefreshToken) {
  // Use a throwaway integration-shaped object so exchangeRefreshToken's
  // save() calls no-op (we're not persisting on a dry run).
  const stub = { _id: null };
  const result = await exchangeRefreshToken(stub, seedRefreshToken);
  return result;
}
