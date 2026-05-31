// AR invoices for one company.
//   GET  → list invoices (most recent first; optional ?status= filter).
//   POST → create a draft invoice (bookkeeper+).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";
import { createInvoice } from "../../../../_ar";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}

function view(inv: any) {
  return {
    id: inv._id.toString(),
    invoice_ref: inv.invoice_ref, invoice_no: inv.invoice_no,
    customer_id: inv.customer_id?.toString(), customer_name: inv.customer_name,
    date: inv.date, due_date: inv.due_date,
    lines: inv.lines, subtotal: inv.subtotal, gst: inv.gst, total: inv.total,
    amount_paid: inv.amount_paid || 0, status: inv.status,
    gl_entry_ref: inv.gl_entry_ref || null, notes: inv.notes,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const dbi = await db();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const q: any = { company_id: new ObjectId(id) };
    if (status) q.status = status;
    const rows = await dbi.collection("ar_invoices")
      .find(q).sort({ invoice_no: -1 }).limit(500).toArray();
    return NextResponse.json({ invoices: rows.map(view) });
  } catch (e: any) {
    console.error("[teebeepay/ar/invoices GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  const b = await req.json().catch(() => ({} as any));
  try {
    const dbi = await db();
    const inv = await createInvoice(dbi, id, b, u!.uid);
    return NextResponse.json({ ok: true, invoice: view(inv) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 400 });
  }
}
