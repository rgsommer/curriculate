import { NextResponse } from "next/server";
import { readRanges } from "@/lib/daily/sheets";
import { buildPayload, type Payload } from "@/lib/daily/parse";
import { FIXTURE } from "@/lib/daily/fixture";

// GET /api/daily — the DisplayAI tab of the planning spreadsheet, parsed for
// the /daily classroom board. Cached in memory for a short while so several
// screens polling every minute do not multiply Sheets API calls.
//
// Optional protection: set DAILY_ACCESS_KEY and open the board as
// /daily?k=<key>; the page forwards it here.

export const dynamic = "force-dynamic";

const TTL_MS = 30_000;
let cache: { at: number; body: Payload } | null = null;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requiredKey = process.env.DAILY_ACCESS_KEY;
  if (requiredKey && searchParams.get("k") !== requiredKey) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const fresh = cache && Date.now() - cache.at < TTL_MS && !searchParams.has("nocache");
  if (fresh && cache) {
    return NextResponse.json(cache.body, { headers: { "Cache-Control": "no-store" } });
  }

  // Preview without credentials (never in production): DAILY_FIXTURE=1 npm run dev
  if (process.env.DAILY_FIXTURE === "1" && process.env.NODE_ENV !== "production") {
    return NextResponse.json(buildPayload(FIXTURE), { headers: { "Cache-Control": "no-store" } });
  }

  try {
    // Core content. If this fails the board cannot render, so let it throw.
    const [display, setup, slots] = await readRanges(["DisplayAI!A1:F40", "Setup!A1:D20", "Setup!U1:AA8"]);

    // Optional extras: the feature cell and the formulas that carry links.
    // A renamed tab must not take the whole board down, so these degrade to empty.
    let feature = "";
    let displayD: string[][] = [];
    let displayC: string[][] = [];
    let slotFormulas: string[][] = [];
    try {
      const [featA, featB] = await readRanges(["Display!E1", "DisplayAI!E1"]);
      feature = (featA[0] && featA[0][0]) || (featB[0] && featB[0][0]) || "";
    } catch {
      /* no feature cell */
    }
    try {
      [displayD, displayC, slotFormulas] = await readRanges(
        ["DisplayAI!D1:D40", "DisplayAI!C1:C40", "Setup!U4:AA4"],
        "FORMULA"
      );
    } catch {
      /* links unavailable; the board still works */
    }

    const body = buildPayload({ display, displayD, displayC, setup, slots, slotFormulas, feature });
    cache = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheet read failed";
    // Serve the last good copy if we have one, flagged as stale.
    if (cache) {
      return NextResponse.json({ ...cache.body, stale: true, error: message }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
