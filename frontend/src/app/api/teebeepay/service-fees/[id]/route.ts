// PATCH update + DELETE remove a service-fee recipient (system_owner only).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

const SETTABLE = ["name", "weight", "bank_code", "branch_code", "account_no", "account_name", "notes"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 4) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };
  // Accept either legacy `pct_of_gross` or new `weight` — same numeric meaning.
  if (b.pct_of_gross != null && b.weight == null) b.weight = b.pct_of_gross;
  for (const k of SETTABLE) {
    if (k in b) {
      const v = b[k];
      $set[k] = k === "weight" ? (parseFloat(v) || 0) :
                 (typeof v === "string" ? v.trim() : v);
    }
  }
  // Also clear the legacy field on update so it doesn't drift out of sync.
  if ("weight" in $set) $set.pct_of_gross = $set.weight;
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  try {
    const dbi = await db();
    await dbi.collection("service_fees").updateOne({ _id: new ObjectId(id) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 4) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    await dbi.collection("service_fees").deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
