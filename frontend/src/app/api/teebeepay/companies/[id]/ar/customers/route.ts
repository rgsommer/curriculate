// AR customers for one company.
//   GET  → list customers (most recent first).
//   POST → create a customer (bookkeeper+).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";
import { createCustomer } from "../../../../_ar";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const dbi = await db();
    const rows = await dbi.collection("ar_customers")
      .find({ company_id: new ObjectId(id) }).sort({ created_at: -1 }).toArray();
    const customers = rows.map((c: any) => ({
      id: c._id.toString(), name: c.name, email: c.email, phone: c.phone, address: c.address,
    }));
    return NextResponse.json({ customers });
  } catch (e: any) {
    console.error("[teebeepay/ar/customers GET] error:", e);
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
    const c = await createCustomer(dbi, id, b, u!.uid);
    return NextResponse.json({ ok: true, id: c._id.toString(), name: c.name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 400 });
  }
}
