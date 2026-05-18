// PATCH a user (first/last name, email, role, company, is_active).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId, ROLE_CLEARANCE, clearanceOf } from "../../_auth";
import { logAudit } from "../../_audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { uid } = await params;
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };
  const changes: Record<string, { from: any; to: any }> = {};

  if ("role" in b) {
    if (!ROLE_CLEARANCE.hasOwnProperty(b.role)) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
    if (clearanceOf(b.role) >= u.clearance && u.clearance < 4) {
      return NextResponse.json({ error: "Can't promote to your own level or above." }, { status: 403 });
    }
    $set.role = b.role;
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  if ("company_id" in b) $set.company_id = b.company_id ? new ObjectId(b.company_id) : null;
  if ("first_name" in b) {
    const v = String(b.first_name || "").trim();
    if (!v) return NextResponse.json({ error: "First name cannot be blank." }, { status: 400 });
    $set.first_name = v;
  }
  if ("last_name" in b) {
    const v = String(b.last_name || "").trim();
    if (!v) return NextResponse.json({ error: "Last name cannot be blank." }, { status: 400 });
    $set.last_name = v;
  }
  if ("title" in b) {
    $set.title = String(b.title || "").trim().slice(0, 80);
  }
  if ("email" in b) {
    const v = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    $set.email = v;
  }

  try {
    const dbi = await db();
    // Robust lookup: handle legacy string `_id`s, JWT drift, and self-edit
    // fallback by email (the auth token's email is authoritative for self).
    const candidates: any[] = [];
    try { candidates.push({ _id: new ObjectId(uid) }); } catch {}
    candidates.push({ _id: uid as any });
    if (uid === u.uid && u.email) candidates.push({ email: u.email });
    const target: any = await dbi.collection("users").findOne({ $or: candidates });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Users can always edit their own first/last name regardless of clearance comparison.
    // For other fields, target's clearance must not exceed caller's.
    const selfEdit = target._id.toString() === u.uid;
    const onlyNameChanges = Object.keys($set).every((k) => ["first_name", "last_name", "title", "updated_at"].includes(k));
    if (!selfEdit && !onlyNameChanges && clearanceOf(target.role) > u.clearance) {
      return NextResponse.json({ error: "Cannot modify a user above your clearance." }, { status: 403 });
    }

    // Email uniqueness check
    if ("email" in $set && $set.email !== target.email) {
      const dup = await dbi.collection("users").findOne({ email: $set.email, _id: { $ne: target._id } });
      if (dup) return NextResponse.json({ error: "Another user already has that email." }, { status: 409 });
    }

    // Build change map for audit
    const compareFields = ["first_name", "last_name", "title", "email", "role", "is_active"];
    for (const k of compareFields) {
      if (k in $set && $set[k] !== (target[k] ?? (k === "is_active" ? 1 : ""))) {
        changes[k] = { from: target[k] ?? null, to: $set[k] };
      }
    }
    if ("company_id" in b) {
      const before = target.company_id ? target.company_id.toString() : null;
      const after = b.company_id || null;
      if (before !== after) changes.company_id = { from: before, to: after };
    }

    await dbi.collection("users").updateOne({ _id: target._id }, { $set });

    if (Object.keys(changes).length) {
      await logAudit({
        actor_email: u.email, actor_kind: "user",
        action: "user.update",
        resource_type: "user", resource_id: uid,
        details: { target_email: $set.email || target.email, changes },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
