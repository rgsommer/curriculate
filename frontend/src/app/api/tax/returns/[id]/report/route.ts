// GET → the prepared tax return as a PDF (Principal+). Recomputes the figures
// from stored inputs via the tax engine, so the printed return always agrees
// with the screen.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { Report, startDoc, COL, money, pct, pdfHeaders } from "../../../../_pdf";
import { computeReturn, TAX_TYPE_LABELS } from "../../../_engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any;
  try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const row: any = await dbi.collection("tax_returns").findOne({ _id: oid });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const type = row.tax_type;
    const res = row.inputs ? computeReturn(type, row.inputs) : null;

    const { pdf, reg, bold } = await startDoc();
    const r = new Report(pdf, reg, bold);
    r.header(TAX_TYPE_LABELS[type] || "Tax return", "TeeBee Accountants Ltd · Registered Tax Agents · IRC-compliant");

    r.kv("Taxpayer", row.taxpayer_name);
    if (row.tin) r.kv("TIN", row.tin);
    r.kv("Return type", TAX_TYPE_LABELS[type] || type);
    if (row.period) r.kv("Period", row.period);
    if (row.fy_end) r.kv("Financial year end", row.fy_end);
    r.kv("Status", String(row.status || "draft").replace(/^./, (c: string) => c.toUpperCase()));
    if (row.irc_reference) r.kv("IRC reference", row.irc_reference);
    r.kv("Prepared", new Date().toISOString().slice(0, 10));
    r.gap(8);

    if (row.ai_writeup?.summary) {
      r.heading("Summary");
      r.tag("DRAFT — FOR TAX-AGENT REVIEW", COL.amberInk);
      for (const p of String(row.ai_writeup.summary).split(/\n\n+/)) r.para(p.trim());
      r.gap(8);
    }

    r.heading("Computation");
    if (!res) {
      r.para("No computation inputs have been entered for this return yet.");
    } else if (type === "cit") {
      r.row("Accounting profit", money(res.accounting_profit));
      r.row("Add: non-deductible items", money(res.total_add_backs));
      r.row("Less: further deductions", money(res.total_deductions), { rule: true });
      r.row("Taxable income", money(res.taxable_income), { bold: true });
      r.row(`Company tax rate`, pct(res.rate));
      r.row("Gross tax", money(res.gross_tax));
      r.row("Less: tax credits", money(res.total_credits), { rule: true });
      r.row(res.refund_due > 0 ? "Refund due" : "Tax payable to IRC",
        money(res.refund_due > 0 ? res.refund_due : res.tax_payable),
        { bold: true, color: res.refund_due > 0 ? COL.greenInk : COL.redInk });
      if (res.adjustments?.length) {
        r.gap(8); r.heading("Adjustments");
        for (const a of res.adjustments) r.row(`${a.label} (${a.kind === "deduction" ? "deduction" : "add-back"})`, money(a.amount));
      }
      if (res.credits?.length) {
        r.gap(8); r.heading("Credits");
        for (const c of res.credits) r.row(c.label, money(c.amount));
      }
    } else if (type === "individual") {
      r.row("Taxable income", money(res.taxable_income), { bold: true });
      r.gap(4); r.heading("Marginal bands");
      for (const b of res.bands) {
        const range = b.to == null ? `over ${money(b.from)}` : `${money(b.from)} – ${money(b.to)}`;
        r.row(`${range} @ ${pct(b.rate)}`, money(b.tax));
      }
      r.gap(4);
      r.row("Total tax", money(res.tax), { bold: true, rule: true, color: COL.redInk });
      r.row("Average rate", pct(res.average_rate));
      r.row("Marginal rate", pct(res.marginal_rate));
    } else { // gst
      r.row("Taxable sales", money(res.taxable_sales));
      r.row("Output tax (10%)", money(res.output_tax));
      r.row("Creditable purchases", money(res.creditable_purchases));
      r.row("Input tax (10%)", money(res.input_tax), { rule: true });
      r.row(res.refund_due > 0 ? "GST refund / credit" : "Net GST payable",
        money(res.refund_due > 0 ? res.refund_due : res.net_gst),
        { bold: true, color: res.refund_due > 0 ? COL.greenInk : COL.redInk });
    }

    r.gap(12);
    r.heading("Preparation & lodgement");
    if (row.prepared_by) r.kv("Prepared by", row.prepared_by);
    if (row.reviewed_by) r.kv("Reviewed by", row.reviewed_by);
    if (row.filed_by) r.kv("Filed by", row.filed_by);
    r.para("Prepared by TeeBee Accountants Ltd, Registered Tax Agents, in accordance with PNG IRC requirements. Figures are computed by the firm's tax engine from the inputs provided by the taxpayer.");

    if (row.ai_writeup?.cover_letter) {
      r.gap(10);
      r.heading("Cover letter (draft)");
      for (const p of String(row.ai_writeup.cover_letter).split(/\n\n+/)) r.para(p.trim());
    }

    const safeName = String(row.taxpayer_name || "taxpayer").replace(/[^A-Za-z0-9_-]+/g, "_");
    const bytes = await r.finalize("TeeBee Accountants Ltd · Registered Tax Agents · info@teebeeaccountants.com.pg");
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: pdfHeaders(`Tax-return-${safeName}.pdf`) });
  } catch (e: any) {
    console.error("[tax/report] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
