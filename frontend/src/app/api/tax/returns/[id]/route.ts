// A single tax return.
//   GET   → the return with its live-computed result.
//   PATCH → by `action`:
//             save_inputs  — store the computation inputs (recomputed on read)
//             update_meta  — taxpayer/tin/period/fy_end/notes/irc_reference
//             prepare      — draft → prepared   (stamps preparer)
//             review       — prepared → reviewed (stamps reviewer)
//             file         — reviewed → filed    (stamps filer; needs irc_reference)
//             reopen       — back to draft, clears all sign-off stamps
//   DELETE → remove a draft return.
// Principal+ only. The preparer of a return may not also review it.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../teebeepay/_auth";
import { shapeReturn, computeReturn, type TaxType } from "../../_engine";

async function load(id: string) {
  const dbi = await db();
  const row: any = await dbi.collection("tax_returns").findOne({ _id: new ObjectId(id) });
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
    return NextResponse.json({ return: shapeReturn(row) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

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
    const type: TaxType = row.tax_type;

    switch (b.action) {
      case "save_inputs": {
        // Validate by attempting a computation; reject if it throws.
        const inputs = b.inputs || {};
        try { computeReturn(type, inputs); }
        catch { return NextResponse.json({ error: "Invalid computation inputs" }, { status: 400 }); }
        $set.inputs = inputs;
        // Editing the numbers re-opens a reviewed/filed return back to prepared
        // at most — you cannot silently change a filed return's figures.
        if (row.status === "reviewed" || row.status === "filed") {
          $set.status = "prepared";
          $set.reviewed_by = null; $set.reviewed_at = null;
          $set.filed_by = null; $set.filed_at = null;
        }
        break;
      }
      case "update_meta": {
        if ("taxpayer_name" in b) {
          const v = String(b.taxpayer_name || "").trim();
          if (!v) return NextResponse.json({ error: "taxpayer_name cannot be empty" }, { status: 400 });
          $set.taxpayer_name = v;
        }
        if ("tin" in b) $set.tin = String(b.tin || "").trim() || null;
        if ("period" in b) $set.period = String(b.period || "").trim() || null;
        if ("fy_end" in b) $set.fy_end = String(b.fy_end || "").trim() || null;
        if ("notes" in b) $set.notes = String(b.notes || "").trim() || null;
        if ("irc_reference" in b) $set.irc_reference = String(b.irc_reference || "").trim() || null;
        break;
      }
      case "prepare":
        if (!row.inputs) return NextResponse.json({ error: "Enter the computation before marking prepared" }, { status: 409 });
        $set.status = "prepared"; $set.prepared_by = u.email; $set.prepared_at = now;
        break;
      case "review":
        if (row.status !== "prepared") return NextResponse.json({ error: "Return must be prepared before review" }, { status: 409 });
        if (row.prepared_by && row.prepared_by === u.email)
          return NextResponse.json({ error: "The preparer cannot also review this return" }, { status: 409 });
        $set.status = "reviewed"; $set.reviewed_by = u.email; $set.reviewed_at = now;
        break;
      case "file": {
        if (row.status !== "reviewed") return NextResponse.json({ error: "Return must be reviewed before filing" }, { status: 409 });
        const ref = String(b.irc_reference || row.irc_reference || "").trim();
        if (!ref) return NextResponse.json({ error: "irc_reference required to file" }, { status: 400 });
        $set.status = "filed"; $set.filed_by = u.email; $set.filed_at = now; $set.irc_reference = ref;
        break;
      }
      case "reopen":
        $set.status = "draft";
        $set.prepared_by = null; $set.prepared_at = null;
        $set.reviewed_by = null; $set.reviewed_at = null;
        $set.filed_by = null; $set.filed_at = null;
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${b.action}` }, { status: 400 });
    }

    await dbi.collection("tax_returns").updateOne({ _id: new ObjectId(id) }, { $set });
    const fresh: any = await dbi.collection("tax_returns").findOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true, return: shapeReturn(fresh) });
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
    if (row.status === "filed") return NextResponse.json({ error: "Filed returns cannot be deleted" }, { status: 409 });
    await dbi.collection("tax_returns").deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
