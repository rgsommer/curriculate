// POST → multipart upload (field: "file", plus optional "slot" form field).
// GET  → list files for this engagement (with metadata + slot).
//
// Storage: GridFS bucket "audit_files" (collections audit_files.files and .chunks).
// Authorization: audit_client linked to engagement, or clearance >= 3.
import { NextResponse } from "next/server";
import { GridFSBucket } from "mongodb";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB ceiling per file

async function canAccess(dbi: any, u: any, engagementId: string): Promise<boolean> {
  if (u.clearance >= 3) return true;
  const userRow: any = await dbi.collection("users").findOne({ email: u.email });
  if (!userRow?.audit_engagements?.length) return false;
  return userRow.audit_engagements.some((e: any) => e.toString() === engagementId);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const dbi = await db();
    if (!(await canAccess(dbi, u, id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const slot = String(form.get("slot") || "other");
    if (!file) return NextResponse.json({ error: "Missing file field." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({
        error: `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit. Split large GL exports by quarter.`,
      }, { status: 413 });
    }

    const bucket = new GridFSBucket(dbi as any, { bucketName: "audit_files" });
    const stream = bucket.openUploadStream(file.name, {
      metadata: {
        engagement_id: new ObjectId(id),
        slot,
        mime: file.type || "application/octet-stream",
        uploaded_by: u.email,
        uploaded_at: new Date(),
        original_size: file.size,
      },
    });
    const buf = Buffer.from(await file.arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      stream.end(buf, (err: any) => (err ? reject(err) : resolve()));
    });

    await dbi.collection("audit_engagements").updateOne({ _id: eng._id }, {
      $set: { updated_at: new Date(), last_upload_at: new Date(), last_upload_by: u.email,
               ...(eng.status === "engaged" ? { status: "active" } : {}) },
    });

    return NextResponse.json({
      ok: true,
      file: {
        id: stream.id.toString(),
        filename: file.name,
        size: file.size,
        mime: file.type,
        slot,
      },
    });
  } catch (e: any) {
    console.error("[audit/files POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const dbi = await db();
    if (!(await canAccess(dbi, u, id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const files: any[] = await dbi.collection("audit_files.files").find({
      "metadata.engagement_id": new ObjectId(id),
    }).sort({ uploadDate: -1 }).toArray();
    return NextResponse.json({
      files: files.map((f: any) => ({
        id: f._id.toString(),
        filename: f.filename,
        size: f.length,
        upload_date: f.uploadDate,
        slot: f.metadata?.slot || "other",
        mime: f.metadata?.mime || "application/octet-stream",
        uploaded_by: f.metadata?.uploaded_by || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
