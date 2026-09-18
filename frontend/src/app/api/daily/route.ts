import { NextResponse } from "next/server";
import { listSheetTitles, readGridLinks, readRanges, readRangesSafe } from "@/lib/daily/sheets";
import { buildPayload, refFromFormula, urlFromFormula, type Payload } from "@/lib/daily/parse";
import { mergeRanges, rangeCovers, referencedRanges } from "@/lib/daily/formula";
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
// How long a refresh may hold the "one at a time" marker before another may
// start. Longer than any read should take, short enough that a frozen instance
// does not wedge the board on an old copy.
const REFRESH_GIVE_UP_MS = 60_000;
// A ceiling on the ranges taken from the rules, so a formula naming half the
// spreadsheet cannot turn one refresh into a long read.
const MAX_EXTRA_RANGES = 8;

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
  const stale = age >= CACHE_MAX_AGE_MS || c.partial || (c.dirty && age >= MIN_REFRESH_MS);
  const held = Date.now() < c.blockedUntil;
  // A copy in hand is served straight away and the sheet re-read behind it.
  // Waiting for the read made every third or fourth poll take as long as the
  // slowest thing Google did that minute, and on the board that is a screen
  // that sits there. Only a cold instance with nothing to show waits.
  if (c.body && !forced) {
    if (stale && !held) refreshSoon();
    return json({
      ...c.body,
      version: c.version,
      cachedFor: Math.round(age / 1000),
      ...(held ? { stale: true, error: "Sheets quota reached; showing the last read" } : {}),
    });
  }

  try {
    // Nothing to show at all — a cold instance. That read skips the two grid
    // reads and the discovery of any new range: they are the slow half, and
    // they carry handout links, not the lesson. The copy is marked partial so
    // the next poll fills it in.
    return json({ ...(await refreshSoon(true)), version: c.version, cachedFor: 0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheet read failed";
    if (c.body) return json({ ...c.body, version: c.version, stale: true, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * One read at a time, whoever asked for it.
 *
 * The board polls every ten seconds and the refresh runs behind the response,
 * so without this a slow read would have another started on top of it. The
 * marker is given up after REFRESH_GIVE_UP_MS as well as on settling: this runs
 * on a serverless instance that may be frozen the moment the response is sent,
 * and a promise that never resumes would otherwise block every later refresh.
 */
function refreshSoon(quick = false): Promise<Payload> {
  const now = Date.now();
  if (inFlight && now - inFlightAt < REFRESH_GIVE_UP_MS) return inFlight;
  inFlightAt = now;
  inFlight = refresh(quick).finally(() => { inFlight = null; });
  // A background refresh must not take the process down with it.
  inFlight.catch(() => {});
  return inFlight;
}

let inFlight: Promise<Payload> | null = null;
let inFlightAt = 0;

async function refresh(quick: boolean): Promise<Payload> {
  const c = dailyCache;
  try {
    // Everything the board needs in three requests: one values batch, one
    // formula batch, one grid read. It used to be a dozen or more, which put a
    // busy morning over the Sheets read quota (60 per minute per user) and left
    // the board showing a 429. The tab list is cached for an hour on top.
    const sheetTitles = await listSheetTitles().catch(() => [] as string[]);
    // Kiss & Ride, KissRide, "Kiss & Ride 2026" — anything with both words.
    const waitingTab = (sheetTitles || []).find((t) => /kiss\s*&?\s*ride/i.test(t)) || "";
    const waitingRange = waitingTab ? `'${waitingTab.replace(/'/g, "''")}'!A1:H60` : "";

    const cachedExtra = c.extraRanges.slice(0, MAX_EXTRA_RANGES);

    const VALUES = [
      "DisplayAI!A1:F40",   // 0 the day itself
      "Setup!A1:P40",       // 1 the labelled timing rules, and the columns the slot rules substitute from
      "Setup!S1:AB8",       // 2 the E1 slot table (S2 is the picture the CE rule swaps in)
      "Setup!M1:Q8",        // 3 column M the weekday names, N to Q the message times
      "Display!E1",         // 4 the feature cell, either tab
      "DisplayAI!E1",       // 5
      "Poems!F1:J3",        // 6
      "VerticalAi!D1:J200", // 7
      "Riddles!D1:D400",    // 8
      "Master!B1:B2",       // 9
      "Verses!A1:A400",     // 10 what A5 picks the day's verse from
      "Vertical!A1:K200",   // 11 column A the period times, F to K the day's plan
      // Row 3 the class names, row 46 the four privilege flags, and the days in
      // between — one read where there used to be two.
      "Points!A1:BV46",     // 12
      "Lessons!C1:K400",    // 13 the teacher's own material, keyed by lesson code
      // The tabs the Setup slot rules reach into. They cost nothing extra — a
      // values batch is one request however many ranges it names — and without
      // them every one of those formulas throws and falls back to whatever the
      // sheet computed at the moment of the read, which the scrubber cannot move.
      "Display!A1:F20",     // 14 A7 the hour offset, A9/A11/A13 the times, B7/D7 the switches, C7/C9/C11 the rows
      "Poems!A1:B60",       // 15 A the poem of the week, B the alternate (Setup C19)
      "MemoryCards!H1:H40", // 16 the memory verse, joined
      "Vocab!A1:B60",       // 17 the week's vocabulary
      "Master!A1:K2",       // 18 B2 the week, K2 the anthem time
      "Subjects!U1:U40",    // 19 the standing lines the daily update ends with
      "MathChallenge!A1:C60", // 20 the question and its solution
      // What the sheet's own script recorded for the pictures the API cannot
      // see: cell address, then a durable address for the picture in it.
      "BoardImages!A2:B200", // 21
      // Column B of Lessons: the row above a course's first lesson carries the
      // link to that course's deck for the year, which the heading points at.
      "Lessons!B1:B400",     // 22
      // The reward thresholds, one row per benefit: how many points, over how
      // many days, how many times. The board only computes the last of them,
      // the writing penalty, but it should do so from the sheet's own numbers.
      "Setup!D52:AE56",      // 23 — row 52 is the header the columns are read by
      // The Formal Discussion topics: L for grade 7, M for grade 8, by row.
      "Impromptu!L1:M30",    // 24
      ...(waitingRange ? [waitingRange] : []), // 23
      // And whatever the slot rules themselves asked for last time round: the
      // list of pictures a rule indexes into can live on a tab of its own, and
      // a rule that reaches past what the board holds throws and falls back to
      // the value the sheet computed — which for a picture cell is nothing.
      ...cachedExtra,
    ];
    const FORMULAS = [
      "DisplayAI!D1:D40",   // 0 the video link on each row
      "DisplayAI!C1:C40",   // 1 links inside the lesson cells
      "Setup!S1:AB8",       // 2
      "Display!E1",         // 3 an =IMAGE() cell has no value, only a formula
      "DisplayAI!E1",       // 4
      "Poems!F1:J3",        // 5
      "Lessons!C1:K400",    // 6 an =IMAGE() or =HYPERLINK() in the picture and video columns
      "Lessons!B1:B400",    // 7 a HYPERLINK() to a course's deck
      // A2 is the day's notices, and its rule turns over at noon — today's
      // events before, tomorrow's after — so the board runs it at its own clock
      // like the rest. A1 to A5 comes as one range.
      "DisplayAI!A1:A5",    // 8
      // The same ranges the rules named, as formulas: a cell on one of those
      // tabs may hold =IMAGE("…") and no text value at all, which is exactly
      // the case the picture lists are written in.
      ...cachedExtra,       // 9 onwards
    ];

    const none = { first: [] as string[][], runs: [] as { text: string; url: string }[][][] };
    const [values, formulas, grid, lessonGrid] = await Promise.all([
      readRangesSafe(VALUES),
      readRangesSafe(FORMULAS, "FORMULA"),
      quick ? none : readGridLinks("DisplayAI!A1:F40").catch(() => none),
      // Handouts on the Lessons rows are often a link attached to a phrase in
      // the page or homework cell, which the values API cannot see.
      // E and F for the handouts, I to K because a picture or a video can be a
      // link attached to the cell's text, which no value or formula shows.
      // B as well as E to K: the deck link above a course's first lesson is
      // often attached to that cell's text, which no value or formula shows.
      quick ? none : readGridLinks("Lessons!B1:K400").catch(() => none),
    ]);

    const display = values[0] || [];
    const setup = values[1] || [];
    const slotBlock = values[2] || [];
    const setupMessages = values[3] || [];
    const feature = (values[4]?.[0]?.[0]) || (values[5]?.[0]?.[0]) || "";
    const waiting = waitingRange ? (values[25] || []) : [];
    const extraAt = waitingRange ? 26 : 25;
    const extraGrids = cachedExtra.map((range, i) => ({
      range,
      values: values[extraAt + i] || [],
      formulas: formulas[9 + i] || [],
    }));

    const displayD = formulas[0] || [];
    const displayC = formulas[1] || [];
    const slotBlockFormulas = formulas[2] || [];
    const noticeFormula = ((formulas[8] || [])[1] || [])[0] || ""; // DisplayAI!A2

    // The block is read from S so the picture in S2 — what the CE rule shows on
    // the last teaching day of the week — comes with it, and out to AB. The E1
    // formula's HLOOKUP works on U onwards, so the slots themselves drop the two
    // leading columns. The whole block is carried through for ?debug=1, where
    // its formulas can be inspected, and for the board to evaluate itself.
    const slots = slotBlock.map((r) => (r || []).slice(2));
    // buildSources wants row 4 of the U.. slots as its formula row.
    const slotFormulas = [((slotBlockFormulas[3] || []).slice(2))];
    // An =IMAGE() cell has no text value, so the picture's URL only shows up here.
    let featureFormula = (formulas[3]?.[0]?.[0]) || (formulas[4]?.[0]?.[0]) || "";

    // `=IMAGE(Setup!Z4)` or `=Setup!Z4` keeps the URL one cell away: follow it once.
    // Only when the board does not already hold that cell: the ranges the rules
    // name are read with everything else now, and two extra round trips on
    // every refresh is two more chances for the board to sit there waiting.
    const ref = refFromFormula(featureFormula);
    const haveRef = !!ref && [...VALUES, ...cachedExtra].some((have) => rangeCovers(have, ref.includes("!") ? ref : `Setup!${ref}`));
    if (ref && !haveRef && !urlFromFormula(featureFormula)) {
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

    // The rules name where they look. Anything they name that the fixed reads do
    // not already cover is read now — one extra request — and remembered, so
    // from the next refresh it travels in the values batch for nothing.
    const named = referencedRanges([
      ...slotBlockFormulas.flatMap((r) => (r || []).map((cell) => String(cell || ""))),
      featureFormula,
      // A2 reaches into Bdays and SchoolCalendar; naming them here is what gets
      // them read, which is what lets the rule be run at all.
      noticeFormula,
    ]);
    // Each reference is checked on its own before they are merged: the rules
    // reach all over Setup, and one box round the lot of them would look like a
    // range nothing covers even though every cell in it is already read.
    const wanted = mergeRanges(
      named.filter((r) => ![...VALUES, ...cachedExtra].some((have) => rangeCovers(have, r)))
    );
    if (wanted.length && !quick) {
      const fresh = wanted.slice(0, Math.max(0, MAX_EXTRA_RANGES - cachedExtra.length));
      c.extraRanges = [...cachedExtra, ...fresh].slice(0, MAX_EXTRA_RANGES);
      try {
        const [more, moreFormulas] = await Promise.all([
          readRangesSafe(fresh),
          readRangesSafe(fresh, "FORMULA"),
        ]);
        fresh.forEach((range, i) => extraGrids.push({
          range, values: more[i] || [], formulas: moreFormulas[i] || [],
        }));
      } catch {
        /* the tabs those rules name could not be read; the rules fall back */
      }
    }

    const body = buildPayload({
      display, displayD, displayC, setup, slots, slotFormulas, feature, featureFormula,
      poems: values[6] || [],
      poemFormulas: formulas[5] || [],
      vertical: values[7] || [],
      riddles: values[8] || [],
      master: values[9] || [],
      lessons: values[13] || [],
      lessonFormulas: formulas[6] || [],
      noticeFormula,
      lessonsB: values[22] || [],
      lessonsBFormulas: formulas[7] || [],
      lessonLinkRuns: lessonGrid.runs || [],
      verses: values[10] || [],
      // Vertical!B4 lives inside the block above, so it costs no extra range.
      verseWeek: [[(((values[11] || [])[3] || [])[1]) || ""]],
      verticalTimes: values[11] || [],
      displayTab: values[14] || [],
      poemsAB: values[15] || [],
      memoryCards: values[16] || [],
      vocab: values[17] || [],
      masterWide: values[18] || [],
      subjects: values[19] || [],
      mathChallenge: values[20] || [],
      cellImages: values[21] || [],
      pointsGrid: values[12] || [],
      pointsRow3: (values[12] || [])[2] || [],
      pointsRow46: (values[12] || [])[45] || [],
      rewardRules: values[23] || [],
      impromptu: values[24] || [],
      displayLinks: grid.first || [],
      displayCRuns: (grid.runs || []).map((row) => (row || [])[2] || []),
      setupMessages,
      waiting,
      slotBlock,
      slotBlockFormulas,
      extraGrids,
    });
    c.body = body;
    c.at = Date.now();
    c.partial = quick;
    c.dirty = false;
    c.blockedUntil = 0;
    c.version += 1;
    return body;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheet read failed";
    // 429 means the read quota is spent: stop asking for a while rather than
    // retrying on every poll and keeping it spent.
    if (/Sheets API 429|Quota exceeded/i.test(message)) c.blockedUntil = Date.now() + QUOTA_BACKOFF_MS;
    throw e;
  }
}

function json(body: Payload | Record<string, unknown>) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
