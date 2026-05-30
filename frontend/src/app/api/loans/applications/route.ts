// Loan-preparation application pipeline.
//   GET  → list every application (Principal+), newest first.
//   POST → create an application from client intake. Starts in "intake".
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import { shapeApplication } from "../_scoring";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("loan_applications").find({})
      .sort({ created_at: -1 }).limit(300).toArray();
    return NextResponse.json({ applications: rows.map(shapeApplication) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.business_name || !String(b.business_name).trim())
    return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  const amt = Number(b.loan_amount);
  if (!Number.isFinite(amt) || amt <= 0)
    return NextResponse.json({ error: "loan_amount must be a positive number" }, { status: 400 });

  const doc = {
    business_name: String(b.business_name).trim(),
    contact_name: String(b.contact_name || "").trim() || null,
    contact_email: String(b.contact_email || "").trim() || null,
    contact_phone: String(b.contact_phone || "").trim() || null,
    industry: String(b.industry || "").trim() || null,
    purpose: String(b.purpose || "").trim() || null,
    loan_amount: Math.round(amt * 100) / 100,
    term_years: Number(b.term_years) > 0 ? Number(b.term_years) : 5,
    interest_rate: Number(b.interest_rate) >= 0 ? Number(b.interest_rate) : 9.5,
    lender: String(b.lender || "").trim() || null,
    status: "intake",
    financials: null,
    checklist: {},
    notes: String(b.notes || "").trim() || null,
    created_by: u.email,
    created_at: new Date(),
  };
  try {
    const dbi = await db();
    const r = await dbi.collection("loan_applications").insertOne(doc as any);
    return NextResponse.json({ ok: true, application: shapeApplication({ ...doc, _id: r.insertedId }) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
