// GET → AR aging report as of a date (?asOf=YYYY-MM-DD, defaults to today).
import { NextResponse } from "next/server";
import { readAuth, db } from "../../../../_auth";
import { arAging } from "../../../../_ar";

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
    const url = new URL(req.url);
    const aging = await arAging(dbi, id, url.searchParams.get("asOf") || undefined);
    return NextResponse.json(aging);
  } catch (e: any) {
    console.error("[teebeepay/ar/aging GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
