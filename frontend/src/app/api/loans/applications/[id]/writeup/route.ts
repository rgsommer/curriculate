// POST → AI-draft a credit summary + lender cover letter for a loan application
//        (Principal+). PUT → save edits. Draft for accountant review.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { aiConfigured, draftSummaryAndLetter } from "../../../../_ai";
import { scoreLoan } from "../../../_scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(n: any) { return "PGK " + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
const BAND_LABEL: Record<string, string> = { ready: "ready", nearly_ready: "nearly ready", not_ready: "not yet ready" };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiConfigured()) return NextResponse.json({ error: "Write-up generation isn't available yet." }, { status: 503 });
  const { id } = await params;
  let oid: any; try { oid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const row: any = await dbi.collection("loan_applications").findOne({ _id: oid });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const res: any = row.financials ? scoreLoan(row.financials) : null;

    const ratios = res ? res.metrics.map((m: any) => `${m.label} ${m.display} (${m.band})`).join("; ") : "no financials entered";
    const scoreLine = res ? `Readiness score ${res.score}/100 — ${BAND_LABEL[res.band] || res.band}.` : "Not yet scored.";

    const system = "You are an accountant at TeeBee Accountants Ltd in Papua New Guinea preparing a financing package for a client seeking a bank loan. You write balanced, credible credit narrative that a PNG lender (BSP, Kina, Westpac) would respect. This is a DRAFT for the accountant to review and edit.";
    const user =
      `Draft (1) a narrative credit summary for this client and (2) a short cover letter to the lender introducing the enclosed financing package.\n\n` +
      `Business: ${row.business_name}${row.industry ? " (" + row.industry + ")" : ""}\n` +
      `Facility: ${row.purpose || "—"}, ${money(row.loan_amount)} over ${row.term_years || "—"} years${row.lender ? ", target lender " + row.lender : ""}.\n\n` +
      `${scoreLine}\nRatios: ${ratios}.\n` +
      (res?.strengths?.length ? `Strengths: ${res.strengths.join("; ")}.\n` : "") +
      (res?.gaps?.length ? `Gaps: ${res.gaps.join("; ")}.\n` : "") +
      `\nThe summary should fairly characterise the borrower's readiness, strengths and the gaps to address. The cover letter is from TeeBee Accountants Ltd to the lender.`;

    const out = await draftSummaryAndLetter(system, user);
    const writeup = { ...out, generated_at: new Date(), generated_by: u.email, model: process.env.OPENAI_MODEL || "gpt-4o-mini", edited: false };
    await dbi.collection("loan_applications").updateOne({ _id: oid }, { $set: { ai_writeup: writeup, updated_at: new Date() } });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[loans/writeup] error:", e);
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
    await dbi.collection("loan_applications").updateOne({ _id: oid }, {
      $set: { "ai_writeup.summary": String(b.summary || ""), "ai_writeup.cover_letter": String(b.cover_letter || ""), "ai_writeup.edited": true, "ai_writeup.edited_by": u.email, "ai_writeup.edited_at": new Date(), updated_at: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: "Couldn't complete the write-up. Please try again." }, { status: 500 });
  }
}
