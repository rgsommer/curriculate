// frontend/src/app/api/teebeepay/service-fees/route.ts
// GET   → list of active+inactive service-fee recipients
// POST  → create a new recipient (system_owner only)
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 4) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("service_fees")
      .find({}).sort({ pct_of_gross: -1, name: 1 }).toArray();
    return NextResponse.json({
      fees: rows.map((r: any) => ({
        id: r._id.toString(),
        name: r.name,
        pct_of_gross: r.pct_of_gross,
        bank_code: r.bank_code || "088",
        branch_code: r.branch_code || null,
        account_no: r.account_no || null,
        account_name: r.account_name || null,
        is_active: r.is_active !== 0,
        notes: r.notes || null,
        created_at: r.created_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 4) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.name || b.pct_of_gross == null) {
    return NextResponse.json({ error: "Name and percent are required." }, { status: 400 });
  }
  try {
    const dbi = await db();
    const r = await dbi.collection("service_fees").insertOne({
      name: String(b.name).trim(),
      pct_of_gross: parseFloat(b.pct_of_gross) || 0,
      bank_code: String(b.bank_code || "088").trim(),
      branch_code: String(b.branch_code || "").trim() || null,
      account_no: String(b.account_no || "").trim() || null,
      account_name: String(b.account_name || "").trim() || null,
      notes: b.notes || null,
      is_active: 1,
      created_at: new Date(),
      created_by: u.email,
    });
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
