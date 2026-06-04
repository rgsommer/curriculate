// POST → import staff-advance / loan balances onto employees (Principal+ or the
// company's own admin). CSV columns (header row, case-insensitive):
//   fname|first_name, lname|last_name  — identify the employee (matched by name)
//   balance|outstanding|loan_balance   — outstanding advance to carry forward
//   per_period|repayment|loan_repayment — amount to deduct each pay period
// Sets loan_balance + loan_repayment; payroll then deducts per period (capped at
// the balance) and counts it down on approval.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

function parseCsv(text: string): string[][] {
  return String(text || "").split(/\r?\n/).filter((l) => l.trim().length).map((l) => {
    const delim = l.includes("\t") && !l.includes(",") ? "\t" : ",";
    return l.split(delim).map((s) => s.replace(/^"|"$/g, "").trim());
  });
}
const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let cid: any;
  try { cid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  const b = await req.json().catch(() => ({} as any));
  const rows = parseCsv(b.csv || "");
  if (rows.length < 2) return NextResponse.json({ error: "CSV must include a header row plus at least one data row." }, { status: 400 });

  const head = rows[0].map((h) => h.toLowerCase());
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iFirst = col("first_name", "fname"), iLast = col("last_name", "lname");
  const iBal = col("balance", "outstanding", "loan_balance");
  const iRep = col("per_period", "repayment", "loan_repayment", "amount");
  if (iFirst < 0 || iLast < 0) return NextResponse.json({ error: "CSV must include first_name/fname and last_name/lname columns." }, { status: 400 });
  if (iBal < 0) return NextResponse.json({ error: "CSV must include a balance / outstanding column." }, { status: 400 });

  try {
    const dbi = await db();
    const emps: any[] = await dbi.collection("employees").find({ company_id: cid }).toArray();
    const byName: Record<string, any> = {};
    for (const e of emps) byName[`${String(e.last_name || "").toLowerCase()}|${String(e.first_name || "").toLowerCase()}`] = e;

    let updated = 0, skipped = 0; const errors: string[] = [];
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      const fn = (c[iFirst] || "").trim(), ln = (c[iLast] || "").trim();
      if (!fn && !ln) continue;
      const e = byName[`${ln.toLowerCase()}|${fn.toLowerCase()}`];
      if (!e) { skipped++; errors.push(`No active employee match for "${fn} ${ln}".`); continue; }
      const balance = Math.max(0, num(c[iBal]));
      const set: any = { loan_balance: balance };
      if (iRep >= 0 && c[iRep] !== "" && c[iRep] != null) set.loan_repayment = Math.max(0, num(c[iRep]));
      if (balance === 0) set.loan_repayment = 0;
      await dbi.collection("employees").updateOne({ _id: e._id }, { $set: set });
      updated++;
    }
    return NextResponse.json({ ok: true, updated, skipped, errors: errors.slice(0, 30) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
