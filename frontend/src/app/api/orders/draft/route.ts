// Cross-device order draft, keyed by the signed-in teacher's email. Lets a teacher
// start an order on one device and finish on another (and survive a refresh).
//   GET    ?session=...                  -> { items, teacherName } | empty
//   PUT    { session, items, teacherName } -> saves the draft
//   DELETE ?session=...                  -> clears the draft
// Drafts live in bcs_drafts (schemaless). Without a DB (local dev) this no-ops.
import { NextResponse } from "next/server";
import { sessionEmail } from "../_auth";
import { getDb } from "../_db";

export const runtime = "nodejs";

function emailFrom(req: Request, bodySession?: unknown): string | null {
  if (bodySession) return sessionEmail(bodySession);
  const url = new URL(req.url);
  const qs = url.searchParams.get("session");
  const auth = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return sessionEmail(qs || auth);
}

export async function GET(req: Request) {
  const email = emailFrom(req);
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const db = await getDb();
  if (!db) return NextResponse.json({ items: [], teacherName: "", submitted: null });
  const doc = await db.collection("bcs_drafts").findOne({ _id: email as any });
  // Also surface the teacher's current submitted order so they can re-open + amend it.
  const order = await db.collection("bcs_orders").findOne({ teacherEmail: email });
  const submitted = order
    ? {
        items: (Array.isArray(order.lines) ? order.lines : []).map((l: any) => ({ id: l.id, sku: l.sku, qty: l.qty })),
        teacherName: order.teacherName || "",
        total: Number(order.total || 0),
        revision: Number(order.revision || 1),
        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
        updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
      }
    : null;
  return NextResponse.json({
    items: Array.isArray(doc?.items) ? doc!.items : [],
    teacherName: doc?.teacherName || submitted?.teacherName || "",
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    submitted,
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = emailFrom(req, body.session);
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  // Keep only well-formed {id, sku, qty>0} entries (cap to avoid abuse).
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it: any) => ({ id: String(it?.id || ""), sku: String(it?.sku || ""), qty: Math.floor(Number(it?.qty)) }))
    .filter((it: any) => it.id && Number.isFinite(it.qty) && it.qty > 0)
    .slice(0, 2000);
  const teacherName = String(body.teacherName || "").trim().slice(0, 120);

  const db = await getDb();
  if (db) {
    await db.collection("bcs_drafts").updateOne(
      { _id: email as any },
      { $set: { items, teacherName, updatedAt: new Date() } },
      { upsert: true }
    );
  }
  return NextResponse.json({ ok: true, persisted: !!db, count: items.length });
}

export async function DELETE(req: Request) {
  const email = emailFrom(req);
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const db = await getDb();
  if (db) await db.collection("bcs_drafts").deleteOne({ _id: email as any });
  return NextResponse.json({ ok: true });
}
