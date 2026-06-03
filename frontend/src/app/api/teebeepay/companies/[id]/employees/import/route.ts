// frontend/src/app/api/teebeepay/companies/[id]/employees/import/route.ts
//
// POST { csv: "<full CSV text>" } → bulk-imports employees from a CSV
// matching the legacy "PNGPay Bulk Employees" sheet layout.
//
// Headers (case-insensitive, extras ignored):
//   fname, lname, account_name, bank_code, branch_code, bank_account, percentage,
//   position, department, dob, datestarted, residency, declaration, company,
//   anual_price, hour_price, hours, fte, email, phone, dependents, nas,
//   allowance_housetype, allowance_vehicle, allowance_fuel, meals, school_fees,
//   leave_fares, allowance_electricity, allowance_gas, allowance_phone,
//   allowance_airfares, vol_salary, vol_ncsl, notes, residency_status, status.
//
// Returns { ok, created, skipped, errors[] }
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toNum(s: any): number {
  if (s == null) return 0;
  const t = String(s).replace(/[", ]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}
function clean(s: any): string {
  return String(s ?? "").trim();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const csv = String(body.csv || "");
  if (!csv.trim()) return NextResponse.json({ error: "Empty CSV." }, { status: 400 });

  const rows = parseCsv(csv).filter((r) => r.length > 1 && r.some((c) => c.trim().length > 0));
  if (rows.length < 2) return NextResponse.json({ error: "CSV must include a header row plus at least one data row." }, { status: 400 });

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const idx: Record<string, number> = {
    fname: col("fname"), lname: col("lname"),
    account_name: col("account_name"),
    bank_code: col("bank_code"), branch_code: col("branch_code"),
    bank_account: col("bank_account"),
    position: col("position"), department: col("department"),
    dob: col("dob"), datestarted: col("datestarted"),
    anual_price: col("anual_price") >= 0 ? col("anual_price") : col("annual_price"), // accept the correct spelling too
    hour_price: col("hour_price"),
    hours: col("hours"), fte: col("fte"),
    email: col("email"), phone: col("phone"),
    dependents: col("dependents"), nas: col("nas"),
    allowance_housetype: col("allowance_housetype"),
    allowance_vehicle: col("allowance_vehicle"),
    allowance_fuel: col("allowance_fuel"),
    meals: col("meals"), school_fees: col("school_fees"),
    leave_fares: col("leave_fares"),
    allowance_electricity: col("allowance_electricity"),
    allowance_gas: col("allowance_gas"),
    allowance_phone: col("allowance_phone"),
    allowance_airfares: col("allowance_airfares"),
    vol_salary: col("vol_salary"), vol_ncsl: col("vol_ncsl"),
    notes: col("notes"), residency_status: col("residency_status"),
    declaration: col("declaration"),
    status: col("status"),
  };
  if (idx.fname < 0 || idx.lname < 0) {
    return NextResponse.json({ error: "CSV must include 'fname' and 'lname' columns." }, { status: 400 });
  }

  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const company: any = await dbi.collection("companies").findOne({ _id: cid });
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

    // helpers: dept + job auto-create
    const deptCache = new Map<string, any>();
    const ensureDept = async (name: string) => {
      if (!name) return null;
      if (deptCache.has(name)) return deptCache.get(name);
      const existing = await dbi.collection("departments").findOne({ company_id: cid, name });
      if (existing) { deptCache.set(name, existing._id); return existing._id; }
      const r = await dbi.collection("departments").insertOne({ company_id: cid, name, created_at: new Date() });
      deptCache.set(name, r.insertedId); return r.insertedId;
    };
    const jobCache = new Map<string, any>();
    const ensureJob = async (name: string) => {
      if (!name) return null;
      if (jobCache.has(name)) return jobCache.get(name);
      const existing = await dbi.collection("job_functions").findOne({ company_id: cid, name });
      if (existing) { jobCache.set(name, existing._id); return existing._id; }
      const r = await dbi.collection("job_functions").insertOne({ company_id: cid, name, created_at: new Date() });
      jobCache.set(name, r.insertedId); return r.insertedId;
    };

    let created = 0, skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const fname = clean(r[idx.fname]);
      const lname = clean(r[idx.lname]);
      if (!fname || !lname) { skipped++; continue; }

      try {
        // Skip if same (first+last) already exists in this company.
        const fnRe = new RegExp("^" + fname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        const lnRe = new RegExp("^" + lname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        const dupe = await dbi.collection("employees").findOne({
          company_id: cid, first_name: fnRe, last_name: lnRe,
        });
        if (dupe) { skipped++; continue; }

        const annual = idx.anual_price >= 0 ? toNum(r[idx.anual_price]) : 0;
        const hourly = idx.hour_price >= 0 ? toNum(r[idx.hour_price]) : 0;

        const doc: any = {
          company_id: cid,
          first_name: fname, last_name: lname,
          email: idx.email >= 0 ? (clean(r[idx.email]).toLowerCase() || null) : null,
          phone: idx.phone >= 0 ? clean(r[idx.phone]) || null : null,
          dob: idx.dob >= 0 ? clean(r[idx.dob]) || null : null,
          start_date: idx.datestarted >= 0 ? clean(r[idx.datestarted]) || null : null,
          is_active: idx.status >= 0 && clean(r[idx.status]) === "0" ? 0 : 1,
          pay_type: annual > 0 ? "salary" : "hourly",
          annual_salary: annual > 0 ? annual : null,
          hourly_rate:   annual > 0 ? null : (hourly || 0),
          default_hours: idx.hours >= 0 ? toNum(r[idx.hours]) || null : null,
          fte_pct: idx.fte >= 0 ? toNum(r[idx.fte]) || 100 : 100,
          dependents: idx.dependents >= 0 ? parseInt(clean(r[idx.dependents]) || "0", 10) : 0,
          residency_status: idx.residency_status >= 0 && /non/i.test(clean(r[idx.residency_status])) ? "non_resident" : "resident",
          declaration_lodged: idx.declaration >= 0 ? /^y/i.test(clean(r[idx.declaration])) : true,
          bank_code:         idx.bank_code >= 0 ? clean(r[idx.bank_code]) || "088" : "088",
          branch_code:       idx.branch_code >= 0 ? clean(r[idx.branch_code]) || null : null,
          bank_account_no:   idx.bank_account >= 0 ? clean(r[idx.bank_account]) || null : null,
          bank_account_name: idx.account_name >= 0 ? clean(r[idx.account_name]) || null : null,
          department_id: await ensureDept(idx.department >= 0 ? clean(r[idx.department]) : ""),
          job_function_id: await ensureJob(idx.position >= 0 ? clean(r[idx.position]) : ""),
          // standing allowances/deductions from the legacy spreadsheet
          meals_allowance:        idx.meals >= 0 ? toNum(r[idx.meals]) : 0,
          school_fees_allowance:  idx.school_fees >= 0 ? toNum(r[idx.school_fees]) : 0,
          leave_fares_allowance:  idx.leave_fares >= 0 ? toNum(r[idx.leave_fares]) : 0,
          electricity_allowance:  idx.allowance_electricity >= 0 ? toNum(r[idx.allowance_electricity]) : 0,
          gas_allowance:          idx.allowance_gas >= 0 ? toNum(r[idx.allowance_gas]) : 0,
          phone_allowance:        idx.allowance_phone >= 0 ? toNum(r[idx.allowance_phone]) : 0,
          airfares_allowance:     idx.allowance_airfares >= 0 ? toNum(r[idx.allowance_airfares]) : 0,
          salary_sacrifice:       idx.vol_salary >= 0 ? toNum(r[idx.vol_salary]) : 0,
          ncsl_voluntary:         idx.vol_ncsl >= 0 ? toNum(r[idx.vol_ncsl]) : 0,
          nas_extra_pct:          idx.nas >= 0 ? toNum(r[idx.nas]) : 0,
          notes:                  idx.notes >= 0 ? clean(r[idx.notes]) || null : null,
          imported_from_csv: true,
          created_at: new Date(),
        };
        await dbi.collection("employees").insertOne(doc);
        created++;
      } catch (e: any) {
        errors.push(`Row ${i + 1} (${fname} ${lname}): ${e?.message || e}`);
      }
    }
    return NextResponse.json({ ok: true, created, skipped, errors });
  } catch (e: any) {
    console.error("[teebeepay/employees/import] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
