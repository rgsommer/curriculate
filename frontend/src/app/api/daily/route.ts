import { NextResponse } from "next/server";
import { listSheetTitles, readCellLinkRuns, readCellLinks, readRanges } from "@/lib/daily/sheets";
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
  const fresh = c.body && !c.dirty && age < CACHE_MAX_AGE_MS && !searchParams.has("nocache");
  if (fresh && c.body) {
    return json({ ...c.body, version: c.version, cachedFor: Math.round(age / 1000) });
  }

  try {
    // Core content plus the optional extras, in parallel. A renamed tab in the
    // optional ranges must not take the whole board down, so those degrade to empty.
    const [core, sheetTitles, featureRes, formulaRes, poemsRes, poemFormulaRes, verticalRes, riddlesRes, masterRes, versesRes, pointsRes, displayLinks, displayCRuns] = await Promise.all([
      readRanges(["DisplayAI!A1:F40", "Setup!A1:D20", "Setup!T1:AA8", "Setup!N1:Q8"]),
      // The Kiss & Ride waiting list is on its own tab. Its name is looked up
      // rather than hard-coded, so renaming the tab does not silently empty the
      // dismissal panel.
      listSheetTitles().catch(() => [] as string[]),
      readRanges(["Display!E1", "DisplayAI!E1"]).catch(() => [] as string[][][]),
      readRanges(
        ["DisplayAI!D1:D40", "DisplayAI!C1:C40", "Setup!T1:AA8", "Display!E1", "DisplayAI!E1"],
        "FORMULA"
      ).catch(() => [] as string[][][]),
      // Ingredients for the sheet's own display rules. Each tab is read on its
      // own: one missing tab must not take the rest of the board down.
      readRanges(["Poems!F1:J3"]).catch(() => [] as string[][][]),
      readRanges(["Poems!F1:J3"], "FORMULA").catch(() => [] as string[][][]),
      readRanges(["VerticalAi!D1:J200"]).catch(() => [] as string[][][]),
      readRanges(["Riddles!D1:D400"]).catch(() => [] as string[][][]),
      readRanges(["Master!B1:B2"]).catch(() => [] as string[][][]),
      // A5 shortens the verse with LEFT(..., 85). Reading its source lets the
      // board cut at a word boundary instead, and show it in full in the
      // twenty-minute windows the formula opens.
      readRanges(["Verses!A1:A400", "Vertical!B4"]).catch(() => [] as string[][][]),
      readRanges(["Points!A3:BZ3", "Points!A46:BZ46"]).catch(() => [] as string[][][]),
      // Links on the header cells. A rich-text link is invisible to the values
      // API, so the grid itself has to be read for the "Pray for …" line.
      readCellLinks("DisplayAI!A1:F40").catch(() => [] as string[][]),
      // Every link inside each lesson cell, so a handout attached to a phrase
      // (rather than written out as a URL) still reaches the board.
      readCellLinkRuns("DisplayAI!C1:C40").catch(() => [] as { text: string; url: string }[][]),
    ]);
    const [display, setup, slotBlock, setupMessages] = core;
    // Kiss & Ride, KissRide, "Kiss & Ride 2026" — anything with both words.
    const waitingTab = (sheetTitles || []).find((t) => /kiss\s*&?\s*ride/i.test(t)) || "";
    const waiting = waitingTab
      ? await readRanges([`'${waitingTab.replace(/'/g, "''")}'!A1:H60`]).then((r) => r[0] || []).catch(() => [] as string[][])
      : ([] as string[][]);
    // The slot table spans T to AA; the E1 formula's HLOOKUP works on U to AA,
    // so the slots themselves drop the leading T column. The whole block is
    // carried through for ?debug=1, where its formulas can be inspected.
    const slots = (slotBlock || []).map((r) => (r || []).slice(1));
    const [featA, featB] = featureRes;
    const feature = (featA && featA[0] && featA[0][0]) || (featB && featB[0] && featB[0][0]) || "";
    const [displayD = [], displayC = [], slotBlockFormulas = [], featFa = [], featFb = []] = formulaRes;
    // buildSources wants row 4 of the U..AA slots as its formula row.
    const slotFormulas = [((slotBlockFormulas[3] || []).slice(1))];
    // An =IMAGE() cell has no text value, so the picture's URL only shows up here.
    let featureFormula = (featFa[0] && featFa[0][0]) || (featFb[0] && featFb[0][0]) || "";

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
      poems: poemsRes[0] || [],
      poemFormulas: poemFormulaRes[0] || [],
      vertical: verticalRes[0] || [],
      riddles: riddlesRes[0] || [],
      master: masterRes[0] || [],
      verses: versesRes[0] || [],
      verseWeek: versesRes[1] || [],
      pointsRow3: ((pointsRes[0] || [])[0]) || [],
      pointsRow46: ((pointsRes[1] || [])[0]) || [],
      displayLinks: displayLinks || [],
      displayCRuns: displayCRuns || [],
      setupMessages: setupMessages || [],
      waiting,
      slotBlock: slotBlock || [],
      slotBlockFormulas: slotBlockFormulas || [],
    });
    c.body = body;
    c.at = Date.now();
    c.dirty = false;
    c.version += 1;
    return json({ ...body, version: c.version, cachedFor: 0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheet read failed";
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
