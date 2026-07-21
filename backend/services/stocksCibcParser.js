// backend/services/stocksCibcParser.js
//
// Pure parser for CIBC Investor Services trade-confirmation email bodies.
// No I/O; feed it the plain-text email body and it returns a normalized
// trade record. Returns null when the body doesn't look like a trade
// alert (which is the correct behavior for stray promo emails or
// account-statement notifications routed to the same inbox by mistake).
//
// Example CIBC alert body (from real alerts@cibc.com messages):
//
//   You have just received a Trade Alert from CIBC Investor Services Inc.
//
//   Details:
//
//   Action     Sold
//   Quantity   367
//   Symbol     DJT (TRUMP MEDIA & TECHNOLOGY)
//   Exchange   NMS
//   Price      $9.5316
//
//   Thank you for using CIBC Investor Services Inc.
//
// The whitespace between label and value can be spaces or tabs; both
// occur in practice depending on which mail client rendered the HTML
// alternative.

// Exchange codes seen on CIBC alerts and their trading currencies.
// Anything not in this map defaults to USD (safer for parsing US-listed
// names; TSX names are almost always tagged TOR or T).
const EXCHANGE_CURRENCY = {
  NMS: "USD", NASDAQ: "USD", NDQ: "USD", NGS: "USD", NAS: "USD",
  NYS: "USD", NYSE: "USD", NYQ: "USD", ARCA: "USD", ARCX: "USD",
  AMEX: "USD", ASE: "USD", BATS: "USD",
  TOR: "CAD", TSX: "CAD", T: "CAD", TSE: "CAD",
  VEN: "CAD", TSXV: "CAD", V: "CAD",
  CSE: "CAD", CNQ: "CAD", NEO: "CAD",
};

// Action words CIBC uses. Normalized to BUY/SELL — TRIMs and partial
// SELLs still show as "Sold" in the alert; that's fine, the poller
// downstream doesn't distinguish partial from full SELL legs.
const ACTION_MAP = {
  bought: "BUY", buy: "BUY", purchase: "BUY", purchased: "BUY",
  sold: "SELL", sell: "SELL", sale: "SELL",
};

// Strip a trailing period, comma, or "(company name)" tail from a
// symbol capture, and uppercase the result. Handles both raw "DJT" and
// "DJT (TRUMP MEDIA & TECHNOLOGY)" formats.
function cleanTicker(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^([A-Z][A-Z0-9.\-]{0,15})\b/i);
  if (!m) return null;
  return m[1].toUpperCase().replace(/\.+$/, "");
}

function cleanPrice(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanQty(raw) {
  if (raw == null) return null;
  const n = parseInt(String(raw).replace(/[,]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Value after a label. Tolerant of both "Label\t\tValue" (tab-separated
// as CIBC often sends it) and "Label     Value" (multi-space). The
// per-label anchor prevents cross-line bleed even when the body is one
// long soft-wrapped line.
function extractLabeledValue(body, labelRe) {
  const line = body.match(new RegExp(labelRe.source + "\\s*[\\t ]{1,}(.+?)\\s*(?:\\n|$)", labelRe.flags));
  return line ? line[1] : null;
}

// Attempt to parse a CIBC alert body. Returns:
//   { action: "BUY"|"SELL", ticker, qty, pricePerShare, currency, exchange }
// or null when the body doesn't look like a trade alert.
export function parseCibcAlert(body) {
  if (typeof body !== "string" || body.length < 20) return null;
  // Cheap guard so we don't run the full parser on unrelated emails.
  if (!/Trade Alert.*CIBC/i.test(body) && !/CIBC Investor Services/i.test(body)) {
    return null;
  }
  // Normalize whitespace: collapse CRLF, tabs → single-tab.
  const text = body.replace(/\r\n/g, "\n").replace(/[\t  ]+/g, "\t");

  const actionRaw = extractLabeledValue(text, /^Action/im);
  const qtyRaw = extractLabeledValue(text, /^Quantity/im);
  const symbolRaw = extractLabeledValue(text, /^Symbol/im);
  const exchangeRaw = extractLabeledValue(text, /^Exchange/im);
  const priceRaw = extractLabeledValue(text, /^Price/im);

  const actionKey = actionRaw ? String(actionRaw).trim().toLowerCase() : "";
  const action = ACTION_MAP[actionKey] || null;
  const ticker = cleanTicker(symbolRaw);
  const qty = cleanQty(qtyRaw);
  const pricePerShare = cleanPrice(priceRaw);
  const exchange = exchangeRaw ? String(exchangeRaw).trim().toUpperCase() : null;
  const currency = exchange && EXCHANGE_CURRENCY[exchange]
    ? EXCHANGE_CURRENCY[exchange]
    : "USD";

  if (!action || !ticker || !qty || !pricePerShare) return null;
  return { action, ticker, qty, pricePerShare, currency, exchange };
}

// Reconciliation key — stable hash of the trade fingerprint so two
// polls of the same message can never double-insert. Includes the
// broker's Date header (minute-truncated) so if you place two DJT
// SELLs at $9.5316 within seconds — which does happen with staggered
// executions — they still get distinct keys.
export function makeReconcileKey({ email, source, action, ticker, qty, pricePerShare, occurredAtIso }) {
  const minute = String(occurredAtIso || "").slice(0, 16); // YYYY-MM-DDTHH:MM
  return [source || "cibc-email", email || "?", action, ticker, qty, pricePerShare.toFixed(4), minute].join("|");
}
