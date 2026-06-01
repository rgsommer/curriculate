// GET → cross-app activity rollup for the TeeBee suite console.
//
// One call returns a section per product (Audit, Tax, Loans, Accounting/
// Payroll), each with its entities (engagements / returns / applications /
// companies) and that entity's progress through the product's stages.
//
// Scope:
//   clearance 4 (superuser)  → everything, every company
//   clearance 3 (principal)  → the firm's client work (audit/tax/loans) in
//                              full, but Accounting/Payroll limited to their
//                              own company.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../teebeepay/_auth";
import { checklistForAuditType } from "../../audit/_checklist";

function lastOf(...ds: any[]): Date | null {
  const times = ds.filter(Boolean).map((d) => new Date(d).getTime()).filter((n) => !isNaN(n));
  return times.length ? new Date(Math.max(...times)) : null;
}
function steps(defs: Array<{ label: string; done: boolean }>) {
  const doneCount = defs.filter((d) => d.done).length;
  // Current stage label = the last completed step (or the first step if none).
  const lastDone = [...defs].reverse().find((d) => d.done);
  return { steps: defs, stageIndex: doneCount, total: defs.length, stageLabel: lastDone?.label || defs[0]?.label || "—" };
}

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const isSuper = u.clearance >= 4;

  try {
    const dbi = await db();
    const apps: any[] = [];

    /* ── Audit ─────────────────────────────────────────────── */
    const engs: any[] = await dbi.collection("audit_engagements")
      .find({}).sort({ created_at: -1 }).limit(200).toArray();
    // One grouped pass over uploaded files → set of slots present per engagement.
    const fileGroups: any[] = await dbi.collection("audit_files.files").aggregate([
      { $group: { _id: { eng: "$metadata.engagement_id", slot: "$metadata.slot" } } },
    ]).toArray();
    const slotsByEng = new Map<string, Set<string>>();
    for (const g of fileGroups) {
      const eid = g._id.eng?.toString();
      if (!eid) continue;
      if (!slotsByEng.has(eid)) slotsByEng.set(eid, new Set());
      slotsByEng.get(eid)!.add(g._id.slot);
    }
    const auditEntities = engs.map((e) => {
      const id = e._id.toString();
      const slots = slotsByEng.get(id) || new Set<string>();
      const required = checklistForAuditType(String(e.audit_type || "other")).filter((i) => i.required);
      const have = required.filter((i) => slots.has(i.slot)).map((i) => i.label);
      const need = required.filter((i) => !slots.has(i.slot)).map((i) => i.label);
      const st = steps([
        { label: "Initiated", done: true },
        { label: "Documents in", done: slots.size > 0 || ["active", "review", "delivered"].includes(e.status) },
        { label: "Analysis run", done: !!e.last_analysis_at },
        { label: "Under review", done: ["review", "delivered"].includes(e.status) },
        { label: "Delivered", done: e.status === "delivered" },
      ]);
      return {
        id, app: "audit", name: e.company_name, subtitle: e.fy_end ? `FY ${e.fy_end}` : (e.audit_type || ""),
        status: e.status, ...st,
        lastActivity: lastOf(e.updated_at, e.last_upload_at, e.last_analysis_at, e.created_at),
        outstanding: e.outstanding_items || { have, need },   // recorded list wins over the auto one
        canRequestInfo: true,
      };
    });
    apps.push({
      key: "audit", label: "TeeBee Audit", unit: "engagement",
      stepLabels: ["Initiated", "Documents in", "Analysis run", "Under review", "Delivered"],
      total: auditEntities.length,
      active: auditEntities.filter((e) => !["delivered", "lost"].includes(e.status)).length,
      entities: auditEntities,
    });

    /* ── Tax ───────────────────────────────────────────────── */
    const returns: any[] = await dbi.collection("tax_returns")
      .find({}).sort({ created_at: -1 }).limit(200).toArray();
    const taxEntities = returns.map((t) => {
      const st = steps([
        { label: "Draft", done: true },
        { label: "Reviewed", done: ["reviewed", "filed"].includes(t.status) },
        { label: "Filed", done: t.status === "filed" },
      ]);
      return {
        id: t._id.toString(), app: "tax", name: t.taxpayer_name,
        subtitle: [t.tax_type, t.period].filter(Boolean).join(" · "), status: t.status, ...st,
        lastActivity: lastOf(t.updated_at, t.created_at), canRequestInfo: false,
      };
    });
    apps.push({
      key: "tax", label: "TeeBee Tax", unit: "return",
      stepLabels: ["Draft", "Reviewed", "Filed"],
      total: taxEntities.length, active: taxEntities.filter((e) => e.status !== "filed").length,
      entities: taxEntities,
    });

    /* ── Loans ─────────────────────────────────────────────── */
    const apps_: any[] = await dbi.collection("loan_applications")
      .find({}).sort({ created_at: -1 }).limit(200).toArray();
    const DECISION = ["approved", "declined", "rejected", "funded"];
    const loanEntities = apps_.map((l) => {
      const st = steps([
        { label: "Intake", done: true },
        { label: "Submitted", done: l.status === "submitted" || DECISION.includes(l.status) },
        { label: "Decision", done: DECISION.includes(l.status) },
      ]);
      return {
        id: l._id.toString(), app: "loans", name: l.business_name,
        subtitle: [l.purpose, l.loan_amount != null ? `PGK ${Number(l.loan_amount).toLocaleString()}` : ""].filter(Boolean).join(" · "),
        status: l.status, ...st, lastActivity: lastOf(l.updated_at, l.created_at), canRequestInfo: false,
      };
    });
    apps.push({
      key: "loans", label: "TeeBee Loans", unit: "application",
      stepLabels: ["Intake", "Submitted", "Decision"],
      total: loanEntities.length, active: loanEntities.filter((e) => !DECISION.includes(e.status)).length,
      entities: loanEntities,
    });

    /* ── Accounting / Payroll ──────────────────────────────── */
    const compFilter: any = isSuper ? {} : (u.company_id ? { _id: new ObjectId(u.company_id) } : { _id: null });
    const companies: any[] = await dbi.collection("companies")
      .find(compFilter).sort({ created_at: -1 }).limit(200).toArray();
    const periodGroups: any[] = await dbi.collection("pay_periods").aggregate([
      { $group: { _id: "$company_id", count: { $sum: 1 },
        lastDate: { $max: "$created_at" }, statuses: { $addToSet: "$status" } } },
    ]).toArray();
    const ppByCompany = new Map<string, any>();
    for (const g of periodGroups) ppByCompany.set(String(g._id), g);
    const payEntities = companies.map((c) => {
      const pp = ppByCompany.get(String(c._id)) || { count: 0, lastDate: null, statuses: [] };
      const settled = (pp.statuses || []).some((s: string) => ["approved", "paid"].includes(s));
      const st = steps([
        { label: "Onboarded", done: true },
        { label: "First pay run", done: pp.count > 0 },
        { label: "Active", done: pp.count > 0 && settled },
      ]);
      return {
        id: c._id.toString(), app: "payroll", name: c.name,
        subtitle: `${pp.count} pay run${pp.count === 1 ? "" : "s"}`, status: pp.count > 0 ? "running" : "setup", ...st,
        lastActivity: lastOf(pp.lastDate, c.updated_at, c.created_at), canRequestInfo: false,
      };
    });
    apps.push({
      key: "payroll", label: "TeebeePay — Accounting & Payroll", unit: "company",
      stepLabels: ["Onboarded", "First pay run", "Active"],
      total: payEntities.length, active: payEntities.filter((e) => e.status === "running").length,
      entities: payEntities,
    });

    return NextResponse.json({ scope: isSuper ? "all" : "company", generated_at: new Date(), apps });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
