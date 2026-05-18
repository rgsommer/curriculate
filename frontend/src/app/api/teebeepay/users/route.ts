// frontend/src/app/api/teebeepay/users/route.ts
// GET → list users this caller can see (own clearance and below).
// POST → invite a new user (email + role); subsequent sign-in via email-PIN.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId, ROLE_CLEARANCE, clearanceOf } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("users").find({}).sort({ email: 1 }).toArray();
    // Show only users at clearance ≤ caller's own
    const filtered = rows.filter((r) => clearanceOf(r.role) <= u.clearance);
    const companies = await dbi.collection("companies").find({}).toArray();
    const cMap = Object.fromEntries(companies.map((c: any) => [c._id.toString(), c.name]));
    return NextResponse.json({
      users: filtered.map((r: any) => ({
        id: r._id.toString(),
        email: r.email,
        role: r.role,
        clearance: clearanceOf(r.role),
        company_id: r.company_id ? r.company_id.toString() : null,
        company_name: r.company_id ? cMap[r.company_id.toString()] : null,
        is_active: r.is_active !== 0,
        created_at: r.created_at,
        last_sign_in_at: r.last_sign_in_at || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const email = String(b.email || "").trim().toLowerCase();
  const role  = String(b.role  || "employee");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!ROLE_CLEARANCE.hasOwnProperty(role)) {
    return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  }
  if (clearanceOf(role) >= u.clearance && u.clearance < 4) {
    return NextResponse.json({
      error: `Only the system owner can create users at level ${clearanceOf(role)} or above.`,
    }, { status: 403 });
  }

  try {
    const dbi = await db();
    const exists = await dbi.collection("users").findOne({ email });
    if (exists) return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });

    const doc: any = {
      email, role,
      company_id: b.company_id ? new ObjectId(b.company_id) : null,
      is_active: 1,
      created_at: new Date(),
      created_by: u.email,
    };
    const r = await dbi.collection("users").insertOne(doc);
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
