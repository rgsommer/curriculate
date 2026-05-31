// POST → seeds sample tax returns (Principal+ only, idempotent via `seeded`).
// Gives Theresia ready-made returns to walk the draft→prepared→reviewed→filed flow.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";

const SEEDS = [
  {
    taxpayer_name: "Sample Highlands Trading Ltd",
    tin: "500100100",
    tax_type: "cit",
    period: "FY2025",
    fy_end: "2025-12-31",
    status: "draft",
    inputs: {
      accounting_profit: 1_000_000,
      resident: true,
      adjustments: [
        { label: "Entertainment (non-deductible)", kind: "add_back", amount: 200_000 },
        { label: "Tax depreciation", kind: "deduction", amount: 50_000 },
      ],
      credits: [{ label: "Provisional tax paid", amount: 120_000 }],
    },
    notes: "Resident company. Taxable income K1.15M → tax K345k at 30%, less provisional credit.",
  },
  {
    taxpayer_name: "Sample — Joseph Yali (individual)",
    tin: "700200200",
    tax_type: "individual",
    period: "2025",
    fy_end: "2025-12-31",
    status: "draft",
    inputs: { taxable_income: 85_000 },
    notes: "Resident individual on the marginal scale.",
  },
  {
    taxpayer_name: "Sample Retail PNG Ltd — GST",
    tin: "500300300",
    tax_type: "gst",
    period: "2025-11",
    fy_end: null,
    status: "draft",
    inputs: { taxable_sales: 420_000, creditable_purchases: 180_000 },
    notes: "November monthly GST return. Output less input at 10%.",
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
      const existing = await dbi.collection("tax_returns").findOne({ taxpayer_name: s.taxpayer_name, seeded: true });
      if (existing) { skipped++; continue; }
      await dbi.collection("tax_returns").insertOne({
        ...s, seeded: true, created_by: u.email, created_at: new Date(),
      });
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped, total: SEEDS.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
