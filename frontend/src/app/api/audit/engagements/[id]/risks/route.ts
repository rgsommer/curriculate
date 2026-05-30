// Risk register for an engagement.
//   GET   → list risks (auto-seeds the per-audit-type default register on first call).
//   POST  → add a custom risk.
//   PATCH → update a risk (likelihood/impact/response/status) by `risk_id` in body.
// Principal+ only.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { seedRisksForType, riskRating } from "../../../_planning";

function shape(r: any) {
  return {
    id: r._id.toString(),
    code: r.code, area: r.area, assertion: r.assertion, description: r.description,
    likelihood: r.likelihood, impact: r.impact,
    rating: riskRating(r.likelihood, r.impact),
    response: r.response, status: r.status || "identified", custom: !!r.custom,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    const eid = new ObjectId(id);
    let rows: any[] = await dbi.collection("audit_risks").find({ engagement_id: eid }).toArray();
    if (rows.length === 0) {
      const eng: any = await dbi.collection("audit_engagements").findOne({ _id: eid });
      if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const seeds = seedRisksForType(eng.audit_type || "other").map((s) => ({
        ...s, engagement_id: eid, status: "identified", custom: false, created_at: new Date(),
      }));
      if (seeds.length) await dbi.collection("audit_risks").insertMany(seeds as any);
      rows = await dbi.collection("audit_risks").find({ engagement_id: eid }).toArray();
    }
    // sort high→low rating, then area
    rows.sort((a, b) => (b.likelihood * b.impact) - (a.likelihood * a.impact) || String(a.area).localeCompare(String(b.area)));
    return NextResponse.json({ risks: rows.map(shape) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  if (!b.area || !b.description) return NextResponse.json({ error: "area and description are required" }, { status: 400 });
  const clamp = (n: any) => Math.min(3, Math.max(1, Number(n) || 1));
  const doc = {
    engagement_id: new ObjectId(id),
    code: String(b.code || "CUSTOM").toUpperCase().slice(0, 24),
    area: String(b.area).trim(),
    assertion: String(b.assertion || "").trim() || "—",
    description: String(b.description).trim(),
    likelihood: clamp(b.likelihood), impact: clamp(b.impact),
    response: String(b.response || "").trim(),
    status: "identified", custom: true, created_at: new Date(),
  };
  try {
    const dbi = await db();
    const r = await dbi.collection("audit_risks").insertOne(doc as any);
    return NextResponse.json({ ok: true, risk: shape({ ...doc, _id: r.insertedId }) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  if (!b.risk_id) return NextResponse.json({ error: "risk_id required" }, { status: 400 });
  const clamp = (n: any) => Math.min(3, Math.max(1, Number(n) || 1));
  const $set: any = { updated_at: new Date() };
  if ("likelihood" in b) $set.likelihood = clamp(b.likelihood);
  if ("impact" in b) $set.impact = clamp(b.impact);
  if ("response" in b) $set.response = String(b.response || "").trim();
  if ("status" in b) {
    if (!["identified", "addressed"].includes(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    $set.status = b.status;
  }
  try {
    const dbi = await db();
    await dbi.collection("audit_risks").updateOne(
      { _id: new ObjectId(String(b.risk_id)), engagement_id: new ObjectId(id) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
