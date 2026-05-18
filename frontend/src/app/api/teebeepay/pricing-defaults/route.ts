// GET / PATCH the bureau-wide pricing defaults (Principal-only edit, anyone authed can read).
// Singleton document stored in system_settings with _id = "pricing_defaults".
//
// Used by:
//   - _fees.ts (effective per-employee rate when a company doesn't override)
//   - CompanySettingsPanel UI (shows the inherited default + override input)
//   - The marketing /teebeepay page can hard-code these to keep public copy honest.
import { NextResponse } from "next/server";
import { readAuth, db } from "../_auth";

export const DEFAULT_BANK_UPLOAD_INSTRUCTIONS = [
  "1. Open the period detail page in TeebeePay and click \"Download BSP batch CSV\".",
  "",
  "2. Confirm the totals match the breakdown above — particularly the BANK FUNDING REQUIRED line.",
  "   If anything looks wrong, do NOT upload; reply to this email first.",
  "",
  "3. Log in to BSP Internet Business Banking → Batch Manager → File Upload.",
  "",
  "4. Select the downloaded CSV file. BSP will validate the format and show a preview.",
  "",
  "5. Verify the preview total in BSP matches the BANK FUNDING REQUIRED figure above (to the toea).",
  "",
  "6. Approve the batch in BSP. Make sure sufficient cleared funds are in the payroll account",
  "   BEFORE the pay date — BSP will not auto-borrow.",
  "",
  "7. Once BSP confirms the batch, mark the period as \"Paid\" in TeebeePay (Period detail → Mark paid)",
  "   so the next steps in the Bookkeeper's checklist clear automatically.",
  "",
  "8. Retain the BSP confirmation reference for the audit log; paste it into the period notes field.",
].join("\n");

export const DEFAULTS = {
  basic_rate_per_employee: 9,
  full_rate_per_employee: 14,
  setup_fee_small: 500,    // <= 20 employees
  setup_fee_medium: 1000,  // 21..50 employees
  setup_fee_large: 2000,   // > 50 employees
  currency: "PGK",
  bank_upload_instructions: DEFAULT_BANK_UPLOAD_INSTRUCTIONS,
  // Post-approval summary email — enabled by default. System owner can flip
  // this off bureau-wide if Principals don't want the email.
  post_approval_email_enabled: true,
};

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();
    const row: any = await dbi.collection("system_settings").findOne({ _id: "pricing_defaults" as any });
    return NextResponse.json({ pricing: { ...DEFAULTS, ...(row || {}), _id: undefined } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date(), updated_by: u.email };
  const fields = ["basic_rate_per_employee", "full_rate_per_employee",
                  "setup_fee_small", "setup_fee_medium", "setup_fee_large", "currency",
                  "bank_upload_instructions", "post_approval_email_enabled"];
  for (const k of fields) {
    if (k in b) {
      const v = b[k];
      if (k === "currency") $set[k] = String(v || "PGK").toUpperCase().slice(0, 8);
      else if (k === "bank_upload_instructions") $set[k] = String(v || "").slice(0, 8000);
      else if (k === "post_approval_email_enabled") $set[k] = !!v;
      else $set[k] = v === "" ? 0 : Number(v) || 0;
    }
  }
  try {
    const dbi = await db();
    await dbi.collection("system_settings").updateOne(
      { _id: "pricing_defaults" as any },
      { $set, $setOnInsert: { _id: "pricing_defaults" } },
      { upsert: true });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
