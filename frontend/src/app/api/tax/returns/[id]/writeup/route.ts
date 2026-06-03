// POST → AI-draft a plain-English summary + client cover letter for a tax
//        return (Principal+). PUT → save edits. Draft for tax-agent review.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { aiConfigured, draftJson } from "../../../../_ai";
import { computeReturn, TAX_TYPE_LABELS } from "../../../_engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(n: any) { return "PGK " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiConfigured()) return NextResponse.json({ error: "Write-up generation isn't available yet." }, { status: 503 });
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

    const system = "You are a Registered Tax Agent and tax-planning adviser at TeeBee Accountants Ltd in Papua New Guinea. You draft clear, accurate explanations of tax returns and lawful tax-minimisation strategy under the PNG Income Tax Act and IRC practice. This is a DRAFT for the tax agent to review and edit before lodgement or advising the client.";
    const user =
      `For this ${TAX_TYPE_LABELS[type] || "tax return"}, draft three things:\n` +
      `1. "summary" — a plain-English summary of the key figures and positions.\n` +
      `2. "cover_letter" — a short cover letter from TeeBee Accountants Ltd to the client enclosing the return for review and signature.\n` +
      `3. "recommendations" — specific, lawful tax-strategy recommendations to REDUCE this taxpayer's PNG tax, grounded in the figures. Cover, where relevant: timing and substantiation of deductible expenses; capital allowances / depreciation and the choice of method; carry-forward and utilisation of prior-year losses; provisional-tax management and instalment timing; commonly-missed allowable deductions; superannuation / NASFund contributions; for individuals, salary packaging and allowable rebates; for GST, ensuring all input-tax credits are claimed and timing of supplies. Make each recommendation concrete and quantify the indicative benefit where the figures allow. Flag where eligibility checks, substantiation or professional judgement are needed, and note anything that needs IRC private-ruling or care to stay within the law. Do not recommend evasion or aggressive schemes.\n\n` +
      `Taxpayer: ${row.taxpayer_name}${row.tin ? " (TIN " + row.tin + ")" : ""}\nPeriod: ${row.period || row.fy_end || "—"}\nStatus: ${row.status}\n` +
      `Computed result: ${figures}\n` +
      (row.inputs ? `Inputs: ${JSON.stringify(row.inputs).slice(0, 1200)}\n` : "");

    const out = await draftJson(system, user, ["summary", "cover_letter", "recommendations"]);
    const writeup = { ...out, generated_at: new Date(), generated_by: u.email, model: process.env.OPENAI_MODEL || "gpt-4o-mini", edited: false };
    await dbi.collection("tax_returns").updateOne({ _id: oid }, { $set: { ai_writeup: writeup, updated_at: new Date() } });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[tax/writeup] error:", e);
    return NextResponse.json({ error: "Couldn't complete the write-up. Please try again." }, { status: 500 });
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
      $set: { "ai_writeup.summary": String(b.summary || ""), "ai_writeup.cover_letter": String(b.cover_letter || ""), "ai_writeup.recommendations": String(b.recommendations || ""), "ai_writeup.edited": true, "ai_writeup.edited_by": u.email, "ai_writeup.edited_at": new Date(), updated_at: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: "Couldn't complete the write-up. Please try again." }, { status: 500 });
  }
}
