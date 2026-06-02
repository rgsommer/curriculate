// POST → upload a supporting document for a tax return (Principal+). Auto-files
//         into the right checklist slot by filename when slot is "auto"/blank.
// GET  → list supporting documents for the return.
//
// Storage: GridFS bucket "tax_files".
import { NextResponse } from "next/server";
import { GridFSBucket } from "mongodb";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { classifyTaxSlot, checklistForTaxType } from "../../../_docs";

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any;
  try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const ret: any = await dbi.collection("tax_returns").findOne({ _id: oid });
    if (!ret) return NextResponse.json({ error: "Return not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const requested = String(form.get("slot") || "");
    if (!file) return NextResponse.json({ error: "Missing file field." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.` }, { status: 413 });

    let slot = requested;
    let autoClassified = false;
    if (!slot || slot === "auto") {
      const allowed = checklistForTaxType(String(ret.tax_type || "")).map((i) => i.slot);
      const guess = classifyTaxSlot(file.name, allowed);
      slot = guess.score > 0 ? guess.slot : "other";
      autoClassified = true;
    }

    const bucket = new GridFSBucket(dbi as any, { bucketName: "tax_files" });
    const stream = bucket.openUploadStream(file.name, {
      metadata: { return_id: oid, slot, mime: file.type || "application/octet-stream", uploaded_by: u.email, uploaded_at: new Date(), original_size: file.size },
    });
    const buf = Buffer.from(await file.arrayBuffer());
    await new Promise<void>((resolve, reject) => { stream.once("error", reject); stream.once("finish", () => resolve()); stream.end(buf); });

    await dbi.collection("tax_returns").updateOne({ _id: oid }, { $set: { updated_at: new Date(), last_upload_at: new Date(), last_upload_by: u.email } });

    return NextResponse.json({ ok: true, file: { id: stream.id.toString(), filename: file.name, size: file.size, mime: file.type, slot, auto_classified: autoClassified } });
  } catch (e: any) {
    console.error("[tax/files POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any;
  try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }
  try {
    const dbi = await db();
    const files: any[] = await dbi.collection("tax_files.files").find({ "metadata.return_id": oid }).sort({ uploadDate: -1 }).toArray();
    return NextResponse.json({
      files: files.map((f: any) => ({
        id: f._id.toString(), filename: f.filename, size: f.length, upload_date: f.uploadDate,
        slot: f.metadata?.slot || "other", mime: f.metadata?.mime || "application/octet-stream", uploaded_by: f.metadata?.uploaded_by || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
