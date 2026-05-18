// frontend/src/app/api/teebeepay/companies/route.ts
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

const DEFAULT_PNG_RULES = {
  verified_at: "2026-05-17",
  bracket_interval: "fortnightly",
  currency: "PGK",
  swt_brackets: [
    { up_to: 769.23,  rate: 0.00 },
    { up_to: 1269.23, rate: 0.30 },
    { up_to: 2692.31, rate: 0.35 },
    { up_to: 9615.38, rate: 0.40 },
    { up_to: null,    rate: 0.42 },
  ],
  swt_brackets_no_declaration: [
    { up_to: 1269.23, rate: 0.22 },
    { up_to: 2692.31, rate: 0.35 },
    { up_to: 9615.38, rate: 0.40 },
    { up_to: null,    rate: 0.42 },
  ],
  swt_brackets_non_resident: [
    { up_to: 769.23,  rate: 0.22 },
    { up_to: 1269.23, rate: 0.30 },
    { up_to: 2692.31, rate: 0.35 },
    { up_to: 9615.38, rate: 0.40 },
    { up_to: null,    rate: 0.42 },
  ],
  dependent_rebate_annual: [
    { floor:   0, pct: 0.00, ceiling:    0 },
    { floor:  45, pct: 0.15, ceiling:  450 },
    { floor:  75, pct: 0.25, ceiling:  750 },
    { floor: 105, pct: 0.35, ceiling: 1050 },
  ],
  nasfund: { enabled: true, employee_rate: 0.06, employer_rate: 0.084, min_gross_for_contribution: 0 },
  custom_deductions: [] as any[],
  overtime: { enabled: false, threshold_hours: 80, rate_multiplier: 1.5 },
};

/* GET — list companies the authed user can see (with quick stats) */
export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();
    const query = u.clearance >= 3 ? {} : (u.company_id ? { _id: new ObjectId(u.company_id) } : { _id: null });
    const rows = await dbi.collection("companies").find(query).sort({ name: 1 }).toArray();
    const out = await Promise.all(rows.map(async (c: any) => {
      const [periods, employees, latestPeriod] = await Promise.all([
        dbi.collection("pay_periods").countDocuments({ company_id: c._id }),
        dbi.collection("employees").countDocuments({ company_id: c._id, is_active: { $ne: 0 } }),
        dbi.collection("pay_periods").find({ company_id: c._id })
          .sort({ pay_date: -1, period_end: -1, _id: -1 }).limit(1).next(),
      ]);

      // Derive a single "what needs doing" status for the company card badge:
      //   pending_approval        — period submitted, AP hasn't approved yet
      //   approved_pending_upload — period approved, BSP batch / stubs not yet sent
      //   up_to_date              — nothing outstanding
      let status: "pending_approval" | "approved_pending_upload" | "up_to_date" = "up_to_date";
      let latest: any = null;
      if (latestPeriod) {
        latest = {
          id: latestPeriod._id.toString(),
          period_start: latestPeriod.period_start,
          period_end: latestPeriod.period_end,
          pay_date: latestPeriod.pay_date,
          status: latestPeriod.status,
        };
        if (latestPeriod.status === "pending_approval") {
          status = "pending_approval";
        } else if (latestPeriod.status === "approved" && !latestPeriod.stubs_emailed_at) {
          status = "approved_pending_upload";
        }
      }

      return {
        id: c._id.toString(),
        name: c.name, abbreviation: c.abbreviation || "",
        pay_interval: c.pay_interval || "fortnightly",
        default_hours: c.default_hours || 80,
        currency: c.currency || "PGK",
        is_active: c.is_active !== 0,
        bank_code: c.bank_code || "088",
        branch_code: c.branch_code || "",
        bank_account_no: c.bank_account_no || "",
        bank_account_name: c.bank_account_name || "",
        bank_client_no: c.bank_client_no || "",
        office_email: c.office_email || "",
        manager_email: c.manager_email || "",
        payslip_message: c.payslip_message || "",
        periods, employees,
        status, latest_period: latest,
      };
    }));
    return NextResponse.json({ companies: out });
  } catch (e: any) {
    console.error("[teebeepay/companies GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/* POST — create a new company (principal+) */
export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Only a principal or system owner can add companies." }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  if (!b.name || String(b.name).trim().length < 2) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  try {
    const dbi = await db();
    const insert = {
      name: String(b.name).trim(),
      abbreviation: String(b.abbreviation || "").trim() || null,
      pay_interval: ["weekly", "fortnightly", "monthly"].includes(b.pay_interval) ? b.pay_interval : "fortnightly",
      default_hours: Number(b.default_hours) || 80,
      currency: String(b.currency || "PGK").toUpperCase().slice(0, 8),
      is_active: 1,
      bank_code: String(b.bank_code || "088").trim(),
      branch_code: String(b.branch_code || "").trim() || null,
      bank_account_no: String(b.bank_account_no || "").trim() || null,
      bank_account_name: String(b.bank_account_name || "").trim() || null,
      bank_client_no: String(b.bank_client_no || "").trim() || null,
      office_email: String(b.office_email || "").trim() || null,
      manager_email: String(b.manager_email || "").trim() || null,
      payslip_message: String(b.payslip_message || "").trim() || null,
      ncsl_employer_no: String(b.ncsl_employer_no || "").trim() || null,
      created_at: new Date(),
      created_by: u.email,
    };
    const r = await dbi.collection("companies").insertOne(insert);
    // Seed default tax rules
    await dbi.collection("tax_rules").insertOne({
      company_id: r.insertedId,
      effective_from: new Date().toISOString().slice(0, 10),
      data: DEFAULT_PNG_RULES,
      notes: "Initial defaults (PNG IRC SWT brackets effective 2023)",
      created_at: new Date(),
    });
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    console.error("[teebeepay/companies POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
