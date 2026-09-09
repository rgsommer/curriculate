import { NextResponse } from "next/server";
import { listSheetTitles, readGridLinks, readRanges, readRangesSafe } from "@/lib/daily/sheets";
import { buildPayload, refFromFormula, urlFromFormula, type Payload } from "@/lib/daily/parse";
import { FIXTURE } from "@/lib/daily/fixture";
import { dailyCache } from "@/lib/daily/cache";

// GET /api/daily — the DisplayAI tab of the planning spreadsheet, parsed for
// the /daily classroom board.
//
// The board polls this every 10 s. Most of those polls are answered from the
// in-memory copy; the sheet itself is re-read when (a) the copy is older than
// CACHE_MAX_AGE_MS, or (b) the sheet has pinged /api/daily/ping since the last
// read (an Apps Script on-edit trigger does that), which is what makes an edit
// show on the board within a poll or two.
//
// Optional protection: set DAILY_ACCESS_KEY and open the board as
// /daily?k=<key>; the page forwards it here.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_MAX_AGE_MS = 120_000;
// A sheet edit pings /api/daily/ping, which marks the copy dirty. Without a
// floor, an editing session would re-read on every 10 s poll; the Sheets read
// quota is 60 requests a minute per user and each refresh costs three.
const MIN_REFRESH_MS = 20_000;
// How long to sit out after a 429 before asking again.
const QUOTA_BACKOFF_MS = 90_000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requiredKey = process.env.DAILY_ACCESS_KEY;
  if (requiredKey && searchParams.get("k") !== requiredKey) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  // Preview without credentials (never in production): DAILY_FIXTURE=1 npm run dev
  if (process.env.DAILY_FIXTURE === "1" && process.env.NODE_ENV !== "production") {
    return json({ ...buildPayload(FIXTURE), version: 1 });
  }

  const c = dailyCache;
  const age = c.body ? Date.now() - c.at : Infinity;
  const forced = searchParams.has("nocache");
  // A dirty copy is re-read, but not more often than MIN_REFRESH_MS.
  const stale = age >= CACHE_MAX_AGE_MS || (c.dirty && age >= MIN_REFRESH_MS);
  const held = Date.now() < c.blockedUntil;
  if (c.body && ((!stale && !forced) || held)) {
    return json({
      ...c.body,
      version: c.version,
      cachedFor: Math.round(age / 1000),
      ...(held ? { stale: true, error: "Sheets quota reached; showing the last read" } : {}),
    });
  }

  try {
    // Everything the board needs in three requests: one values batch, one
    // formula batch, one grid read. It used to be a dozen or more, which put a
    // busy morning over the Sheets read quota (60 per minute per user) and left
    // the board showing a 429. The tab list is cached for an hour on top.
    const sheetTitles = await listSheetTitles().catch(() => [] as string[]);
    // Kiss & Ride, KissRide, "Kiss & Ride 2026" — anything with both words.
    const waitingTab = (sheetTitles || []).find((t) => /kiss\s*&?\s*ride/i.test(t)) || "";
    const waitingRange = waitingTab ? `'${waitingTab.replace(/'/g, "''")}'!A1:H60` : "";

    const VALUES = [
      "DisplayAI!A1:F40",   // 0 the day itself
      "Setup!A1:D20",       // 1 the labelled timing rules
      "Setup!T1:AA8",       // 2 the E1 slot table
      "Setup!N1:Q8",        // 3 the dismissal message times
      "Display!E1",         // 4 the feature cell, either tab
      "DisplayAI!E1",       // 5
      "Poems!F1:J3",        // 6
      "VerticalAi!D1:J200", // 7
      "Riddles!D1:D400",    // 8
      "Master!B1:B2",       // 9
      "Verses!A1:A400",     // 10 what A5 picks the day's verse from
      "Vertical!B4",        // 11
      "Points!A3:BZ3",      // 12
      "Points!A46:BZ46",    // 13
      ...(waitingRange ? [waitingRange] : []), // 14
    ];
    const FORMULAS = [
      "DisplayAI!D1:D40",   // 0 the video link on each row
      "DisplayAI!C1:C40",   // 1 links inside the lesson cells
      "Setup!T1:AA8",       // 2
      "Display!E1",         // 3 an =IMAGE() cell has no value, only a formula
      "DisplayAI!E1",       // 4
      "Poems!F1:J3",        // 5
    ];

    const [values, formulas, grid] = await Promise.all([
      readRangesSafe(VALUES),
      readRangesSafe(FORMULAS, "FORMULA"),
      readGridLinks("DisplayAI!A1:F40").catch(() => ({ first: [], runs: [] })),
    ]);

    const display = values[0] || [];
    const setup = values[1] || [];
    const slotBlock = values[2] || [];
    const setupMessages = values[3] || [];
    const feature = (values[4]?.[0]?.[0]) || (values[5]?.[0]?.[0]) || "";
    const waiting = waitingRange ? (values[14] || []) : [];

    const displayD = formulas[0] || [];
    const displayC = formulas[1] || [];
    const slotBlockFormulas = formulas[2] || [];

    // The slot table spans T to AA; the E1 formula's HLOOKUP works on U to AA,
    // so the slots themselves drop the leading T column. The whole block is
    // carried through for ?debug=1, where its formulas can be inspected.
    const slots = slotBlock.map((r) => (r || []).slice(1));
    // buildSources wants row 4 of the U..AA slots as its formula row.
    const slotFormulas = [((slotBlockFormulas[3] || []).slice(1))];
    // An =IMAGE() cell has no text value, so the picture's URL only shows up here.
    let featureFormula = (formulas[3]?.[0]?.[0]) || (formulas[4]?.[0]?.[0]) || "";

    // `=IMAGE(Setup!Z4)` or `=Setup!Z4` keeps the URL one cell away: follow it once.
    const ref = refFromFormula(featureFormula);
    if (ref && !urlFromFormula(featureFormula)) {
      try {
        const [refValue, refFormula] = await Promise.all([
          readRanges([ref]),
          readRanges([ref], "FORMULA"),
        ]);
        const v = (refValue[0] && refValue[0][0] && refValue[0][0][0]) || "";
        const f = (refFormula[0] && refFormula[0][0] && refFormula[0][0][0]) || "";
        featureFormula = urlFromFormula(f) ? f : v || featureFormula;
      } catch {
        /* the reference did not resolve; carry on with what we have */
      }
    }

    const body = buildPayload({
      display, displayD, displayC, setup, slots, slotFormulas, feature, featureFormula,
      poems: values[6] || [],
      poemFormulas: formulas[5] || [],
      vertical: values[7] || [],
      riddles: values[8] || [],
      master: values[9] || [],
      verses: values[10] || [],
      verseWeek: values[11] || [],
      pointsRow3: (values[12] || [])[0] || [],
      pointsRow46: (values[13] || [])[0] || [],
      displayLinks: grid.first || [],
      displayCRuns: (grid.runs || []).map((row) => (row || [])[2] || []),
      setupMessages,
      waiting,
      slotBlock,
      slotBlockFormulas,
    });
    c.body = body;
    c.at = Date.now();
    c.dirty = false;
    c.blockedUntil = 0;
    c.version += 1;
    return json({ ...body, version: c.version, cachedFor: 0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheet read failed";
    // 429 means the read quota is spent: stop asking for a while rather than
    // retrying on every poll and keeping it spent.
    if (/Sheets API 429|Quota exceeded/i.test(message)) c.blockedUntil = Date.now() + QUOTA_BACKOFF_MS;
    // Serve the last good copy if we have one, flagged as stale.
    if (c.body) {
      return json({ ...c.body, version: c.version, stale: true, error: message });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function json(body: Payload | Record<string, unknown>) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
