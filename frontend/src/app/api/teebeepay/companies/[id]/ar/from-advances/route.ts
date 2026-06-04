// POST → turn outstanding staff advances for FORMER employees into AR
// receivables (a customer + a draft, non-taxable invoice per person) so they're
// visible and chaseable. Rows whose name matches an ACTIVE employee are skipped
// (those are recovered through payroll). Invoices are left as drafts — no GL is
// posted, so this never overstates revenue; the firm decides the GL treatment.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";
import { createCustomer, createInvoice } from "../../../../_ar";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}
function parseCsv(text: string): string[][] {
  return String(text || "").split(/\r?\n/).filter((l) => l.trim().length).map((l) => {
    const delim = l.includes("\t") && !l.includes(",") ? "\t" : ",";
    return l.split(delim).map((s) => s.replace(/^"|"$/g, "").trim());
  });
}
const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  let cid: any;
  try { cid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  const b = await req.json().catch(() => ({} as any));
  const rows = parseCsv(b.csv || "");
  if (rows.length < 2) return NextResponse.json({ error: "CSV must include a header row plus at least one data row." }, { status: 400 });
  const head = rows[0].map((h) => h.toLowerCase());
  const cidx = (...n: string[]) => { for (const x of n) { const i = head.indexOf(x); if (i >= 0) return i; } return -1; };
  const iFirst = cidx("first_name", "fname"), iLast = cidx("last_name", "lname"), iBal = cidx("balance", "outstanding", "loan_balance");
  if (iFirst < 0 || iLast < 0 || iBal < 0) return NextResponse.json({ error: "Need first_name, last_name and balance columns." }, { status: 400 });

  try {
    const dbi = await db();
    const emps: any[] = await dbi.collection("employees").find({ company_id: cid }).toArray();
    const active = new Set(emps.filter((e) => e.is_active !== 0).map((e) => `${String(e.last_name || "").toLowerCase()}|${String(e.first_name || "").toLowerCase()}`));
    const existingCust: any[] = await dbi.collection("ar_customers").find({ company_id: cid }).toArray();
    const custByName: Record<string, any> = {};
    for (const c of existingCust) custByName[String(c.name || "").toLowerCase()] = c;

    let created = 0, skippedActive = 0, skippedExisting = 0;
    const made: Array<{ name: string; amount: number; ref: string }> = [];
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      const fn = (c[iFirst] || "").trim(), ln = (c[iLast] || "").trim();
      const bal = Math.max(0, num(c[iBal]));
      if ((!fn && !ln) || bal <= 0) continue;
      if (active.has(`${ln.toLowerCase()}|${fn.toLowerCase()}`)) { skippedActive++; continue; }
      const name = titleCase(`${fn} ${ln}`.trim());
      if (custByName[name.toLowerCase()]) { skippedExisting++; continue; }   // don't double-create
      const customer = await createCustomer(dbi, cid, { name, address: "Former staff — advance receivable" }, u!.uid);
      custByName[name.toLowerCase()] = customer;
      const inv = await createInvoice(dbi, cid, {
        customer_id: customer._id,
        lines: [{ description: "Staff advance — outstanding balance carried forward", quantity: 1, unit_price: bal, taxable: false }],
        notes: "Former-employee staff advance carried into AR for tracking/recovery. Draft — confirm GL treatment before issuing.",
      }, u!.uid);
      made.push({ name, amount: bal, ref: inv.invoice_ref });
      created++;
    }
    return NextResponse.json({ ok: true, created, skipped_active: skippedActive, skipped_existing: skippedExisting, invoices: made });
  } catch (e: any) {
    console.error("[ar/from-advances] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
