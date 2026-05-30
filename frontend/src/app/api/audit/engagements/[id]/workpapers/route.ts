// Working-paper file index for an engagement, with sign-off workflow.
//   GET   → list working papers (auto-seeds the per-type program on first call).
//   PATCH → act on a working paper by `wp_id` + `action`:
//             set_procedures | prepare | review | sign_off | reopen | add_note
// Principal+ only. Sign-off is ordered: prepared → reviewed → signed_off.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { seedWorkpapersForType } from "../../../_planning";

function shape(w: any) {
  const procs = w.procedures || [];
  const done = procs.filter((p: any) => p.done).length;
  return {
    id: w._id.toString(),
    ref: w.ref, section: w.section, title: w.title,
    procedures: procs.map((p: any) => ({ text: p.text, done: !!p.done })),
    progress: procs.length ? Math.round((done / procs.length) * 100) : 0,
    status: w.status || "not_started",
    prepared_by: w.prepared_by || null, prepared_at: w.prepared_at || null,
    reviewed_by: w.reviewed_by || null, reviewed_at: w.reviewed_at || null,
    signed_off_by: w.signed_off_by || null, signed_off_at: w.signed_off_at || null,
    review_notes: (w.review_notes || []).map((n: any) => ({ by: n.by, note: n.note, at: n.at, resolved: !!n.resolved })),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    const eid = new ObjectId(id);
    let rows: any[] = await dbi.collection("audit_workpapers").find({ engagement_id: eid }).toArray();
    if (rows.length === 0) {
      const eng: any = await dbi.collection("audit_engagements").findOne({ _id: eid });
      if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const seeds = seedWorkpapersForType(eng.audit_type || "other").map((s) => ({
        engagement_id: eid, ref: s.ref, section: s.section, title: s.title,
        procedures: s.procedures.map((t) => ({ text: t, done: false })),
        status: "not_started", review_notes: [], created_at: new Date(),
      }));
      if (seeds.length) await dbi.collection("audit_workpapers").insertMany(seeds as any);
      rows = await dbi.collection("audit_workpapers").find({ engagement_id: eid }).toArray();
    }
    rows.sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
    return NextResponse.json({ workpapers: rows.map(shape) });
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
  if (!b.wp_id || !b.action) return NextResponse.json({ error: "wp_id and action required" }, { status: 400 });

  try {
    const dbi = await db();
    const filter = { _id: new ObjectId(String(b.wp_id)), engagement_id: new ObjectId(id) };
    const wp: any = await dbi.collection("audit_workpapers").findOne(filter);
    if (!wp) return NextResponse.json({ error: "Working paper not found" }, { status: 404 });
    const now = new Date();
    const $set: any = { updated_at: now };

    switch (b.action) {
      case "set_procedures": {
        const incoming: boolean[] = Array.isArray(b.done) ? b.done : [];
        $set.procedures = (wp.procedures || []).map((p: any, i: number) => ({ text: p.text, done: !!incoming[i] }));
        const allDone = $set.procedures.length > 0 && $set.procedures.every((p: any) => p.done);
        if (wp.status === "not_started" || wp.status === "in_progress") $set.status = allDone ? "in_progress" : ($set.procedures.some((p: any) => p.done) ? "in_progress" : "not_started");
        break;
      }
      case "prepare":
        $set.status = "prepared"; $set.prepared_by = u.email; $set.prepared_at = now;
        break;
      case "review":
        if (wp.status !== "prepared" && wp.status !== "reviewed") return NextResponse.json({ error: "Working paper must be prepared before review" }, { status: 409 });
        $set.status = "reviewed"; $set.reviewed_by = u.email; $set.reviewed_at = now;
        break;
      case "sign_off":
        if (wp.status !== "reviewed") return NextResponse.json({ error: "Working paper must be reviewed before partner sign-off" }, { status: 409 });
        $set.status = "signed_off"; $set.signed_off_by = u.email; $set.signed_off_at = now;
        break;
      case "reopen":
        $set.status = (wp.procedures || []).some((p: any) => p.done) ? "in_progress" : "not_started";
        $set.prepared_by = null; $set.prepared_at = null;
        $set.reviewed_by = null; $set.reviewed_at = null;
        $set.signed_off_by = null; $set.signed_off_at = null;
        break;
      case "add_note": {
        if (!b.note) return NextResponse.json({ error: "note required" }, { status: 400 });
        const note = { by: u.email, note: String(b.note).trim(), at: now, resolved: false };
        await dbi.collection("audit_workpapers").updateOne(filter, { $push: { review_notes: note }, $set: { updated_at: now } } as any);
        const fresh: any = await dbi.collection("audit_workpapers").findOne(filter);
        return NextResponse.json({ ok: true, workpaper: shape(fresh) });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${b.action}` }, { status: 400 });
    }

    await dbi.collection("audit_workpapers").updateOne(filter, { $set });
    const fresh: any = await dbi.collection("audit_workpapers").findOne(filter);
    return NextResponse.json({ ok: true, workpaper: shape(fresh) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
