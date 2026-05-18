// frontend/src/app/api/teebeepay/_audit.ts
//
// Lightweight audit-log helper. Called from API routes that change state
// (payroll approval, employee edits, user invites, etc.). Writes to the
// `audit_log` collection in the pngpay database.
import { ObjectId } from "mongodb";
import { db } from "./_auth";

export interface AuditEvent {
  ts?: Date;
  actor_email: string | null;       // authenticated user's email
  actor_kind?: "user" | "approval_link" | "system" | "cron";
  action: string;                   // e.g. "payroll.approve"
  resource_type?: string;           // e.g. "pay_period"
  resource_id?: string | null;
  company_id?: string | null;
  details?: any;
}

export async function logAudit(ev: AuditEvent): Promise<void> {
  try {
    const dbi = await db();
    await dbi.collection("audit_log").insertOne({
      ts: ev.ts || new Date(),
      actor_email: ev.actor_email || null,
      actor_kind: ev.actor_kind || "user",
      action: ev.action,
      resource_type: ev.resource_type || null,
      resource_id: ev.resource_id || null,
      company_id: ev.company_id ? new ObjectId(ev.company_id) : null,
      details: ev.details || null,
    });
  } catch (e) {
    // Never let an audit-log failure break the actual request.
    console.warn("[audit] write failed:", e);
  }
}
