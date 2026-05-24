"use client";

/**
 * curriculate.net/travel — flight finder
 *
 * Prompts for from/to (city or airport, with an option to include nearby
 * airports within 100km), return vs one-way, dates, flexible departure
 * (±1/±2 days), max stops, and an option to prioritize the shortest layovers.
 * Prices a single adult in the browser's local currency and links out to the
 * best price.
 *
 * Backed by /api/travel/search on api.curriculate.net, which uses AI web
 * search (no dedicated flight API). Searches take ~15-40s.
 */

import React, { useCallback, useEffect, useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

// ---------------------------------------------------------------------------
// Currency: best-effort auto-detect from the browser locale.
// ---------------------------------------------------------------------------
const REGION_CURRENCY = {
  CA: "CAD", US: "USD", GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR",
  IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR",
  AU: "AUD", NZ: "NZD", JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD", IN: "INR",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", MX: "MXN", BR: "BRL",
  ZA: "ZAR", AE: "AED", SA: "SAR", KR: "KRW", TH: "THB", MY: "MYR", PH: "PHP",
};
const CURRENCY_OPTIONS = [
  "CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "CNY", "HKD", "SGD", "INR",
  "CHF", "SEK", "NOK", "DKK", "MXN", "BRL", "ZAR", "AED", "KRW",
];

function detectCurrency() {
  if (typeof navigator === "undefined") return "CAD";
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of langs) {
      const region = new Intl.Locale(tag).region;
      if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    }
  } catch {}
  return "CAD";
}

function fmtMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
function fmtDay(iso) {
  if (!iso) return "";
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function stopsLabel(n) {
  if (n == null) return "";
  if (n === 0) return "Non-stop";
  return n === 1 ? "1 stop" : `${n} stops`;
}
function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// Day after a YYYY-MM-DD string (UTC-safe).
function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// Parse a human duration like "7h 35m" / "7h" / "45m" into minutes (null if none).
function durToMin(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (!m) return null;
  const mins = (parseInt(m[1] || "0", 10) * 60) + parseInt(m[2] || "0", 10);
  return mins > 0 ? mins : null;
}

// Flexibility options → day offsets relative to the chosen date. Single-
// direction choices are ranges "up to" that day (and always include 0).
const FLEX_OPTIONS = [
  { value: "0", label: "Exact date", offsets: [0] },
  { value: "-2", label: "Up to 2 days earlier", offsets: [-2, -1, 0] },
  { value: "-1", label: "Up to 1 day earlier", offsets: [-1, 0] },
  { value: "+1", label: "Up to 1 day later", offsets: [0, 1] },
  { value: "+2", label: "Up to 2 days later", offsets: [0, 1, 2] },
  { value: "pm1", label: "± 1 day", offsets: [-1, 0, 1] },
  { value: "pm2", label: "± 2 days", offsets: [-2, -1, 0, 1, 2] },
];
function flexOffsets(value) {
  return (FLEX_OPTIONS.find((o) => o.value === value) || FLEX_OPTIONS[0]).offsets;
}

// Persist the user's search choices across sessions.
const PREFS_KEY = "travelFinder.prefs.v1";
function loadPrefs() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || null; } catch { return null; }
}
function savePrefs(prefs) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

// ---------------------------------------------------------------------------
// One flight offer card.
// ---------------------------------------------------------------------------
function OfferCard({ offer, currency, badges, selectedDepartureDate, selectedReturnDate, adults }) {
  const hasReturn = offer.returnDate != null;
  const cur = offer.currency || currency;
  const groupTotal = adults > 1 ? offer.price * adults : null;
  const depOff = offer.departureDate && offer.departureDate !== selectedDepartureDate;
  const retOff = hasReturn && offer.returnDate !== selectedReturnDate;
  // Warning style for a date that isn't the exact one the user selected.
  const warnDate = (iso, title) => (
    <span className="rounded bg-amber-100 px-1 font-medium text-amber-700" title={title}>
      ⚠ {fmtDay(iso)}
    </span>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {badges.map((b) => (
              <span key={b} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{b}</span>
            ))}
            <span className="text-sm font-semibold text-slate-800">{offer.airline}</span>
          </div>
          <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {depOff ? warnDate(offer.departureDate, "Not your selected departure date") : <span>{fmtDay(offer.departureDate)}</span>}
            {hasReturn ? (
              <>
                <span>–</span>
                {retOff ? warnDate(offer.returnDate, "Not your selected return date") : <span>{fmtDay(offer.returnDate)}</span>}
              </>
            ) : <span>· one-way</span>}
            {offer.originCode && offer.destinationCode ? <span>· {offer.originCode} ⇄ {offer.destinationCode}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold text-slate-900">{fmtMoney(offer.price, cur)}</div>
          <div className="text-[11px] text-slate-400">
            {adults > 1 ? "per person, all-in" : "1 adult, all-in"}
            {offer.converted ? ` · converted to ${cur}` : ""}
          </div>
          {groupTotal != null && (
            <div className="text-xs font-medium text-slate-600">{fmtMoney(groupTotal, cur)} for {adults}</div>
          )}
        </div>
      </div>

      {offer.seatWarning && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">⚠ {offer.seatWarning}</div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Outbound</div>
          <div className="text-sm font-medium text-slate-800">
            {stopsLabel(offer.outboundStops)}{offer.outboundDuration ? ` · ${offer.outboundDuration}` : ""}
          </div>
        </div>
        {hasReturn && (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Return</div>
            <div className="text-sm font-medium text-slate-800">
              {stopsLabel(offer.returnStops)}{offer.returnDuration ? ` · ${offer.returnDuration}` : ""}
            </div>
          </div>
        )}
      </div>

      {offer.stopsDetail && <div className="mt-2 text-xs text-slate-500">{offer.stopsDetail}</div>}
      {offer.notes && <div className="mt-1 text-xs text-slate-400">{offer.notes}</div>}

      {(offer.bookingUrl || offer.altBookingUrl) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {offer.bookingUrl && (
            <a
              href={offer.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Find best price ↗
            </a>
          )}
          {offer.altBookingUrl && (
            <a
              href={offer.altBookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              Google Flights
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function TravelPage() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [includeNearbyOrigin, setIncludeNearbyOrigin] = useState(false);
  const [includeNearbyDestination, setIncludeNearbyDestination] = useState(false);
  const [tripType, setTripType] = useState("return"); // "return" | "oneway"
  const [departureDate, setDepartureDate] = useState(todayPlus(14));
  const [returnDate, setReturnDate] = useState(nextDay(todayPlus(14)));
  const [departureFlex, setDepartureFlex] = useState("0"); // FLEX_OPTIONS value
  const [returnFlex, setReturnFlex] = useState("0");
  const [maxStops, setMaxStops] = useState(2); // 0 | 1 | 2 (2 = "2+")
  const [adults, setAdults] = useState(1);
  const [includeCarRental, setIncludeCarRental] = useState(false);
  const [prioritizeShortStops, setPrioritizeShortStops] = useState(false);
  const [currency, setCurrency] = useState("CAD");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [emailTo, setEmailTo] = useState("");
  const [emailState, setEmailState] = useState({ status: "idle", msg: "" }); // idle | sending | sent | error

  // Rehydrate saved choices on mount; fall back to auto-detected currency and
  // reset any saved dates that are now in the past. Saving is gated on a state
  // flag (not a ref) so the save effect can't run in the same commit as
  // hydration and clobber storage with the pre-hydration defaults.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    const p = loadPrefs();
    const today = todayPlus(0);
    if (p) {
      if (typeof p.origin === "string") setOrigin(p.origin);
      if (typeof p.destination === "string") setDestination(p.destination);
      if (typeof p.includeNearbyOrigin === "boolean") setIncludeNearbyOrigin(p.includeNearbyOrigin);
      if (typeof p.includeNearbyDestination === "boolean") setIncludeNearbyDestination(p.includeNearbyDestination);
      if (p.tripType === "return" || p.tripType === "oneway") setTripType(p.tripType);
      if (typeof p.departureDate === "string" && p.departureDate >= today) setDepartureDate(p.departureDate);
      if (typeof p.returnDate === "string" && p.returnDate >= today) setReturnDate(p.returnDate);
      if (FLEX_OPTIONS.some((o) => o.value === p.departureFlex)) setDepartureFlex(p.departureFlex);
      if (FLEX_OPTIONS.some((o) => o.value === p.returnFlex)) setReturnFlex(p.returnFlex);
      if ([0, 1, 2].includes(p.maxStops)) setMaxStops(p.maxStops);
      if (Number.isInteger(p.adults) && p.adults >= 1 && p.adults <= 9) setAdults(p.adults);
      if (typeof p.includeCarRental === "boolean") setIncludeCarRental(p.includeCarRental);
      if (typeof p.prioritizeShortStops === "boolean") setPrioritizeShortStops(p.prioritizeShortStops);
      if (typeof p.emailTo === "string") setEmailTo(p.emailTo);
      setCurrency(/^[A-Za-z]{3}$/.test(p.currency || "") ? p.currency : detectCurrency());
    } else {
      setCurrency(detectCurrency());
    }
    setIsHydrated(true);
  }, []);

  // Persist choices whenever they change (after the initial hydration).
  useEffect(() => {
    if (!isHydrated) return;
    savePrefs({
      origin, destination, includeNearbyOrigin, includeNearbyDestination, tripType,
      departureDate, returnDate, departureFlex, returnFlex, maxStops, adults, includeCarRental,
      prioritizeShortStops, currency, emailTo,
    });
  }, [isHydrated, origin, destination, includeNearbyOrigin, includeNearbyDestination, tripType, departureDate, returnDate, departureFlex, returnFlex, maxStops, adults, includeCarRental, prioritizeShortStops, currency, emailTo]);

  // Changing the departure date defaults the return to the day after, unless
  // the user already picked a return that's still later than the new departure.
  const handleDepartureChange = useCallback((v) => {
    setDepartureDate(v);
    setReturnDate((prev) => (prev && prev > v ? prev : nextDay(v)));
  }, []);

  const search = useCallback(async () => {
    setError("");
    setResult(null);
    setEmailState({ status: "idle", msg: "" });
    if (!origin.trim() || !destination.trim()) { setError("Please enter both a departure and destination."); return; }
    if (!departureDate) { setError("Please choose a departure date."); return; }
    if (tripType === "return" && !returnDate) { setError("Please choose a return date."); return; }

    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/travel/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: origin.trim(),
          destination: destination.trim(),
          includeNearbyOrigin,
          includeNearbyDestination,
          departureDate,
          returnDate: tripType === "return" ? returnDate : null,
          departureOffsets: flexOffsets(departureFlex),
          returnOffsets: tripType === "return" ? flexOffsets(returnFlex) : [0],
          maxStops,
          adults,
          includeCarRental,
          prioritizeShortStops,
          currency,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Search failed.");
      setResult(j);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [origin, destination, includeNearbyOrigin, includeNearbyDestination, tripType, departureDate, returnDate, departureFlex, returnFlex, maxStops, adults, includeCarRental, prioritizeShortStops, currency]);

  const emailResults = useCallback(async () => {
    if (!result) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim())) {
      setEmailState({ status: "error", msg: "Please enter a valid email address." });
      return;
    }
    setEmailState({ status: "sending", msg: "" });
    try {
      const r = await fetch(`${BACKEND_URL}/api/travel/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo.trim(),
          originResolved: result.originResolved,
          destinationResolved: result.destinationResolved,
          summary: result.summary,
          currency: result.currency,
          adults: result.adults || 1,
          carRental: result.carRental || null,
          selectedDepartureDate: departureDate,
          selectedReturnDate: tripType === "return" ? returnDate : null,
          offers: result.offers,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to send.");
      setEmailState({ status: "sent", msg: `Sent to ${emailTo.trim()}.` });
    } catch (e) {
      setEmailState({ status: "error", msg: e.message || "Failed to send." });
    }
  }, [result, emailTo, departureDate, returnDate, tripType]);

  // Badges across the result set: cheapest, fewest stops, shortest trip time.
  const offers = result?.offers || [];
  const cheapest = offers.reduce((m, o) => (m == null || o.price < m ? o.price : m), null);
  const totalStops = (o) => (o.outboundStops || 0) + (o.returnStops || 0);
  const fewestStops = offers.reduce((m, o) => (m == null || totalStops(o) < m ? totalStops(o) : m), null);
  const tripMinutes = (o) => {
    const out = durToMin(o.outboundDuration);
    const ret = durToMin(o.returnDuration);
    if (out == null && ret == null) return null;
    return (out || 0) + (ret || 0);
  };
  const shortestTrip = offers.reduce((m, o) => {
    const t = tripMinutes(o);
    return t != null && (m == null || t < m) ? t : m;
  }, null);
  function badgesFor(o) {
    const b = [];
    if (o.price === cheapest) b.push("Cheapest");
    if (fewestStops != null && totalStops(o) === fewestStops) b.push("Fewest stops");
    if (shortestTrip != null && tripMinutes(o) === shortestTrip) b.push("Shortest trip");
    return b;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 to-white px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-slate-900">Flight Finder</h1>
          <p className="mt-1 text-sm text-slate-500">
            AI-powered fare search. Per-person prices, all-in, in {currency}.
          </p>
        </header>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From</label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="City or airport (e.g. Toronto or YYZ)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                autoComplete="off"
              />
              <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={includeNearbyOrigin} onChange={(e) => setIncludeNearbyOrigin(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                Include nearby airports (within 100km)
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">To</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="City or airport (e.g. London or LHR)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                autoComplete="off"
              />
              <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={includeNearbyDestination} onChange={(e) => setIncludeNearbyDestination(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                Include nearby airports (within 100km)
              </label>
            </div>
          </div>

          <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
            {[["return", "Return"], ["oneway", "One-way"]].map(([v, lbl]) => (
              <button
                key={v}
                type="button"
                onClick={() => setTripType(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tripType === v ? "bg-sky-600 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Departure date</label>
              <input
                type="date"
                value={departureDate}
                min={todayPlus(0)}
                onChange={(e) => handleDepartureChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <select
                value={departureFlex}
                onChange={(e) => setDepartureFlex(e.target.value)}
                aria-label="Departure date flexibility"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {FLEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {tripType === "return" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Return date</label>
                <input
                  type="date"
                  value={returnDate}
                  min={departureDate || todayPlus(0)}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <select
                  value={returnFlex}
                  onChange={(e) => setReturnFlex(e.target.value)}
                  aria-label="Return date flexibility"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {FLEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Max stops</label>
              <select
                value={maxStops}
                onChange={(e) => setMaxStops(parseInt(e.target.value, 10))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value={0}>Non-stop only</option>
                <option value={1}>1 stop max</option>
                <option value={2}>2+ stops OK</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Travellers</label>
              <select
                value={adults}
                onChange={(e) => setAdults(parseInt(e.target.value, 10))}
                aria-label="Number of adults"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>{n} adult{n === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={prioritizeShortStops}
              onChange={(e) => setPrioritizeShortStops(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Prioritize fewest / shortest layovers over price
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeCarRental}
              onChange={(e) => setIncludeCarRental(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Include cheap car rental at the destination
          </label>

          <button
            type="button"
            onClick={search}
            disabled={loading}
            className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Searching the web for fares… (~15–40s)" : "Search flights"}
          </button>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </section>

        {result && (
          <section className="mt-6">
            {(result.originResolved || result.destinationResolved) && (
              <div className="mb-2 text-sm text-slate-600">
                {result.originResolved} → {result.destinationResolved}
              </div>
            )}
            {result.summary && (
              <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-slate-700">{result.summary}</div>
            )}
            {result.carRental?.note && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
                <span className="font-semibold">🚗 Car rental:</span>
                <span>{result.carRental.note}</span>
                {result.carRental.bookingUrl && (
                  <a href={result.carRental.bookingUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-violet-700">
                    Compare cars ↗
                  </a>
                )}
                <span className="text-[11px] text-violet-400">indicative</span>
              </div>
            )}

            {offers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No flights found for those filters. Try widening the dates or allowing more stops.
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {offers.length} option{offers.length === 1 ? "" : "s"}
                  </h2>
                  <span className="text-xs text-slate-400">
                    {prioritizeShortStops ? "Fewest stops first" : "Best price first"}
                  </span>
                </div>
                <div className="space-y-3">
                  {offers.map((o, i) => (
                    <OfferCard
                      key={i}
                      offer={o}
                      currency={result.currency}
                      badges={badgesFor(o)}
                      selectedDepartureDate={departureDate}
                      selectedReturnDate={tripType === "return" ? returnDate : null}
                      adults={result.adults || 1}
                    />
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email these results</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => { setEmailTo(e.target.value); if (emailState.status !== "idle") setEmailState({ status: "idle", msg: "" }); }}
                      placeholder="you@example.com"
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      autoComplete="email"
                    />
                    <button
                      type="button"
                      onClick={emailResults}
                      disabled={emailState.status === "sending"}
                      className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {emailState.status === "sending" ? "Sending…" : "Send"}
                    </button>
                  </div>
                  {emailState.status === "sent" && <div className="mt-2 text-sm text-emerald-600">{emailState.msg}</div>}
                  {emailState.status === "error" && <div className="mt-2 text-sm text-rose-600">{emailState.msg}</div>}
                </div>

                {result.sources?.length > 0 && (
                  <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-xs font-medium text-slate-500">Sources</div>
                    <ul className="mt-1 space-y-0.5">
                      {result.sources.map((s, i) => (
                        <li key={i} className="truncate text-xs">
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">{s.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-4 text-center text-xs text-slate-400">
                  Fares are AI-estimated from web search and may be out of date. Confirm the final price on the booking site.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
