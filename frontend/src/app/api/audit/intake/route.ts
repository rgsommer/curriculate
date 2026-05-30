// POST /api/audit/intake
// Public endpoint. Receives an audit inquiry from the /audit landing form,
// inserts a record into `audit_engagements` (status: "inquiry"), and emails
// Theresia at info@teebeeaccountants.com.pg so she sees it immediately.
//
// No auth required. Rate-limited by IP.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { MongoClient } from "mongodb";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "Tee Bee Audit <noreply@curriculate.net>";
const NOTIFY_TO = process.env.AUDIT_NOTIFY_TO
  || process.env.TEEBEE_NOTIFY_TO
  || "info@teebeeaccountants.com.pg";
const BCC = process.env.AUDIT_NOTIFY_BCC || process.env.TEEBEE_NOTIFY_BCC || "rgsommer@me.com";
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

let cached: MongoClient | null = null;
async function db() {
  if (!cached) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error("MONGODB_URI not set");
    cached = await new MongoClient(uri).connect();
  }
  return cached.db(process.env.MONGO_DB || "pngpay");
}

const rateMap = new Map<string, { count: number; resetAt: number }>();
function rateOk(ip: string): boolean {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (e.count >= 6) return false;
  e.count++; return true;
}
function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")?.trim()
      || req.headers.get("x-real-ip")?.trim()
      || "unknown";
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const AUDIT_TYPE_LABELS: Record<string, string> = {
  statutory: "External statutory audit",
  readiness: "Audit-readiness review",
  tax: "Tax / IRC due diligence audit",
  compliance: "Compliance audit",
  donor_fund: "Donor-funded / project SPV audit",
  landowner: "Landowner company audit",
  other: "Other / not sure",
};
const REVENUE_LABELS: Record<string, string> = {
  lt_500k:  "Under K 500,000",
  "500k_2m":"K 500,000 – K 2 million",
  "2m_10m": "K 2 million – K 10 million",
  "10m_50m":"K 10 million – K 50 million",
  gt_50m:   "Over K 50 million",
  unknown:  "Not stated",
};

// Rough indicative quote from intake data — Theresia overrides as needed.
function estimateFee(revenueBand: string, auditType: string, employeeCount: number | null): { low: number; high: number } {
  const tierBase: Record<string, [number, number]> = {
    lt_500k:  [5000,  9000],
    "500k_2m":[8000,  14000],
    "2m_10m": [12000, 22000],
    "10m_50m":[20000, 40000],
    gt_50m:   [38000, 80000],
    unknown:  [8000,  18000],
  };
  let [lo, hi] = tierBase[revenueBand] || tierBase.unknown;
  if (auditType === "readiness") { lo *= 0.6; hi *= 0.6; }
  if (auditType === "compliance") { lo *= 0.5; hi *= 0.7; }
  if (auditType === "landowner" || auditType === "donor_fund") { lo *= 1.15; hi *= 1.25; }
  if (employeeCount && employeeCount > 100) { lo *= 1.1; hi *= 1.15; }
  return { low: Math.round(lo / 100) * 100, high: Math.round(hi / 100) * 100 };
}

export async function POST(req: Request) {
  if (!rateOk(clientIp(req))) {
    return NextResponse.json({ error: "Too many submissions; please try again later." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({} as any));
  const required = ["company_name", "contact_name", "contact_email", "audit_type", "revenue_band"] as const;
  for (const k of required) {
    if (!String(b[k] || "").trim()) {
      return NextResponse.json({ error: `Missing required field: ${k}` }, { status: 400 });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.contact_email).trim())) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const dbi = await db();
    const empCount = b.employee_count ? Number(b.employee_count) : null;
    const quote = estimateFee(b.revenue_band, b.audit_type, empCount);
    const doc: any = {
      status: "inquiry",  // inquiry → engaged → active → review → delivered
      company_name:  String(b.company_name).trim().slice(0, 200),
      contact_name:  String(b.contact_name).trim().slice(0, 120),
      contact_email: String(b.contact_email).trim().toLowerCase().slice(0, 200),
      contact_phone: String(b.contact_phone || "").trim().slice(0, 40),
      contact_role:  String(b.entity_type || "").trim().slice(0, 120),
      audit_type:    String(b.audit_type),
      revenue_band:  String(b.revenue_band),
      employee_count: empCount,
      fy_end:        String(b.fy_end || "").trim() || null,
      notes:         String(b.notes || "").trim().slice(0, 4000) || null,
      indicative_fee_low:  quote.low,
      indicative_fee_high: quote.high,
      indicative_currency: "PGK",
      created_at: new Date(),
      created_ip: clientIp(req),
    };
    const r = await dbi.collection("audit_engagements").insertOne(doc);

    // Notify Theresia
    if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
      const subject = `Audit inquiry — ${doc.company_name} (${AUDIT_TYPE_LABELS[doc.audit_type] || doc.audit_type})`;
      const html = `
        <div style="font:14px/1.55 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:640px">
          <h2 style="margin:0 0 14px;color:#0f2c52">New audit inquiry — ${esc(doc.company_name)}</h2>
          <table cellpadding="6" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;width:100%;font-size:13px">
            <tr><td><strong>Audit type</strong></td><td>${esc(AUDIT_TYPE_LABELS[doc.audit_type] || doc.audit_type)}</td></tr>
            <tr><td><strong>Revenue band</strong></td><td>${esc(REVENUE_LABELS[doc.revenue_band] || doc.revenue_band)}</td></tr>
            <tr><td><strong>FY end</strong></td><td>${esc(doc.fy_end || "—")}</td></tr>
            <tr><td><strong>Employees</strong></td><td>${esc(String(doc.employee_count ?? "—"))}</td></tr>
            <tr><td><strong>Contact</strong></td><td>${esc(doc.contact_name)} (${esc(doc.contact_role || "—")})<br><a href="mailto:${esc(doc.contact_email)}">${esc(doc.contact_email)}</a> · ${esc(doc.contact_phone || "no phone")}</td></tr>
            <tr style="background:#fffaf0"><td><strong>Indicative quote</strong></td><td><strong>PGK ${doc.indicative_fee_low.toLocaleString()} – PGK ${doc.indicative_fee_high.toLocaleString()}</strong> <span style="color:#64748b;font-size:11px">(software estimate — adjust as needed)</span></td></tr>
          </table>
          ${doc.notes ? `<p style="margin:14px 0 0;background:#fafbfc;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;white-space:pre-wrap">${esc(doc.notes)}</p>` : ""}
          <p style="margin:18px 0">
            <a href="https://www.curriculate.net/audit/admin" style="display:inline-block;padding:11px 18px;background:#0f2c52;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Open in admin queue →
            </a>
          </p>
          <p style="color:#64748b;font-size:11px;margin-top:24px">
            Inquiry ID: ${r.insertedId.toString()} · Received ${new Date().toISOString().slice(0, 16).replace("T", " ")}
          </p>
        </div>
      `;
      try {
        await resend.emails.send({
          from: FROM, to: NOTIFY_TO, bcc: BCC,
          subject, html, replyTo: doc.contact_email,
        } as any);
      } catch (e) {
        console.warn("[audit/intake] notify email failed:", e);
      }
    }

    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    console.error("[audit/intake] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "audit/intake" });
}
