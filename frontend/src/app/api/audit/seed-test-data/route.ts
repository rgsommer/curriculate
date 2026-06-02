// POST → seeds sample audit engagements (Principal+ only, idempotent).
// Useful for Theresia's first walk-through of the admin queue.
//
// One of them — Port Moresby Netball Association — also ships with a real,
// balanced trial balance and a reconciling general ledger uploaded into GridFS,
// so the demo can be analysed end-to-end without anyone hunting for files.
import { NextResponse } from "next/server";
import { GridFSBucket, ObjectId } from "mongodb";
import { readAuth, db } from "../../teebeepay/_auth";

const SEEDS = [
  {
    status: "inquiry",
    company_name: "Sample Highlands Landowner Ltd",
    contact_name: "Joseph Yali", contact_role: "Director",
    contact_email: "demo+lo@example.com",
    contact_phone: "+675 7000 1234",
    audit_type: "landowner",
    revenue_band: "500k_2m",
    employee_count: 12,
    fy_end: "2026-06-30",
    notes: "First-time landowner audit. Royalty distributions to 4 ILGs. Unit-trust beneficiary register exists.",
    indicative_fee_low: 9000,
    indicative_fee_high: 17000,
    indicative_currency: "PGK",
    seeded: true,
  },
  {
    status: "inquiry",
    company_name: "Sample Trading PNG Ltd",
    contact_name: "Mary Karu", contact_role: "CFO",
    contact_email: "demo+mid@example.com",
    contact_phone: "+675 7500 9876",
    audit_type: "statutory",
    revenue_band: "2m_10m",
    employee_count: 45,
    fy_end: "2025-12-31",
    notes: "Retail importer, 3 warehouses (POM/Lae/Mt Hagen). Migrating from QuickBooks to Xero mid-year.",
    indicative_fee_low: 14000,
    indicative_fee_high: 26000,
    indicative_currency: "PGK",
    seeded: true,
  },
  {
    status: "inquiry",
    company_name: "Sample Health NGO",
    contact_name: "Dr Anna Kila", contact_role: "Executive Director",
    contact_email: "demo+ngo@example.com",
    contact_phone: "+675 7100 5555",
    audit_type: "donor_fund",
    revenue_band: "lt_500k",
    employee_count: 8,
    fy_end: "2026-03-31",
    notes: "DFAT-funded maternal health programme. K 380k grant, 18-month period. Budget-vs-actual report exists.",
    indicative_fee_low: 5000,
    indicative_fee_high: 11000,
    indicative_currency: "PGK",
    seeded: true,
  },
  {
    status: "active",
    company_name: "Port Moresby Netball Association",
    contact_name: "Grace Wamp", contact_role: "Treasurer",
    contact_email: "demo+netball@example.com",
    contact_phone: "+675 7200 4488",
    audit_type: "readiness",
    revenue_band: "lt_500k",
    employee_count: 3,
    fy_end: "2025-12-31",
    notes: "Small not-for-profit association. Trial balance and general ledger are loaded — ready to run the analysis.",
    indicative_fee_low: 3000,
    indicative_fee_high: 5400,
    indicative_currency: "PGK",
    seeded: true,
    withDemoFiles: true,
  },
];

// Balanced trial balance for the netball association (debits = credits = 29,948.00).
const DEMO_TRIAL_BALANCE = `Account,Debit,Credit
Bank — operating account,8547.20,0
Member fees receivable,1180.00,0
Sports equipment,5980.00,0
Court & venue hire,7240.50,0
Equipment & uniforms,3512.30,0
Administration & insurance,3488.00,0
Accounts payable,0,905.00
Accumulated funds (opening),0,9850.00
Membership fees,0,15243.00
Grants & sponsorship,0,3950.00
`;

// General ledger that reconciles account-by-account to the trial balance.
const DEMO_GENERAL_LEDGER = `Date,Account,Description,Debit,Credit
2025-02-15,Membership fees,Season registrations,0,9243.00
2025-06-30,Membership fees,Mid-season sign-ups,0,6000.00
2025-03-01,Grants & sponsorship,NCD sports grant,0,3950.00
2025-01-20,Court & venue hire,Sir John Guise courts Q1,1810.00,0
2025-04-20,Court & venue hire,Sir John Guise courts Q2,1810.00,0
2025-07-20,Court & venue hire,Sir John Guise courts Q3,1810.50,0
2025-10-20,Court & venue hire,Sir John Guise courts Q4,1810.00,0
2025-02-10,Equipment & uniforms,Team uniforms,2012.30,0
2025-08-10,Equipment & uniforms,Replacement balls and bibs,1500.00,0
2025-12-01,Administration & insurance,Public liability insurance,1988.00,0
2025-12-15,Administration & insurance,Admin and stationery,1500.00,0
2025-11-30,Member fees receivable,Outstanding member fees,1180.00,0
2025-01-05,Sports equipment,Opening equipment,5980.00,0
2025-12-31,Bank — operating account,Net movement for the year,8547.20,0
2025-01-01,Accumulated funds (opening),Opening accumulated funds,0,9850.00
2025-12-20,Accounts payable,Year-end payables,0,905.00
`;

async function uploadDemoFile(dbi: any, engagementId: ObjectId, slot: string, filename: string, content: string, actor: string) {
  const bucket = new GridFSBucket(dbi, { bucketName: "audit_files" });
  const buf = Buffer.from(content, "utf8");
  await new Promise<void>((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      metadata: {
        engagement_id: engagementId,
        slot,
        mime: "text/csv",
        uploaded_by: actor,
        uploaded_at: new Date(),
        original_size: buf.length,
        seeded: true,
      },
    });
    stream.once("error", reject);
    stream.once("finish", () => resolve());
    stream.end(buf);
  });
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    let inserted = 0, skipped = 0, filesAdded = 0;
    for (const s of SEEDS) {
      const { withDemoFiles, ...doc } = s as any;
      let row: any = await dbi.collection("audit_engagements").findOne({ company_name: s.company_name, seeded: true });
      if (row) {
        skipped++;
      } else {
        const r = await dbi.collection("audit_engagements").insertOne({ ...doc, created_at: new Date(), created_by_seed: u.email });
        row = { _id: r.insertedId, ...doc };
        inserted++;
      }

      // Attach the demo trial balance + general ledger once (idempotent).
      if (withDemoFiles) {
        const eid = row._id instanceof ObjectId ? row._id : new ObjectId(String(row._id));
        const already = await dbi.collection("audit_files.files").findOne({ "metadata.engagement_id": eid, "metadata.seeded": true });
        if (!already) {
          await uploadDemoFile(dbi, eid, "trial_balance", "Port Moresby Netball Association — Trial Balance 2025.csv", DEMO_TRIAL_BALANCE, u.email);
          await uploadDemoFile(dbi, eid, "general_ledger", "Port Moresby Netball Association — General Ledger 2025.csv", DEMO_GENERAL_LEDGER, u.email);
          await dbi.collection("audit_engagements").updateOne({ _id: eid },
            { $set: { last_upload_at: new Date(), last_upload_by: u.email } });
          filesAdded += 2;
        }
      }
    }
    return NextResponse.json({ ok: true, inserted, skipped, files_added: filesAdded, total: SEEDS.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
