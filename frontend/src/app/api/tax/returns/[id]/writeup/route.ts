// POST → AI-draft a plain-English summary + client cover letter for a tax
//        return (Principal+). PUT → save edits. Draft for tax-agent review.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { aiConfigured, draftSummaryAndLetter } from "../../../../_ai";
import { computeReturn, TAX_TYPE_LABELS } from "../../../_engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(n: any) { return "PGK " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiConfigured()) return NextResponse.json({ error: "AI write-up isn't configured yet (no AI key set)." }, { status: 503 });
  const { id } = await params;
  let oid: any; try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const row: any = await dbi.collection("tax_returns").findOne({ _id: oid });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const type = row.tax_type;
    const res: any = row.inputs ? computeReturn(type, row.inputs) : null;

    let figures = "No computation has been entered yet.";
    if (res && type === "cit") figures = `Accounting profit ${money(res.accounting_profit)}; taxable income ${money(res.taxable_income)} at ${(res.rate * 100).toFixed(0)}%; ${res.refund_due > 0 ? "refund due " + money(res.refund_due) : "tax payable " + money(res.tax_payable)}.`;
    else if (res && type === "individual") figures = `Taxable income ${money(res.taxable_income)}; total tax ${money(res.tax)}; average rate ${(res.average_rate * 100).toFixed(1)}%, marginal ${(res.marginal_rate * 100).toFixed(0)}%.`;
    else if (res && type === "gst") figures = `Taxable sales ${money(res.taxable_sales)}, output tax ${money(res.output_tax)}; input tax ${money(res.input_tax)}; ${res.refund_due > 0 ? "GST refund " + money(res.refund_due) : "net GST payable " + money(res.net_gst)}.`;

    const system = "You are a Registered Tax Agent at TeeBee Accountants Ltd in Papua New Guinea. You draft clear, accurate explanations of tax returns in IRC-compliant language. This is a DRAFT for the tax agent to review and edit before lodgement.";
    const user =
      `Draft (1) a plain-English summary of this ${TAX_TYPE_LABELS[type] || "tax return"} explaining the key figures and positions, and (2) a short cover letter to the client enclosing the return for their review and signature.\n\n` +
      `Taxpayer: ${row.taxpayer_name}${row.tin ? " (TIN " + row.tin + ")" : ""}\nPeriod: ${row.period || row.fy_end || "—"}\nStatus: ${row.status}\n\n` +
      `Computed result: ${figures}\n\nKeep it concise and professional. The cover letter is from TeeBee Accountants Ltd.`;

    const out = await draftSummaryAndLetter(system, user);
    const writeup = { ...out, generated_at: new Date(), generated_by: u.email, model: process.env.OPENAI_MODEL || "gpt-4o-mini", edited: false };
    await dbi.collection("tax_returns").updateOne({ _id: oid }, { $set: { ai_writeup: writeup, updated_at: new Date() } });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[tax/writeup] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any; try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }
  const b = await req.json().catch(() => ({} as any));
  try {
    const dbi = await db();
    await dbi.collection("tax_returns").updateOne({ _id: oid }, {
      $set: { "ai_writeup.summary": String(b.summary || ""), "ai_writeup.cover_letter": String(b.cover_letter || ""), "ai_writeup.edited": true, "ai_writeup.edited_by": u.email, "ai_writeup.edited_at": new Date(), updated_at: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
