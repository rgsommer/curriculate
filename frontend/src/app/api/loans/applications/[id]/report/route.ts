// GET → the loan financing package as a PDF (Principal+). Recomputes the
// readiness score and ratios from stored financials, lists strengths/gaps and
// the package-document checklist a PNG lender expects.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { Report, startDoc, COL, money, pct, pdfHeaders } from "../../../../_pdf";
import { scoreLoan, PACKAGE_CHECKLIST, packageProgress } from "../../../_scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BAND_LABEL: Record<string, string> = { ready: "Ready", nearly_ready: "Nearly ready", not_ready: "Not yet ready" };
const bandColor = (b: string) => b === "strong" || b === "ready" ? COL.greenInk : b === "weak" || b === "not_ready" ? COL.redInk : COL.amberInk;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any;
  try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const row: any = await dbi.collection("loan_applications").findOne({ _id: oid });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const res = row.financials ? scoreLoan(row.financials) : null;

    const { pdf, reg, bold } = await startDoc();
    const r = new Report(pdf, reg, bold);
    r.header("Financing package", "TeeBee Accountants Ltd · Loan-readiness & lender package preparation");

    r.kv("Business", row.business_name);
    if (row.industry) r.kv("Industry", row.industry);
    if (row.purpose) r.kv("Facility purpose", row.purpose);
    if (row.loan_amount != null) r.kv("Amount sought", money(row.loan_amount));
    if (row.term_years != null) r.kv("Term", `${row.term_years} years`);
    if (row.interest_rate != null) r.kv("Indicative rate", pct(Number(row.interest_rate) / 100));
    if (row.lender) r.kv("Target lender", row.lender);
    r.kv("Prepared", new Date().toISOString().slice(0, 10));
    r.gap(8);

    if (row.ai_writeup?.summary) {
      r.heading("Credit summary");
      r.tag("DRAFT — FOR ACCOUNTANT REVIEW", COL.amberInk);
      for (const p of String(row.ai_writeup.summary).split(/\n\n+/)) r.para(p.trim());
      r.gap(8);
    }

    if (res) {
      r.heading("Loan-readiness score");
      r.row(`Overall readiness — ${BAND_LABEL[res.band] || res.band}`, `${res.score} / 100`,
        { bold: true, color: bandColor(res.band) });
      r.row("Proposed annual debt service", money(res.proposed_annual_debt_service));
      r.row("Total annual debt service", money(res.total_annual_debt_service));
      r.gap(8);

      r.heading("Underwriting ratios");
      for (const m of res.metrics) {
        r.row(`${m.label}  —  ${m.display}`, m.band.toUpperCase(), { color: bandColor(m.band) });
        r.flow(m.benchmark, 8.5, reg, COL.muted);
        r.gap(2);
      }
      r.gap(6);

      if (res.strengths?.length) {
        r.heading("Strengths");
        for (const s of res.strengths) r.flow("• " + s, 10, reg, COL.greenInk);
        r.gap(6);
      }
      if (res.gaps?.length) {
        r.heading("Gaps to address");
        for (const g of res.gaps) r.flow("• " + g, 10, reg, COL.redInk);
        r.gap(6);
      }
    } else {
      r.heading("Loan-readiness score");
      r.para("No financials have been entered for this application yet.");
    }

    // Package checklist
    const prog = packageProgress(row.checklist);
    r.heading(`Package documents (${prog.done}/${prog.total})`);
    for (const c of PACKAGE_CHECKLIST) {
      const got = !!row.checklist?.[c.key];
      r.row(c.label, got ? "Included" : "Outstanding", { color: got ? COL.greenInk : COL.muted });
    }

    r.gap(12);
    r.para("Prepared by TeeBee Accountants Ltd. Ratios and the readiness score are computed by the firm's scoring engine from the financials provided; they support, but do not replace, the lender's own credit assessment.");

    if (row.ai_writeup?.cover_letter) {
      r.gap(10);
      r.heading("Cover letter (draft)");
      for (const p of String(row.ai_writeup.cover_letter).split(/\n\n+/)) r.para(p.trim());
    }

    const safeName = String(row.business_name || "business").replace(/[^A-Za-z0-9_-]+/g, "_");
    const bytes = await r.finalize("TeeBee Accountants Ltd · Port Moresby, NCD, PNG · info@teebeeaccountants.com.pg");
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: pdfHeaders(`Financing-package-${safeName}.pdf`) });
  } catch (e: any) {
    console.error("[loans/report] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
