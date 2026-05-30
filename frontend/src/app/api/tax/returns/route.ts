// Tax-return register.
//   GET  → list every return (Principal+), newest first.
//   POST → create a return (taxpayer, TIN, type, period). Starts in "draft".
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import { isTaxType, shapeReturn as shape, type TaxType } from "../_engine";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("tax_returns").find({})
      .sort({ created_at: -1 }).limit(300).toArray();
    return NextResponse.json({ returns: rows.map(shape) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.taxpayer_name || !String(b.taxpayer_name).trim())
    return NextResponse.json({ error: "taxpayer_name is required" }, { status: 400 });
  if (!isTaxType(b.tax_type))
    return NextResponse.json({ error: "tax_type must be cit, individual, or gst" }, { status: 400 });

  const doc = {
    taxpayer_name: String(b.taxpayer_name).trim(),
    tin: String(b.tin || "").trim() || null,
    tax_type: b.tax_type as TaxType,
    period: String(b.period || "").trim() || null,
    fy_end: String(b.fy_end || "").trim() || null,
    status: "draft",
    inputs: null,
    notes: String(b.notes || "").trim() || null,
    created_by: u.email,
    created_at: new Date(),
  };
  try {
    const dbi = await db();
    const r = await dbi.collection("tax_returns").insertOne(doc as any);
    return NextResponse.json({ ok: true, return: shape({ ...doc, _id: r.insertedId }) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
