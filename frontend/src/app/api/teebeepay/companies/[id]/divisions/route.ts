// Divisions for a company. Each division has a supervisor (an employee), a
// "supervisor submits hours" flag, and a default-hours value (e.g. 80 for
// fortnightly waged workers). Employees belong to at most one division.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 1 && u.company_id !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const rows: any[] = await dbi.collection("divisions")
      .find({ company_id: cid }).sort({ name: 1 }).toArray();
    // Decorate with supervisor name + employee count
    const supIds = rows.filter((d) => d.supervisor_employee_id).map((d) => d.supervisor_employee_id);
    const supervisors: any[] = supIds.length
      ? await dbi.collection("employees").find({ _id: { $in: supIds } }).toArray()
      : [];
    const supMap = Object.fromEntries(supervisors.map((e: any) => [
      e._id.toString(),
      { name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.email || "", email: e.email || "" },
    ]));
    const counts = await dbi.collection("employees").aggregate([
      { $match: { company_id: cid, division_id: { $exists: true, $ne: null } } },
      { $group: { _id: "$division_id", n: { $sum: 1 } } },
    ]).toArray();
    const countMap = Object.fromEntries(counts.map((c: any) => [c._id.toString(), c.n]));

    return NextResponse.json({
      divisions: rows.map((d: any) => ({
        id: d._id.toString(),
        name: d.name,
        supervisor_employee_id: d.supervisor_employee_id ? d.supervisor_employee_id.toString() : null,
        supervisor_name: d.supervisor_employee_id ? (supMap[d.supervisor_employee_id.toString()]?.name || null) : null,
        supervisor_email: d.supervisor_employee_id ? (supMap[d.supervisor_employee_id.toString()]?.email || null) : null,
        supervisor_submits_hours: !!d.supervisor_submits_hours,
        default_hours: d.default_hours ?? null,
        is_active: d.is_active !== 0,
        employee_count: countMap[d._id.toString()] || 0,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const name = String(b.name || "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Division name is required." }, { status: 400 });
  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const exists = await dbi.collection("divisions").findOne({ company_id: cid, name });
    if (exists) return NextResponse.json({ error: "A division with that name already exists." }, { status: 409 });
    const doc: any = {
      company_id: cid,
      name,
      supervisor_employee_id: b.supervisor_employee_id ? new ObjectId(String(b.supervisor_employee_id)) : null,
      supervisor_submits_hours: !!b.supervisor_submits_hours,
      default_hours: b.default_hours != null && b.default_hours !== "" ? Number(b.default_hours) : 80,
      is_active: 1,
      created_at: new Date(),
      created_by: u.email,
    };
    const r = await dbi.collection("divisions").insertOne(doc);
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
