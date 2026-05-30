// A single loan-preparation application.
//   GET   → the application with its live readiness score.
//   PATCH → by `action`:
//             save_financials — store the financial inputs (re-scored on read)
//             update_meta     — facility terms / contact / lender / notes
//             toggle_doc      — flip a package-checklist item (`key`, `value`)
//             assess          — intake → assessed (needs financials; stamps assessor)
//             package_ready   — assessed → package_ready (needs full checklist)
//             submit          — package_ready → submitted (stamps submit date)
//             reopen          — back to intake, clears stamps
//   DELETE → remove an application (not once submitted).
// Principal+ only.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../teebeepay/_auth";
import { shapeApplication, PACKAGE_CHECKLIST } from "../../_scoring";

async function load(id: string) {
  const dbi = await db();
  const row: any = await dbi.collection("loan_applications").findOne({ _id: new ObjectId(id) });
  return { dbi, row };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const { row } = await load(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ application: shapeApplication(row) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

const FIN_FIELDS = [
  "current_assets", "current_liabilities", "inventory", "total_assets",
  "total_liabilities", "total_equity", "revenue", "net_profit", "ebitda",
  "existing_annual_debt_service",
];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  if (!b.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
    const { dbi, row } = await load(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const now = new Date();
    const $set: any = { updated_at: now };

    switch (b.action) {
      case "save_financials": {
        const inc = b.financials || {};
        // Pull the balance-sheet/P&L fields from the body; the facility terms
        // (loan_amount/rate/term/collateral) come from the application record so
        // the score always reflects the agreed facility.
        const fin: any = {};
        for (const k of FIN_FIELDS) fin[k] = Number(inc[k]) || 0;
        fin.loan_amount = Number(row.loan_amount) || 0;
        fin.interest_rate = Number(row.interest_rate) || 0;
        fin.term_years = Number(row.term_years) || 1;
        fin.collateral_value = Number(inc.collateral_value) || 0;
        $set.financials = fin;
        break;
      }
      case "update_meta": {
        if ("business_name" in b) {
          const v = String(b.business_name || "").trim();
          if (!v) return NextResponse.json({ error: "business_name cannot be empty" }, { status: 400 });
          $set.business_name = v;
        }
        for (const k of ["contact_name", "contact_email", "contact_phone", "industry", "purpose", "lender", "notes"]) {
          if (k in b) $set[k] = String(b[k] || "").trim() || null;
        }
        // Changing facility terms re-scores against the stored financials.
        let termsChanged = false;
        if ("loan_amount" in b) { const v = Number(b.loan_amount); if (Number.isFinite(v) && v > 0) { $set.loan_amount = Math.round(v * 100) / 100; termsChanged = true; } }
        if ("term_years" in b) { const v = Number(b.term_years); if (v > 0) { $set.term_years = v; termsChanged = true; } }
        if ("interest_rate" in b) { const v = Number(b.interest_rate); if (v >= 0) { $set.interest_rate = v; termsChanged = true; } }
        if (termsChanged && row.financials) {
          $set.financials = {
            ...row.financials,
            loan_amount: $set.loan_amount ?? row.loan_amount,
            term_years: $set.term_years ?? row.term_years,
            interest_rate: $set.interest_rate ?? row.interest_rate,
          };
        }
        break;
      }
      case "toggle_doc": {
        if (!b.key || !PACKAGE_CHECKLIST.some((c) => c.key === b.key))
          return NextResponse.json({ error: "unknown checklist key" }, { status: 400 });
        $set[`checklist.${b.key}`] = !!b.value;
        break;
      }
      case "assess":
        if (!row.financials) return NextResponse.json({ error: "Enter the financials before assessing" }, { status: 409 });
        $set.status = "assessed"; $set.assessed_by = u.email; $set.assessed_at = now;
        break;
      case "package_ready": {
        if (row.status !== "assessed" && row.status !== "package_ready")
          return NextResponse.json({ error: "Application must be assessed first" }, { status: 409 });
        const missing = PACKAGE_CHECKLIST.filter((c) => !row.checklist?.[c.key]);
        if (missing.length) return NextResponse.json({ error: `${missing.length} package document(s) still outstanding` }, { status: 409 });
        $set.status = "package_ready";
        break;
      }
      case "submit":
        if (row.status !== "package_ready") return NextResponse.json({ error: "Package must be ready before submitting to a lender" }, { status: 409 });
        $set.status = "submitted"; $set.submitted_at = now;
        if (b.lender) $set.lender = String(b.lender).trim();
        break;
      case "reopen":
        $set.status = "intake";
        $set.assessed_by = null; $set.assessed_at = null; $set.submitted_at = null;
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${b.action}` }, { status: 400 });
    }

    await dbi.collection("loan_applications").updateOne({ _id: new ObjectId(id) }, { $set });
    const fresh: any = await dbi.collection("loan_applications").findOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true, application: shapeApplication(fresh) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const { dbi, row } = await load(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status === "submitted") return NextResponse.json({ error: "Submitted applications cannot be deleted" }, { status: 409 });
    await dbi.collection("loan_applications").deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
