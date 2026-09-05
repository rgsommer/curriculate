import { NextResponse } from "next/server";
import { dailyCache } from "@/lib/daily/cache";

// POST or GET /api/daily/ping?key=<DAILY_PING_KEY>
//
// Called by an Apps Script on-edit trigger on the planning spreadsheet. It
// marks the in-memory copy dirty so the next board poll re-reads the sheet,
// which is how an edit reaches the projector within about ten seconds instead
// of waiting out the cache. Does nothing when DAILY_PING_KEY is not set.

export const dynamic = "force-dynamic";

function handle(req: Request) {
  const key = process.env.DAILY_PING_KEY;
  if (!key) return NextResponse.json({ error: "DAILY_PING_KEY is not set" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") !== key) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  dailyCache.dirty = true;
  return NextResponse.json({ ok: true, version: dailyCache.version }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
