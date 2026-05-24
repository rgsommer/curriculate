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
  const flexDays = Math.min(2, Math.max(0, parseInt(b.flexDays, 10) || 0));
  const maxStops = [0, 1, 2].includes(b.maxStops) ? b.maxStops : 2;
  const prioritizeShortStops = !!b.prioritizeShortStops;
  const currency = /^[A-Za-z]{3}$/.test(b.currency || "") ? String(b.currency).toUpperCase() : "USD";
  const includeNearbyOrigin = !!b.includeNearbyOrigin;
  const includeNearbyDestination = !!b.includeNearbyDestination;

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

  // Describe the flexible-date window for the prompt.
  const depWindow = flexDays > 0
    ? `${shiftDate(departureDate, -flexDays)} to ${shiftDate(departureDate, flexDays)} (centered on ${departureDate})`
    : departureDate;
  const retWindow = returnDate && flexDays > 0
    ? `${shiftDate(returnDate, -flexDays)} to ${shiftDate(returnDate, flexDays)} (centered on ${returnDate})`
    : returnDate;

  const stopsRule =
    maxStops === 0 ? "Only non-stop (direct) flights. Discard anything with a connection."
    : maxStops === 1 ? "At most 1 stop in each direction. Discard anything with 2+ stops."
    : "Up to 2 stops in each direction is fine.";

  const sortRule = prioritizeShortStops
    ? "Rank results by FEWEST and SHORTEST layovers first, then by price."
    : "Rank results by LOWEST total price first.";

  const prompt = `You are a flight-search assistant. Use the web_search tool to find REAL, CURRENT flight options and prices, then return them as strict JSON.

TRIP
- From: ${origin}${includeNearbyOrigin ? " (also consider other airports within ~100km of this city)" : ""}
- To: ${destination}${includeNearbyDestination ? " (also consider other airports within ~100km of this city)" : ""}
- Trip type: ${returnDate ? "Round trip (return)" : "One-way"}
- Depart: ${depWindow}
${returnDate ? `- Return: ${retWindow}` : ""}
- Passengers: 1 adult
- Currency: ALL prices MUST be in ${currency}. Convert if a source quotes another currency.

CONSTRAINTS
- ${stopsRule}
- ${sortRule}
${flexDays > 0 ? "- The dates above are flexible windows. Look across the window and surface the cheapest dates; note each option's actual date." : ""}

SEARCH INSTRUCTIONS
- Make several web_search calls (e.g. Google Flights, Skyscanner, Kayak, airline sites) to find genuinely current fares.
- Resolve the 3-letter IATA airport codes you actually used for each option (e.g. Toronto -> YYZ, London Heathrow -> LHR).
- Do NOT invent prices. If you cannot verify a fare, omit that option.
- Return 4-8 of the best options.

OUTPUT — respond with ONLY this JSON (no prose, no markdown fences):
{
  "originResolved": "Toronto (YYZ)",
  "destinationResolved": "London (LHR)",
  "summary": "one or two sentences of useful context (cheapest found, best value, etc.)",
  "offers": [
    {
      "airline": "Air Canada",            // or comma-separated if multiple carriers
      "originCode": "YYZ",                 // IATA used for this option
      "destinationCode": "LHR",            // IATA used for this option
      "departureDate": "${departureDate}", // actual date for this option (within the window)
      ${returnDate ? `"returnDate": "${returnDate}",  // actual return date for this option` : `"returnDate": null,`}
      "price": 845,                         // number, in ${currency}
      "currency": "${currency}",
      "outboundStops": 0,                   // stops on the way there
      "returnStops": ${returnDate ? "0" : "null"},
      "outboundDuration": "7h 35m",
      "returnDuration": ${returnDate ? "\"8h 10m\"" : "null"},
      "stopsDetail": "Non-stop" ,           // human label e.g. "1 stop via Reykjavik (KEF), 2h layover"
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
          stopsDetail: o.stopsDetail ? stripCiteTags(String(o.stopsDetail)) : null,
          notes: o.notes ? stripCiteTags(String(o.notes)) : null,
          bookingUrl: originCode && destinationCode ? kayakLink(linkArgs) : null,
          altBookingUrl: originCode && destinationCode ? googleFlightsLink(linkArgs) : null,
        };
      });

    res.json({
      currency,
      originResolved: stripCiteTags(String(parsed.originResolved || origin)),
      destinationResolved: stripCiteTags(String(parsed.destinationResolved || destination)),
      summary: parsed.summary ? stripCiteTags(String(parsed.summary)) : "",
      count: offers.length,
      offers,
      sources,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Flight search failed." });
  }
});

export default router;
