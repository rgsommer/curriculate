// POST → grounded Q&A for the Principal. Gathers a company's records across
// audit, tax, loans and payroll, feeds them to the model as context, and
// answers the question. Principal+ only. Answers ONLY from the gathered data.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../teebeepay/_auth";
import { aiConfigured, chatAnswer } from "../../_ai";
import { findClientRecords } from "../../_client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(n: any) { return "PGK " + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }); }

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const company = String(b.company || "").trim().slice(0, 160);
  const question = String(b.question || "").trim().slice(0, 1000);
  const history = Array.isArray(b.history) ? b.history : [];
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ error: "Assistant isn't available yet." }, { status: 503 });

  try {
    const dbi = await db();
    const ctx: string[] = [];

    if (company) {
      // Light client linking: joins records even when the name differs slightly
      // across products (e.g. "… Limited 2025" vs "… Ltd").
      const found = await findClientRecords(dbi, company);

      for (const e of found.audit) {
        const counts: any[] = await dbi.collection("audit_findings").aggregate([
          { $match: { engagement_id: e._id } }, { $group: { _id: "$severity", n: { $sum: 1 } } },
        ]).toArray();
        const sev = counts.map((c) => `${c.n} ${c._id}`).join(", ") || "no";
        ctx.push(`AUDIT — ${e.company_name}: ${e.audit_type} engagement, status ${e.status}, FY ${e.fy_end || "—"}; ${sev} findings.` +
          (e.outstanding_items?.need?.length ? ` Outstanding docs: ${e.outstanding_items.need.join(", ")}.` : "") +
          (e.ai_writeup?.summary ? ` Summary: ${String(e.ai_writeup.summary).replace(/\s+/g, " ").slice(0, 600)}` : ""));
      }

      for (const r of found.tax) {
        ctx.push(`TAX — ${r.taxpayer_name}: ${r.tax_type} return, status ${r.status}, period ${r.period || r.fy_end || "—"}` +
          (r.irc_reference ? `, IRC ref ${r.irc_reference}` : "") +
          (r.ai_writeup?.recommendations ? `. Tax-planning ideas on file: ${String(r.ai_writeup.recommendations).replace(/\s+/g, " ").slice(0, 500)}` : "") + ".");
      }

      for (const a of found.loans) {
        ctx.push(`LOAN — ${a.business_name}: ${a.purpose || "facility"} ${a.loan_amount != null ? money(a.loan_amount) : ""}, status ${a.status}` +
          (a.score != null ? `, readiness score ${a.score}/100` : "") + ".");
      }

      for (const c of found.payroll) {
        const emp = await dbi.collection("employees").countDocuments({ company_id: c._id });
        const lastPp: any = await dbi.collection("pay_periods").find({ company_id: c._id }).sort({ created_at: -1 }).limit(1).next();
        ctx.push(`PAYROLL — ${c.name}: ${emp} employees${lastPp ? `; last pay period status ${lastPp.status}` : ""}.`);
      }
    }

    const context = ctx.length ? ctx.join("\n") : "No records were found for that company in audit, tax, loans or payroll.";
    const system =
      `You are the practice assistant for the principal of TeeBee Accountants Ltd, a CPA firm in Papua New Guinea. ` +
      `Answer the principal's question about ${company || "the firm's work"} using ONLY the context below. ` +
      `Be concise, specific and practical. If the context does not contain the answer, say what is missing or what record to check — do not guess or invent figures.\n\n` +
      `CONTEXT:\n${context}`;

    const messages = [
      ...history.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
      { role: "user", content: question },
    ];

    const answer = await chatAnswer(system, messages);
    return NextResponse.json({ ok: true, answer, sources: ctx.length });
  } catch (e: any) {
    console.error("[teebee/ask] error:", e);
    return NextResponse.json({ error: "Couldn't answer right now. Please try again." }, { status: 500 });
  }
}
