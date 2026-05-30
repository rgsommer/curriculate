// Derived GL reports for one company.
//   ?type=trial_balance   &asOf=YYYY-MM-DD
//   ?type=income_statement&from=YYYY-MM-DD&to=YYYY-MM-DD
//   ?type=balance_sheet   &asOf=YYYY-MM-DD
import { NextResponse } from "next/server";
import { readAuth, db } from "../../../../_auth";
import { trialBalance, incomeStatement, balanceSheet } from "../../../../_ledger";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "trial_balance";
  const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get("to") || asOf;
  const from = url.searchParams.get("from") || `${to.slice(0, 4)}-01-01`;

  try {
    const dbi = await db();
    if (type === "income_statement") {
      return NextResponse.json({ type, report: await incomeStatement(dbi, id, from, to) });
    }
    if (type === "balance_sheet") {
      return NextResponse.json({ type, report: await balanceSheet(dbi, id, asOf) });
    }
    return NextResponse.json({ type: "trial_balance", report: await trialBalance(dbi, id, asOf) });
  } catch (e: any) {
    console.error("[teebeepay/gl/reports] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
