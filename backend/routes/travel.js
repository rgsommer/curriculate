// backend/routes/travel.js
//
// Flight search for the public curriculate.net/travel tool.
//
// No dedicated flight API — this uses the Anthropic Messages API with the
// `web_search` tool (same pattern as the /stocks advisor) to find current
// fares across the web and return them as structured JSON. Booking links are
// built deterministically on the server from the IATA codes the model
// resolves, so they always point at a real, price-sorted search page.
//
// Config (backend .env):
//   ANTHROPIC_API_KEY                 (required — shared with /stocks)
//   TRAVEL_SEARCH_MODEL               (optional; default "claude-sonnet-4-6")
//
// No auth required — this is a public tool. Fares price 1 adult only and are
// best-effort estimates from web search, confirmed on the booking site.

import express from "express";

const router = express.Router();

const SEARCH_MODEL = process.env.TRAVEL_SEARCH_MODEL || "claude-sonnet-4-6";
const MAX_SEARCHES = 6;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// Strip Anthropic web_search citation markers from model text.
function stripCiteTags(s) {
  if (!s || typeof s !== "string") return s;
  return s.replace(/<cite[^>]*>/g, "").replace(/<\/cite>/g, "").trim();
}

// Pull the first valid JSON object out of model text (handles code fences and
// surrounding prose).
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function kayakLink({ originCode, destinationCode, departureDate, returnDate }) {
  const path = returnDate
    ? `${originCode}-${destinationCode}/${departureDate}/${returnDate}`
    : `${originCode}-${destinationCode}/${departureDate}`;
  return `https://www.kayak.com/flights/${path}?sort=price_a`;
}

function googleFlightsLink({ originCode, destinationCode, departureDate, returnDate }) {
  const q = returnDate
    ? `Flights from ${originCode} to ${destinationCode} on ${departureDate} returning ${returnDate}`
    : `One-way flights from ${originCode} to ${destinationCode} on ${departureDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// USD-based FX rates, cached ~6h. Deterministic safety net so an offer that
// comes back in the wrong currency (e.g. a USD Google Flights figure the model
// forgot to convert) gets converted server-side rather than mislabeled.
let fxCache = { rates: null, fetchedAt: 0 };
async function getUsdRates() {
  if (fxCache.rates && Date.now() - fxCache.fetchedAt < 6 * 3600 * 1000) return fxCache.rates;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl.signal });
    const j = await r.json();
    if (j && j.result === "success" && j.rates && j.rates.USD) {
      fxCache = { rates: j.rates, fetchedAt: Date.now() };
      return j.rates;
    }
    throw new Error("bad FX response");
  } finally {
    clearTimeout(tid);
  }
}
// Convert via USD cross-rate. Returns null if either currency is unknown.
function convertAmount(amount, from, to, rates) {
  if (from === to) return amount;
  const rf = rates[from], rt = rates[to];
  if (!rf || !rt) return null;
  return (amount / rf) * rt;
}

// --------------------------------------------------------------------------
// POST /api/travel/search
//   Body: {
//     origin: "Toronto" | "YYZ",   destination: "London" | "LHR",
//     includeNearbyOrigin: bool,   includeNearbyDestination: bool,  // within 100km
//     departureDate: "2026-06-01",
//     returnDate: "2026-06-10" | null,                              // null => one-way
//     flexDays: 0 | 1 | 2,                                          // ± window
//     maxStops: 0 | 1 | 2,                                          // 2 => "2+"
//     prioritizeShortStops: bool,
//     currency: "CAD"
//   }
// --------------------------------------------------------------------------
router.post("/search", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Flight search is not configured on the server (missing ANTHROPIC_API_KEY)." });
  }

  const b = req.body || {};
  const origin = String(b.origin || "").trim();
  const destination = String(b.destination || "").trim();
  const departureDate = String(b.departureDate || "").trim();
  const returnDate = b.returnDate ? String(b.returnDate).trim() : null;
  // Per-date flexibility: arrays of day offsets in [-2,2] relative to the
  // chosen date (e.g. [-2,-1,0] = "up to 2 days earlier", [-1,0,1] = "±1 day").
  const parseOffsets = (arr) => {
    const xs = (Array.isArray(arr) ? arr : [0])
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n >= -2 && n <= 2);
    const uniq = [...new Set(xs.length ? xs : [0])];
    return uniq.sort((a, c) => a - c);
  };
  const departureOffsets = parseOffsets(b.departureOffsets);
  const returnOffsets = parseOffsets(b.returnOffsets);
  const maxStops = [0, 1, 2].includes(b.maxStops) ? b.maxStops : 2;
  const prioritizeShortStops = !!b.prioritizeShortStops;
  const currency = /^[A-Za-z]{3}$/.test(b.currency || "") ? String(b.currency).toUpperCase() : "USD";
  const includeNearbyOrigin = !!b.includeNearbyOrigin;
  const includeNearbyDestination = !!b.includeNearbyDestination;
  const adults = Math.min(9, Math.max(1, parseInt(b.adults, 10) || 1));
  const includeCarRental = !!b.includeCarRental;
  // Arrival-time preference per leg: "early" | "late" | "any".
  const timePref = (v) => (["early", "late"].includes(v) ? v : "any");
  const outboundTimePref = timePref(b.outboundTimePref);
  const returnTimePref = timePref(b.returnTimePref);

  if (!origin || !destination) {
    return res.status(400).json({ error: "Both a departure and destination are required." });
  }
  if (!isValidDate(departureDate)) {
    return res.status(400).json({ error: "A valid departure date (YYYY-MM-DD) is required." });
  }
  if (returnDate && !isValidDate(returnDate)) {
    return res.status(400).json({ error: "Return date is invalid." });
  }
  if (returnDate && new Date(returnDate) < new Date(departureDate)) {
    return res.status(400).json({ error: "Return date cannot be before departure date." });
  }

  // Expand the flexibility offsets into concrete candidate dates for the prompt.
  const depDates = [...new Set(departureOffsets.map((o) => shiftDate(departureDate, o)).filter(Boolean))].sort();
  const retDates = returnDate
    ? [...new Set(returnOffsets.map((o) => shiftDate(returnDate, o)).filter(Boolean))].sort()
    : [];
  const stopsRule =
    maxStops === 0 ? "Only non-stop (direct) flights. Discard anything with a connection."
    : maxStops === 1 ? "At most 1 stop in each direction. Discard anything with 2+ stops."
    : "Up to 2 stops in each direction is fine.";

  const sortRule = prioritizeShortStops
    ? "Rank results by FEWEST and SHORTEST layovers first, then by price."
    : "Rank results by LOWEST total price first.";

  // Per-leg date guidance. The ± flex widens the set of acceptable target dates.
  // Outbound = an ARRIVAL-at-destination target ("be at the destination by …");
  // the flight may depart the prior day. Return = a DEPARTURE-from-destination
  // target ("leave the destination by …").
  const capPhrase = (p) =>
    p === "early" ? "EARLY (by the morning)" : p === "late" ? "by the END of the day (evening)" : null;

  const outboundLine = (() => {
    const dates = depDates.length > 1 ? `one of these target dates: ${depDates.join(", ")}` : departureDate;
    if (outboundTimePref === "any") {
      return `- Outbound: the traveller must BE AT the destination on ${dates} — arriving any time that day is fine, and an overnight flight that departs ${origin} the day before and lands that day counts. Arriving earlier is acceptable; do not arrive after that date.`;
    }
    const cap = capPhrase(outboundTimePref);
    return `- Outbound: the traveller must BE AT the destination, AT THE LATEST, ${cap} on ${dates}. This is an ARRIVAL target — the flight may depart ${origin} the day before${outboundTimePref === "early" ? "; a red-eye that lands that morning, or arriving the evening before, is ideal" : ""}. Arriving earlier is fine; do NOT include options that arrive later than that cap on the target date.`;
  })();

  const returnLine = !returnDate ? "" : (() => {
    const dates = retDates.length > 1 ? `one of these target dates: ${retDates.join(", ")}` : returnDate;
    if (returnTimePref === "any") {
      return `- Return: the traveller leaves the destination on ${dates} — departing any time that day is fine.`;
    }
    const floor = returnTimePref === "early" ? "EARLY (the morning)" : "LATE (the evening)";
    return `- Return: the traveller will LEAVE the destination, AT THE EARLIEST, ${floor} on ${dates}. This is the EARLIEST acceptable departure FROM the destination (so the trip isn't cut short): acceptable return flights depart at or after ${floor} on the target date. Do NOT include options that leave the destination earlier than that; leaving later that day is fine.`;
  })();

  const prompt = `You are a flight-search assistant. Use the web_search tool to find REAL, CURRENT flight options and prices, then return them as strict JSON.

TRIP
- From: ${origin}${includeNearbyOrigin ? " (also consider other airports within ~100km of this city)" : ""}
- To: ${destination}${includeNearbyDestination ? " (also consider other airports within ~100km of this city)" : ""}
- Trip type: ${returnDate ? "Round trip (return)" : "One-way"}
${outboundLine}
${returnLine}
- Passengers: ${adults} adult${adults === 1 ? "" : "s"}, travelling together.
- Currency: report EVERY price in ${currency}. Many sources (especially Google Flights) quote USD or another currency. You MUST convert the amount to ${currency} using today's exchange rate — web_search "1 USD to ${currency}" (or the source's currency to ${currency}) to get the current rate and do the math. NEVER relabel a USD/other figure as ${currency} without actually converting it. Set every offer's "currency" field to "${currency}".

CONSTRAINTS
- ${stopsRule}
- ${sortRule}
- A return flight must depart on or after the outbound arrives.
- "price" MUST be the PER-PERSON all-in fare (taxes & fees included), in ${currency}.
${adults > 1 ? `- The party is ${adults} adults. If ${adults} seats are not all available at this fare, set "seatWarning" to a short note (e.g. "only 4 seats at this price; remaining seats ~$X more") and base "price" on the best fare the whole party can actually book.` : ""}
${includeCarRental ? `- ALSO look up cheap rental cars at the destination (${destination}) for these dates. Set the top-level "carRental" object with a short note on the cheapest deal found (provider + approx per-day price). Keep it brief; it's a nudge, not a full quote.` : ""}

SEARCH INSTRUCTIONS
- Make several web_search calls (e.g. Google Flights, Skyscanner, Kayak, airline sites) to find genuinely current fares.
- Resolve the 3-letter IATA airport codes you actually used for each option (e.g. Toronto -> YYZ, London Heathrow -> LHR).
- Do NOT invent prices. If you cannot verify a fare, omit that option.
- For EACH option set departureDate/returnDate to the ACTUAL flight departure date(s), and set the arrival date+time fields to when each leg lands. On an overnight flight the departure date is the day before the arrival date — that's expected.
- Return 4-8 of the best options.

OUTPUT — respond with ONLY this JSON (no prose, no markdown fences):
{
  "originResolved": "Toronto (YYZ)",
  "destinationResolved": "London (LHR)",
  "summary": "one or two sentences of useful context (cheapest found, best value, etc.)",
${includeCarRental ? `  "carRental": { "note": "e.g. Economy from ~$22/day with Enterprise at LHR" },` : ""}
  "offers": [
    {
      "airline": "Air Canada",            // or comma-separated if multiple carriers
      "originCode": "YYZ",                 // IATA used for this option
      "destinationCode": "LHR",            // IATA used for this option
      "departureDate": "${departureDate}", // ACTUAL outbound flight departure date (may be the day before the arrival target)
      ${returnDate ? `"returnDate": "${returnDate}",  // ACTUAL return flight departure date` : `"returnDate": null,`}
      "price": 845,                         // PER-PERSON all-in fare (taxes+fees), in ${currency}
      "currency": "${currency}",
      "outboundStops": 0,                   // stops on the way there
      "returnStops": ${returnDate ? "0" : "null"},
      "outboundDuration": "7h 35m",
      "returnDuration": ${returnDate ? "\"8h 10m\"" : "null"},
      "outboundArriveDate": "${departureDate}", // local DATE the outbound LANDS at destination (YYYY-MM-DD)
      "outboundArriveTime": "19:05",        // local time the outbound LANDS at destination, 24h "HH:MM"
      ${returnDate ? `"returnDepartTime": "16:20",          // local time the return LEAVES the destination, 24h "HH:MM"` : `"returnDepartTime": null,`}
      "returnArriveDate": ${returnDate ? `"${returnDate}"` : "null"}, // local DATE the return lands back home
      "returnArriveTime": ${returnDate ? "\"21:40\"" : "null"},
      "stopsDetail": "Non-stop" ,           // human label e.g. "1 stop via Reykjavik (KEF), 2h layover"
      ${adults > 1 ? `"seatWarning": null,                  // string if the full party can't be seated at this fare, else null` : ""}
      "notes": "short note, optional"
    }
  ]
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        max_tokens: 4096,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      throw new Error(`Search provider error ${r.status}: ${errBody.slice(0, 200)}`);
    }
    const j = await r.json();

    const textOut = stripCiteTags(
      (j?.content || [])
        .filter((blk) => blk.type === "text")
        .map((blk) => blk.text)
        .join("\n")
    );

    // Collect web_search citations as sources.
    const sources = [];
    for (const blk of j?.content || []) {
      if (blk.type === "text" && Array.isArray(blk.citations)) {
        for (const c of blk.citations) {
          if (c?.url && !sources.find((s) => s.url === c.url)) {
            sources.push({ title: c.title || c.url, url: c.url });
          }
        }
      }
    }

    const parsed = extractJson(textOut);
    if (!parsed || !Array.isArray(parsed.offers)) {
      return res.status(502).json({ error: "The search didn't return any structured results. Try again or adjust your search." });
    }

    const isIata = (c) => typeof c === "string" && /^[A-Za-z]{3}$/.test(c);
    const offers = parsed.offers
      .filter((o) => o && Number.isFinite(Number(o.price)))
      .map((o) => {
        const originCode = isIata(o.originCode) ? o.originCode.toUpperCase() : null;
        const destinationCode = isIata(o.destinationCode) ? o.destinationCode.toUpperCase() : null;
        const dep = isValidDate(o.departureDate) ? o.departureDate : departureDate;
        const ret = o.returnDate && isValidDate(o.returnDate) ? o.returnDate : (returnDate || null);
        const linkArgs = { originCode, destinationCode, departureDate: dep, returnDate: ret };
        return {
          airline: stripCiteTags(String(o.airline || "")) || "Multiple carriers",
          originCode,
          destinationCode,
          departureDate: dep,
          returnDate: ret,
          price: Number(o.price),
          currency: /^[A-Za-z]{3}$/.test(o.currency || "") ? String(o.currency).toUpperCase() : currency,
          outboundStops: Number.isFinite(Number(o.outboundStops)) ? Number(o.outboundStops) : null,
          returnStops: Number.isFinite(Number(o.returnStops)) ? Number(o.returnStops) : null,
          outboundDuration: o.outboundDuration ? stripCiteTags(String(o.outboundDuration)) : null,
          returnDuration: o.returnDuration ? stripCiteTags(String(o.returnDuration)) : null,
          outboundArriveDate: isValidDate(o.outboundArriveDate) ? o.outboundArriveDate : null,
          outboundArriveTime: /^\d{1,2}:\d{2}$/.test(o.outboundArriveTime || "") ? o.outboundArriveTime : null,
          returnDepartTime: /^\d{1,2}:\d{2}$/.test(o.returnDepartTime || "") ? o.returnDepartTime : null,
          returnArriveDate: isValidDate(o.returnArriveDate) ? o.returnArriveDate : null,
          returnArriveTime: /^\d{1,2}:\d{2}$/.test(o.returnArriveTime || "") ? o.returnArriveTime : null,
          stopsDetail: o.stopsDetail ? stripCiteTags(String(o.stopsDetail)) : null,
          seatWarning: o.seatWarning ? stripCiteTags(String(o.seatWarning)) : null,
          notes: o.notes ? stripCiteTags(String(o.notes)) : null,
          bookingUrl: originCode && destinationCode ? kayakLink(linkArgs) : null,
          altBookingUrl: originCode && destinationCode ? googleFlightsLink(linkArgs) : null,
        };
      });

    // FX safety net: convert any offer whose currency isn't the requested one
    // (the model occasionally returns a raw USD figure). Re-sort by price after
    // converting so "cheapest first" stays correct, unless the user opted to
    // rank by layovers (in which case we preserve the model's ordering).
    if (offers.some((o) => o.currency && o.currency !== currency)) {
      try {
        const rates = await getUsdRates();
        for (const o of offers) {
          if (o.currency && o.currency !== currency) {
            const conv = convertAmount(o.price, o.currency, currency, rates);
            if (conv != null) {
              o.price = Math.round(conv);
              o.currency = currency;
              o.converted = true;
            }
          }
        }
        if (!prioritizeShortStops) offers.sort((a, c) => a.price - c.price);
      } catch {
        // FX unavailable — leave the model's values as-is (it was instructed to
        // convert; this net only catches misses).
      }
    }

    // Optional car-rental nudge: keep the AI's note, build a deterministic
    // Kayak Cars deep link from the destination code + trip dates.
    let carRental = null;
    if (includeCarRental && parsed.carRental && parsed.carRental.note) {
      const destCode = offers.find((o) => o.destinationCode)?.destinationCode;
      const pickup = departureDate;
      const dropoff = returnDate || shiftDate(departureDate, 7);
      carRental = {
        note: stripCiteTags(String(parsed.carRental.note)).slice(0, 300),
        bookingUrl: destCode ? `https://www.kayak.com/cars/${destCode}/${pickup}/${dropoff}?sort=price_a` : null,
      };
    }

    res.json({
      currency,
      adults,
      originResolved: stripCiteTags(String(parsed.originResolved || origin)),
      destinationResolved: stripCiteTags(String(parsed.destinationResolved || destination)),
      summary: parsed.summary ? stripCiteTags(String(parsed.summary)) : "",
      carRental,
      count: offers.length,
      offers,
      sources,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Flight search failed." });
  }
});

// --------------------------------------------------------------------------
// POST /api/travel/email — email a set of results to one recipient.
//   Body: { to, originResolved, destinationResolved, summary, currency, offers }
// --------------------------------------------------------------------------
function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Lightweight in-memory per-IP rate limit so the public endpoint can't be used
// as a spam relay (5 sends / 10 min).
const emailHits = new Map();
function emailRateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (emailHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 5) return true;
  hits.push(now);
  emailHits.set(ip, hits);
  return false;
}

router.post("/email", async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "Email is not configured on the server (missing RESEND_API_KEY)." });
  }
  const b = req.body || {};
  const to = String(b.to || "").trim();
  if (!isValidEmail(to)) return res.status(400).json({ error: "A valid email address is required." });

  const offers = Array.isArray(b.offers) ? b.offers.slice(0, 12) : [];
  if (offers.length === 0) return res.status(400).json({ error: "No results to email." });

  const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
  if (emailRateLimited(ip)) {
    return res.status(429).json({ error: "Too many emails sent recently. Please try again in a few minutes." });
  }

  const currency = /^[A-Za-z]{3}$/.test(b.currency || "") ? String(b.currency).toUpperCase() : "USD";
  const adults = Math.min(9, Math.max(1, parseInt(b.adults, 10) || 1));
  const selDep = isValidDate(b.selectedDepartureDate) ? b.selectedDepartureDate : null;
  const selRet = isValidDate(b.selectedReturnDate) ? b.selectedReturnDate : null;
  // Only embed a saved-search link if it points at our own /travel page
  // (prevents the public endpoint from being abused to mail arbitrary links).
  const isOwnTravelUrl = (u) => {
    try {
      const x = new URL(u);
      return (x.protocol === "https:" || x.protocol === "http:")
        && /(^|\.)curriculate\.net$/.test(x.hostname)
        && x.pathname === "/travel";
    } catch { return false; }
  };
  const searchUrl = (typeof b.searchUrl === "string" && isOwnTravelUrl(b.searchUrl)) ? b.searchUrl : null;
  const route = `${esc(b.originResolved || "")} → ${esc(b.destinationResolved || "")}`.trim();
  const fmtMoney = (amt, cur) => {
    try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: cur || currency, maximumFractionDigits: 0 }).format(amt); }
    catch { return `${amt} ${cur || currency}`; }
  };
  const stopsLabel = (n) => (n == null ? "" : n === 0 ? "Non-stop" : n === 1 ? "1 stop" : `${n} stops`);
  const durToMin = (s) => {
    if (!s || typeof s !== "string") return null;
    const m = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
    const mins = m ? (parseInt(m[1] || "0", 10) * 60) + parseInt(m[2] || "0", 10) : 0;
    return mins > 0 ? mins : null;
  };
  // Highlight a date that isn't the one the user selected (mirrors the web UI).
  const fmtDate = (iso, isOff) => {
    if (!iso) return "";
    return isOff
      ? `<span style="background:#fef3c7;color:#b45309;border-radius:3px;padding:0 3px;">⚠ ${esc(iso)}</span>`
      : esc(iso);
  };

  // Badges across the set: cheapest, fewest stops, shortest trip time.
  const totalStops = (o) => (o.outboundStops || 0) + (o.returnStops || 0);
  const tripMin = (o) => {
    const out = durToMin(o.outboundDuration); const ret = durToMin(o.returnDuration);
    return out == null && ret == null ? null : (out || 0) + (ret || 0);
  };
  const cheapest = offers.reduce((m, o) => (m == null || Number(o.price) < m ? Number(o.price) : m), null);
  const fewestStops = offers.reduce((m, o) => (m == null || totalStops(o) < m ? totalStops(o) : m), null);
  const shortestTrip = offers.reduce((m, o) => { const t = tripMin(o); return t != null && (m == null || t < m) ? t : m; }, null);
  const badgeHtml = (o) => {
    const bs = [];
    if (Number(o.price) === cheapest) bs.push("Cheapest");
    if (fewestStops != null && totalStops(o) === fewestStops) bs.push("Fewest stops");
    if (shortestTrip != null && tripMin(o) === shortestTrip) bs.push("Shortest trip");
    return bs.map((x) => `<span style="background:#d1fae5;color:#047857;border-radius:9px;padding:1px 7px;font-size:11px;font-weight:600;margin-right:4px;">${x}</span>`).join("");
  };

  const perLabel = adults > 1 ? "per person, all-in" : "1 adult, all-in";
  const rows = offers.map((o) => {
    const legs = [
      `Out: ${esc(stopsLabel(o.outboundStops))}${o.outboundDuration ? ` · ${esc(o.outboundDuration)}` : ""}${o.outboundArriveTime ? ` · arr ${o.outboundArriveDate ? esc(o.outboundArriveDate) + " " : ""}${esc(o.outboundArriveTime)}` : ""}`,
      o.returnDate ? `Back: ${esc(stopsLabel(o.returnStops))}${o.returnDuration ? ` · ${esc(o.returnDuration)}` : ""}${o.returnDepartTime ? ` · leaves ${esc(o.returnDate)} ${esc(o.returnDepartTime)}` : ""}${o.returnArriveTime ? ` · arr ${o.returnArriveDate ? esc(o.returnArriveDate) + " " : ""}${esc(o.returnArriveTime)}` : ""}` : "",
    ].filter(Boolean).join("<br/>");
    const depOff = selDep && o.departureDate && o.departureDate !== selDep;
    const retOff = selRet && o.returnDate && o.returnDate !== selRet;
    const dates = `${fmtDate(o.departureDate, depOff)}${o.returnDate ? ` – ${fmtDate(o.returnDate, retOff)}` : " (one-way)"}`;
    const groupTotal = adults > 1 ? `<br/><span style="color:#475569;font-size:11px;">${esc(fmtMoney(Number(o.price) * adults, o.currency))} for ${adults}</span>` : "";
    const seat = o.seatWarning ? `<br/><span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:0 3px;font-size:11px;">⚠ ${esc(o.seatWarning)}</span>` : "";
    const link = o.bookingUrl ? `<a href="${esc(o.bookingUrl)}" style="color:#0284c7;">Find best price ↗</a>` : "";
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;vertical-align:top;"><span style="font-weight:700;">${esc(fmtMoney(Number(o.price), o.currency))}</span><br/><span style="color:#94a3b8;font-size:10px;">${perLabel}</span>${groupTotal}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;">${badgeHtml(o)}${badgeHtml(o) ? "<br/>" : ""}${esc(o.airline || "")}<br/><span style="color:#64748b;font-size:12px;">${dates}${o.originCode && o.destinationCode ? ` · ${esc(o.originCode)}⇄${esc(o.destinationCode)}` : ""}</span>${seat}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;vertical-align:top;">${legs}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;vertical-align:top;">${link}</td>
    </tr>`;
  }).join("");

  const carHtml = (b.carRental && b.carRental.note)
    ? `<p style="background:#f5f3ff;color:#5b21b6;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:13px;">🚗 <strong>Car rental:</strong> ${esc(b.carRental.note)}${b.carRental.bookingUrl ? ` <a href="${esc(b.carRental.bookingUrl)}" style="color:#7c3aed;">Compare cars ↗</a>` : ""} <span style="color:#a78bfa;font-size:11px;">(indicative)</span></p>`
    : "";

  const rerunHtml = searchUrl
    ? `<p style="margin:14px 0;"><a href="${esc(searchUrl)}" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600;font-size:14px;">🔄 Re-run this search for updated prices ↗</a></p>
    <p style="color:#94a3b8;font-size:12px;margin:-6px 0 6px;">Bookmark this email — open the link any time to check the latest fares for this exact trip.</p>`
    : "";

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#0f172a;max-width:680px;margin:24px auto;padding:8px;">
    <h2 style="margin:0 0 4px;font-size:20px;">Flight results${route ? `: ${route}` : ""}</h2>
    ${b.summary ? `<p style="color:#475569;margin:6px 0 14px;">${esc(b.summary)}</p>` : ""}
    ${carHtml}
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;">
        <th style="padding:8px 10px;">Price</th><th style="padding:8px 10px;">Flight</th><th style="padding:8px 10px;">Stops</th><th style="padding:8px 10px;">Book</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${rerunHtml}
    <p style="color:#94a3b8;font-size:12px;margin-top:18px;">Fares are AI-estimated from web search (${perLabel}) and may be out of date — confirm the final price on the booking site. ⚠ marks dates that differ from the one you selected. Searched at <a href="https://curriculate.net/travel" style="color:#0284c7;">curriculate.net/travel</a>.</p>
  </div>`;

  const badgeText = (o) => {
    const bs = [];
    if (Number(o.price) === cheapest) bs.push("Cheapest");
    if (fewestStops != null && totalStops(o) === fewestStops) bs.push("Fewest stops");
    if (shortestTrip != null && tripMin(o) === shortestTrip) bs.push("Shortest trip");
    return bs.length ? ` [${bs.join(", ")}]` : "";
  };
  const text = `Flight results${route ? `: ${b.originResolved} -> ${b.destinationResolved}` : ""}\n` +
    (b.carRental?.note ? `Car rental: ${b.carRental.note}\n` : "") + "\n" +
    offers.map((o) => {
      const depMark = selDep && o.departureDate !== selDep ? " (!)" : "";
      const retMark = selRet && o.returnDate && o.returnDate !== selRet ? " (!)" : "";
      const total = adults > 1 ? ` (${fmtMoney(Number(o.price) * adults, o.currency)} for ${adults})` : "";
      return `${fmtMoney(Number(o.price), o.currency)} ${perLabel}${total}${badgeText(o)} — ${o.airline} — ${o.departureDate}${depMark}${o.returnDate ? ` to ${o.returnDate}${retMark}` : " (one-way)"} — ${stopsLabel(o.outboundStops)}${o.seatWarning ? `\n  ! ${o.seatWarning}` : ""}${o.bookingUrl ? `\n  ${o.bookingUrl}` : ""}`;
    }).join("\n\n") +
    (searchUrl ? `\n\nRe-run this search for updated prices:\n${searchUrl}` : "") +
    `\n\nFares are AI-estimated (${perLabel}); (!) marks non-exact dates — confirm on the booking site. curriculate.net/travel`;

  try {
    const from = process.env.TRAVEL_FROM || "Curriculate Flights <noreply@curriculate.net>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Flight results${route ? `: ${(b.originResolved || "").replace(/\s*\(.*$/, "")} → ${(b.destinationResolved || "").replace(/\s*\(.*$/, "")}` : ""}`,
        text,
        html,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Email provider error ${r.status}: ${body.slice(0, 200)}`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || "Failed to send email." });
  }
});

export default router;
