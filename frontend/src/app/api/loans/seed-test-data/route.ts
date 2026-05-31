// POST → seeds sample loan applications (Principal+ only, idempotent via `seeded`).
// One strong borrower and one with gaps, so the score card and pipeline both demo.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";

const SEEDS = [
  {
    business_name: "Sample Momase Hardware Ltd",
    contact_name: "John Kaupa", contact_email: "demo+strong@example.com",
    contact_phone: "+675 7200 1111", industry: "Retail / hardware",
    purpose: "expansion", loan_amount: 300_000, term_years: 5, interest_rate: 10,
    lender: "BSP", status: "intake",
    financials: {
      current_assets: 300_000, current_liabilities: 150_000, inventory: 50_000,
      total_assets: 1_000_000, total_liabilities: 400_000, total_equity: 600_000,
      revenue: 800_000, net_profit: 120_000, ebitda: 250_000,
      existing_annual_debt_service: 20_000,
      loan_amount: 300_000, interest_rate: 10, term_years: 5, collateral_value: 600_000,
    },
    checklist: {},
    notes: "Strong borrower — should score loan-ready.",
  },
  {
    business_name: "Sample Coastal Transport Ltd",
    contact_name: "Mary Karu", contact_email: "demo+weak@example.com",
    contact_phone: "+675 7300 2222", industry: "Transport / logistics",
    purpose: "working_capital", loan_amount: 300_000, term_years: 4, interest_rate: 12,
    lender: null, status: "intake",
    financials: {
      current_assets: 80_000, current_liabilities: 120_000, inventory: 60_000,
      total_assets: 400_000, total_liabilities: 360_000, total_equity: 40_000,
      revenue: 500_000, net_profit: 5_000, ebitda: 30_000,
      existing_annual_debt_service: 40_000,
      loan_amount: 300_000, interest_rate: 12, term_years: 4, collateral_value: 250_000,
    },
    checklist: {},
    notes: "Thin liquidity and high leverage — should surface gaps to close first.",
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
      const existing = await dbi.collection("loan_applications").findOne({ business_name: s.business_name, seeded: true });
      if (existing) { skipped++; continue; }
      await dbi.collection("loan_applications").insertOne({
        ...s, seeded: true, created_by: u.email, created_at: new Date(),
      });
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped, total: SEEDS.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
