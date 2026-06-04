// frontend/src/app/api/teebeepay/companies/[id]/employees/[eid]/route.ts
// PATCH update; GET single employee.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

// Normalise the multi-account split array the edit dialog sends. Drops blank
// rows, coerces percentage to a number, defaults bank code. Returns [] if none.
function cleanBankAccounts(arr: any): any[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a: any) => ({
      bank_code: String(a?.bank_code || "").trim() || "088",
      branch_code: String(a?.branch_code || "").trim(),
      account_no: String(a?.account_no || "").trim(),
      account_name: String(a?.account_name || "").trim(),
      percentage: Number(a?.percentage) || 0,
    }))
    .filter((a) => a.account_no || a.account_name);
}

const SETTABLE = [
  "first_name", "last_name", "email", "dob", "start_date", "end_date",
  "pay_type", "annual_salary", "hourly_rate", "default_hours", "fte_pct",
  "dependents", "residency_status", "declaration_lodged",
  "bank_account_no", "bank_account_name", "branch_code", "bank_code",
  "housing_allowance", "vehicle_allowance", "fuel_allowance", "meals_allowance",
  "school_fees_allowance", "leave_fares_allowance", "electricity_allowance",
  "gas_allowance", "phone_allowance", "airfares_allowance", "extra_allowance",
  "salary_sacrifice", "ncsl_voluntary", "nas_extra_pct",
  "savings_deduction", "christmas_bonus", "loan_repayment", "education_deduction",
];

export async function GET(req: Request, { params }: { params: Promise<{ id: string; eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, eid } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const e: any = await dbi.collection("employees").findOne({ _id: new ObjectId(eid), company_id: new ObjectId(id) });
    if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((e.clearance_level || 0) >= u.clearance) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({
      employee: {
        ...e, id: e._id.toString(), _id: undefined,
        pay_history: Array.isArray(e.pay_history) ? e.pay_history : [],
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; eid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, eid } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };
  for (const k of SETTABLE) {
    if (k in b) {
      const v = b[k];
      $set[k] = typeof v === "string" ? v.trim() : v;
      if (["annual_salary", "hourly_rate", "default_hours", "fte_pct", "dependents",
           "housing_allowance", "vehicle_allowance", "fuel_allowance", "meals_allowance",
           "school_fees_allowance", "leave_fares_allowance", "electricity_allowance",
           "gas_allowance", "phone_allowance", "airfares_allowance", "extra_allowance",
           "salary_sacrifice", "ncsl_voluntary", "nas_extra_pct",
           "savings_deduction", "christmas_bonus", "loan_repayment", "education_deduction",
          ].includes(k)) {
        $set[k] = v === "" || v == null ? null : Number(v);
      }
    }
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  if ("division_id" in b) {
    $set.division_id = b.division_id ? new ObjectId(String(b.division_id)) : null;
  }
  try {
    const dbi = await db();
    const filter = { _id: new ObjectId(eid), company_id: new ObjectId(id) };
    const $unset: any = {};
    let rehired = false;
    // Bank accounts: persist the split array and keep the legacy single-account
    // mirrors in sync with the primary account (the bank file + stubs read both).
    if ("bank_accounts" in b) {
      const cleaned = cleanBankAccounts(b.bank_accounts);
      if (cleaned.length) {
        $set.bank_accounts = cleaned;
        const p = cleaned[0];
        $set.bank_account_no = p.account_no || null;
        $set.bank_account_name = p.account_name || null;
        $set.branch_code = p.branch_code || null;
        $set.bank_code = p.bank_code || "088";
      } else {
        $unset.bank_accounts = "";
      }
    }
    // Re-employment: when an inactive employee is switched back to active,
    // they were likely terminated (final pay stamps is_active:0 + terminated_at).
    // Clear the termination markers so the record reads as a current employee
    // again, and stamp rehired_at for history. Any outstanding advance balance
    // is deliberately LEFT in place — if they still owe, payroll resumes
    // recovering it on their next run.
    if ($set.is_active === 1) {
      const cur: any = await dbi.collection("employees").findOne(filter, { projection: { is_active: 1, terminated_at: 1 } });
      if (cur && (cur.is_active === 0 || cur.terminated_at)) {
        rehired = true;
        $set.rehired_at = new Date();
        $unset.terminated_at = "";
        if (!("end_date" in b)) $unset.end_date = "";
      }
    }
    const update: any = { $set };
    if (Object.keys($unset).length) update.$unset = $unset;
    await dbi.collection("employees").updateOne(filter, update);
    return NextResponse.json({ ok: true, rehired });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
