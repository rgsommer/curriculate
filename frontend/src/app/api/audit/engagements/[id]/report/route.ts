// GET → the audit report PDF for an engagement (Principal+). Pulls the
// engagement meta, document-checklist status and the analysis findings into a
// CPA-style report with a sign-off block.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { Report, startDoc, COL, money, pdfHeaders } from "../../../../_pdf";
import { checklistForAuditType } from "../../../_checklist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPE_LABEL: Record<string, string> = {
  statutory: "External statutory audit", readiness: "Audit-readiness review",
  tax: "Tax / IRC due-diligence audit", compliance: "Compliance audit",
  donor_fund: "Donor-funded / project audit", landowner: "Landowner company audit", other: "Audit",
};
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const sevColor = (s: string) => s === "high" ? COL.redInk : s === "medium" ? COL.amberInk : COL.greenInk;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let oid: any;
  try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: oid });
    if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const findings: any[] = await dbi.collection("audit_findings").find({ engagement_id: oid })
      .sort({ severity: 1, created_at: -1 }).toArray();
    const files: any[] = await dbi.collection("audit_files.files").find({ "metadata.engagement_id": oid }).toArray();
    const slots = new Set(files.map((f) => f.metadata?.slot));

    const { pdf, reg, bold } = await startDoc();
    const r = new Report(pdf, reg, bold);
    r.header("Audit report", "TeeBee Accountants Ltd · CPA · Registered with the PNG Accountants Registration Board");

    r.kv("Client", eng.company_name);
    r.kv("Engagement", TYPE_LABEL[eng.audit_type] || eng.audit_type);
    r.kv("Financial year end", eng.fy_end || "—");
    r.kv("Status", String(eng.status || "").replace(/^./, (c: string) => c.toUpperCase()));
    if (eng.agreed_fee != null) r.kv("Agreed fee", money(eng.agreed_fee));
    r.kv("Report date", new Date().toISOString().slice(0, 10));
    r.gap(8);

    // AI-drafted executive summary (if generated) — clearly marked a draft
    if (eng.ai_writeup?.summary) {
      r.heading("Executive summary");
      r.tag("DRAFT — FOR CPA REVIEW", COL.amberInk);
      for (const p of String(eng.ai_writeup.summary).split(/\n\n+/)) r.para(p.trim());
      r.gap(8);
    }

    // Document checklist
    r.heading("Document checklist");
    const items = checklistForAuditType(String(eng.audit_type || "other"));
    for (const it of items) {
      const got = slots.has(it.slot);
      r.row(it.label + (it.required ? "  (required)" : ""), got ? "Received" : "Outstanding",
        { color: got ? COL.greenInk : (it.required ? COL.redInk : COL.muted) });
    }
    r.gap(10);

    // Findings
    r.heading(`Findings (${findings.length})`);
    if (!findings.length) {
      r.para("No analysis has been run yet, or no findings were raised.");
    } else {
      const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
      for (const f of sorted) {
        r.ensure(40);
        r.tag(String(f.severity || "").toUpperCase(), sevColor(f.severity));
        r.flow(f.title || "", 11, bold, COL.ink);
        if (f.detail) r.flow(f.detail, 9.5, reg, COL.soft);
        r.gap(6);
      }
    }
    r.gap(10);

    // Sign-off
    r.heading("Sign-off");
    r.para("This report is prepared by TeeBee Accountants Ltd. Findings above are produced with software assistance and reviewed by a CPA. The audit opinion is issued separately once fieldwork is complete.");
    r.gap(6);
    r.kv("Prepared by", eng.invited_by || u.email);
    r.kv("Reviewed by", "_______________________");
    r.kv("Date", "_______________________");

    if (eng.ai_writeup?.cover_letter) {
      r.gap(10);
      r.heading("Cover letter (draft)");
      for (const p of String(eng.ai_writeup.cover_letter).split(/\n\n+/)) r.para(p.trim());
    }

    const safeName = String(eng.company_name || "client").replace(/[^A-Za-z0-9_-]+/g, "_");
    const bytes = await r.finalize("TeeBee Accountants Ltd · Port Moresby, NCD, PNG · info@teebeeaccountants.com.pg");
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: pdfHeaders(`Audit-report-${safeName}.pdf`) });
  } catch (e: any) {
    console.error("[audit/report] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
