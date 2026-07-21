// backend/services/stocksCibcParser.js
//
// Pure parser for CIBC Investor Services trade-confirmation emails.
// No I/O. Fed the plain-text body AND the subject line, returns a
// normalized trade record. Returns null when NEITHER the body nor the
// subject looks like a trade alert (that's the correct behavior for
// stray promo emails or account-statement notifications routed to the
// same inbox by mistake).
//
// Strategy — try body first, subject as fallback:
//
//   1. Body-based parse (original CIBC template):
//        Action     Sold
//        Quantity   367
//        Symbol     DJT (TRUMP MEDIA & TECHNOLOGY)
//        Exchange   NMS
//        Price      $9.5316
//      Definitive currency from the Exchange row.
//
//   2. Subject-line parse (new, more robust — CIBC subjects have
//      always carried the full trade fingerprint):
//        "Bought 35 DUOL @ $127.84"
//        "Sold 120 BBAI @ $2.9506"
//      Currency isn't in the subject, so we return currency=null and
//      let the reconciler infer it (from the user's existing position
//      or a USD default).
//
// The upstream Gmail filter (from:alerts@cibc.com) already proves the
// message is from CIBC. We do NOT run an additional "Trade Alert" body
// guard — that guard used to filter out unrelated CIBC emails, but
// CIBC's template has changed and it was blocking real alerts.

const EXCHANGE_CURRENCY = {
  NMS: "USD", NASDAQ: "USD", NDQ: "USD", NGS: "USD", NAS: "USD",
  NYS: "USD", NYSE: "USD", NYQ: "USD", ARCA: "USD", ARCX: "USD",
  AMEX: "USD", ASE: "USD", BATS: "USD",
  TOR: "CAD", TSX: "CAD", T: "CAD", TSE: "CAD",
  VEN: "CAD", TSXV: "CAD", V: "CAD",
  CSE: "CAD", CNQ: "CAD", NEO: "CAD",
};

const ACTION_MAP = {
  bought: "BUY", buy: "BUY", purchase: "BUY", purchased: "BUY",
  sold: "SELL", sell: "SELL", sale: "SELL",
};

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

function extractLabeledValue(body, labelRe) {
  const line = body.match(new RegExp(labelRe.source + "\\s*[\\t ]{1,}(.+?)\\s*(?:\\n|$)", labelRe.flags));
  return line ? line[1] : null;
}

// Try to parse from the labeled body (the original CIBC template).
function parseFromBody(body) {
  if (typeof body !== "string" || body.length < 20) return null;
  const text = body.replace(/\r\n/g, "\n").replace(/[\t  ]+/g, "\t");

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

  if (!action || !ticker || !qty || !pricePerShare) return null;
  const currency = exchange && EXCHANGE_CURRENCY[exchange]
    ? EXCHANGE_CURRENCY[exchange]
    : "USD";
  return { action, ticker, qty, pricePerShare, currency, exchange };
}

// Try to parse from the subject line alone. CIBC alerts arrive with
// subjects like "Bought 35 DUOL @ $127.84" or "Sold 120 BBAI @ $2.9506".
// Currency is not in the subject; the reconciler fills it in from the
// user's existing position for the ticker (or defaults to USD when
// there's no held reference to use as ground truth).
function parseFromSubject(subject) {
  if (typeof subject !== "string" || subject.length < 8) return null;
  const m = subject.match(/^\s*(bought|sold|buy|sell|purchase|purchased|sale)\s+(\d[\d,]*)\s+([A-Z][A-Z0-9.\-]{0,15})\s*@\s*\$?([\d,.]+)/i);
  if (!m) return null;
  const [, actionRaw, qtyRaw, tickerRaw, priceRaw] = m;
  const action = ACTION_MAP[actionRaw.toLowerCase()] || null;
  const ticker = cleanTicker(tickerRaw);
  const qty = cleanQty(qtyRaw);
  const pricePerShare = cleanPrice(priceRaw);
  if (!action || !ticker || !qty || !pricePerShare) return null;
  return {
    action,
    ticker,
    qty,
    pricePerShare,
    currency: null,
    exchange: null,
  };
}

// Attempt to parse a CIBC alert. Returns:
//   { action, ticker, qty, pricePerShare, currency, exchange }
// currency may be null when only the subject line was parseable —
// caller (the reconciler) must fill it in from position lookup.
export function parseCibcAlert(body, subject = null) {
  const fromBody = parseFromBody(body);
  if (fromBody) return fromBody;
  return parseFromSubject(subject);
}

// Reconciliation key — stable hash of the trade fingerprint so two
// polls of the same message can never double-insert. Includes the
// broker's Date header (minute-truncated) so if you place two DJT
// SELLs at $9.5316 within seconds they still get distinct keys.
export function makeReconcileKey({ email, source, action, ticker, qty, pricePerShare, occurredAtIso }) {
  const minute = String(occurredAtIso || "").slice(0, 16);
  return [source || "cibc-email", email || "?", action, ticker, qty, pricePerShare.toFixed(4), minute].join("|");
}
