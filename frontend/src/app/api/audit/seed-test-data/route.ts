// POST → seeds three sample audit engagements (Principal+ only, idempotent).
// Useful for Theresia's first walk-through of the admin queue.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";

const SEEDS = [
  {
    status: "inquiry",
    company_name: "Sample Highlands Landowner Ltd",
    contact_name: "Joseph Yali", contact_role: "Director",
    contact_email: "demo+lo@example.com",
    contact_phone: "+675 7000 1234",
    audit_type: "landowner",
    revenue_band: "500k_2m",
    employee_count: 12,
    fy_end: "2026-06-30",
    notes: "First-time landowner audit. Royalty distributions to 4 ILGs. Unit-trust beneficiary register exists.",
    indicative_fee_low: 9000,
    indicative_fee_high: 17000,
    indicative_currency: "PGK",
    seeded: true,
  },
  {
    status: "inquiry",
    company_name: "Sample Trading PNG Ltd",
    contact_name: "Mary Karu", contact_role: "CFO",
    contact_email: "demo+mid@example.com",
    contact_phone: "+675 7500 9876",
    audit_type: "statutory",
    revenue_band: "2m_10m",
    employee_count: 45,
    fy_end: "2025-12-31",
    notes: "Retail importer, 3 warehouses (POM/Lae/Mt Hagen). Migrating from QuickBooks to Xero mid-year.",
    indicative_fee_low: 14000,
    indicative_fee_high: 26000,
    indicative_currency: "PGK",
    seeded: true,
  },
  {
    status: "inquiry",
    company_name: "Sample Health NGO",
    contact_name: "Dr Anna Kila", contact_role: "Executive Director",
    contact_email: "demo+ngo@example.com",
    contact_phone: "+675 7100 5555",
    audit_type: "donor_fund",
    revenue_band: "lt_500k",
    employee_count: 8,
    fy_end: "2026-03-31",
    notes: "DFAT-funded maternal health programme. K 380k grant, 18-month period. Budget-vs-actual report exists.",
    indicative_fee_low: 5000,
    indicative_fee_high: 11000,
    indicative_currency: "PGK",
    seeded: true,
  },
];

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    let inserted = 0, skipped = 0;
    for (const s of SEEDS) {
      const existing = await dbi.collection("audit_engagements").findOne({
        company_name: s.company_name, seeded: true,
      });
      if (existing) { skipped++; continue; }
      await dbi.collection("audit_engagements").insertOne({
        ...s, created_at: new Date(), created_by_seed: u.email,
      });
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped, total: SEEDS.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
