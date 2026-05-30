// GET  → planning snapshot: stored materiality (computed) + benchmark options.
// PUT  → set materiality inputs; server recomputes and stores on the engagement.
// Principal+ only (planning is firm-internal).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { BENCHMARKS, computeMateriality, benchmarkFor, type BenchmarkKey } from "../../../_planning";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const m = eng.materiality || null;
    return NextResponse.json({
      benchmarks: BENCHMARKS,
      materiality: m ? computeMateriality(m) : null,
      materiality_meta: m ? { set_by: m.set_by || null, set_at: m.set_at || null, basis_note: m.basis_note || null } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));

  const benchmark = String(b.benchmark || "") as BenchmarkKey;
  if (!BENCHMARKS.some((x) => x.key === benchmark)) {
    return NextResponse.json({ error: "Unknown benchmark" }, { status: 400 });
  }
  const amount = Number(b.benchmark_amount);
  const pct = Number(b.pct);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "benchmark_amount must be a positive number" }, { status: 400 });
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return NextResponse.json({ error: "pct must be between 0 and 100" }, { status: 400 });

  const result = computeMateriality({
    benchmark,
    benchmark_amount: amount,
    pct,
    performance_pct: b.performance_pct != null ? Number(b.performance_pct) : undefined,
    trivial_pct: b.trivial_pct != null ? Number(b.trivial_pct) : undefined,
  });

  const stored = {
    benchmark: result.benchmark,
    benchmark_amount: result.benchmark_amount,
    pct: result.pct,
    performance_pct: result.performance_pct,
    trivial_pct: result.trivial_pct,
    basis_note: typeof b.basis_note === "string" ? b.basis_note.trim() : (benchmarkFor(benchmark).note),
    set_by: u.email,
    set_at: new Date(),
  };
  try {
    const dbi = await db();
    await dbi.collection("audit_engagements").updateOne(
      { _id: new ObjectId(id) },
      { $set: { materiality: stored, updated_at: new Date() } });
    return NextResponse.json({ ok: true, materiality: result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
