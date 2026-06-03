// POST → AI-draft an executive summary + cover letter for the engagement from
//        its findings + checklist (Principal+). Stored as ai_writeup.
// PUT  → save the CPA's edited summary/cover letter.
// Everything here is a DRAFT for CPA review.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { aiConfigured, draftSummaryAndLetter } from "../../../../_ai";
import { checklistForAuditType } from "../../../_checklist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPE_LABEL: Record<string, string> = {
  statutory: "external statutory audit", readiness: "audit-readiness review", tax: "tax due-diligence audit",
  compliance: "compliance audit", donor_fund: "donor-funded / project audit", landowner: "landowner company audit", other: "audit",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiConfigured()) return NextResponse.json({ error: "AI write-up isn't configured yet (no AI key set)." }, { status: 503 });
  const { id } = await params;
  let oid: any; try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: oid });
    if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const findings: any[] = await dbi.collection("audit_findings").find({ engagement_id: oid }).sort({ severity: 1 }).toArray();
    const files: any[] = await dbi.collection("audit_files.files").find({ "metadata.engagement_id": oid }).toArray();
    const slots = new Set(files.map((f) => f.metadata?.slot));
    const items = checklistForAuditType(String(eng.audit_type || "other"));
    const received = items.filter((i) => slots.has(i.slot)).map((i) => i.label);
    const outstanding = items.filter((i) => i.required && !slots.has(i.slot)).map((i) => i.label);

    const system = "You are a CPA at TeeBee Accountants Ltd, a registered audit firm in Papua New Guinea. You draft clear, professional working-paper narrative in IFRS-aligned language. You are cautious and hedge appropriately. This is a DRAFT for the engagement partner to review and edit; it is not an issued audit opinion.";
    const user =
      `Draft (1) an executive summary of this ${TYPE_LABEL[eng.audit_type] || "audit"} and (2) a short cover letter to the client enclosing the report.\n\n` +
      `Client: ${eng.company_name}\nFinancial year end: ${eng.fy_end || "—"}\nStatus: ${eng.status}\n\n` +
      `Documents received: ${received.join("; ") || "none yet"}\n` +
      `Required documents still outstanding: ${outstanding.join("; ") || "none"}\n\n` +
      `Software analysis findings (${findings.length}):\n` +
      (findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join("\n") || "- none yet") +
      `\n\nThe executive summary should characterise overall readiness, note the key issues by significance, and what is needed to progress. The cover letter is from TeeBee Accountants Ltd to the client.`;

    const out = await draftSummaryAndLetter(system, user);
    const writeup = { ...out, generated_at: new Date(), generated_by: u.email, model: process.env.OPENAI_MODEL || "gpt-4o-mini", edited: false };
    await dbi.collection("audit_engagements").updateOne({ _id: oid }, { $set: { ai_writeup: writeup, updated_at: new Date() } });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[audit/writeup] error:", e);
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
    await dbi.collection("audit_engagements").updateOne({ _id: oid }, {
      $set: { "ai_writeup.summary": String(b.summary || ""), "ai_writeup.cover_letter": String(b.cover_letter || ""), "ai_writeup.edited": true, "ai_writeup.edited_by": u.email, "ai_writeup.edited_at": new Date(), updated_at: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
