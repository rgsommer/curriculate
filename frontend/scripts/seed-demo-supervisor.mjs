// seed-demo-supervisor.mjs
//
// Creates (idempotently) a self-contained demo for App Store / Play Store
// review of the PNGPay app: one demo company, a supervised division, four
// team members, a supervisor employee, and a `users` login for that
// supervisor. Signing in as the supervisor and opening the app with
// ?view=team shows the team's hours screen — exactly what reviewers need.
//
// It writes ONLY these clearly-labelled demo documents (keyed by fixed names /
// email) and is safe to re-run — every write is an upsert.
//
// Usage (local):
//   MONGO_URI="mongodb://127.0.0.1:27077" MONGO_DB=tbtrial \
//     node scripts/seed-demo-supervisor.mjs
//
// Usage (production — you supply the prod values):
//   MONGO_URI="<prod uri>" MONGO_DB=pngpay \
//     DEMO_REVIEW_EMAIL="reviewer@teebeeaccountants.com.pg" \
//     node scripts/seed-demo-supervisor.mjs
//
// The supervisor signs in with DEMO_REVIEW_EMAIL. Pair this with the
// DEMO_REVIEW_EMAIL + DEMO_REVIEW_PIN env vars on the server so reviewers get a
// fixed PIN instead of an emailed one (see request-pin route).

import { MongoClient, ObjectId } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || "pngpay";
const DEMO_EMAIL = (process.env.DEMO_REVIEW_EMAIL || "reviewer@teebeeaccountants.com.pg").toLowerCase();

if (!MONGO_URI) { console.error("Set MONGO_URI (and MONGO_DB)."); process.exit(1); }

const COMPANY_NAME = "PNGPay Demo Co";
const DIVISION_NAME = "Site Crew";
const TEAM = [
  { first_name: "Joe",   last_name: "Kaupa" },
  { first_name: "Mary",  last_name: "Wari" },
  { first_name: "Peter", last_name: "Namaliu" },
  { first_name: "Grace", last_name: "Bani" },
];

// Two-digit date helpers (local script — Date is fine here).
const ymd = (d) => d.toISOString().slice(0, 10);

async function upsert(coll, filter, set, setOnInsert = {}) {
  const r = await coll.updateOne(filter, { $set: set, $setOnInsert: { created_at: new Date(), ...setOnInsert } }, { upsert: true });
  const doc = await coll.findOne(filter);
  return { doc, created: !!r.upsertedId };
}

const client = new MongoClient(MONGO_URI);
try {
  await client.connect();
  const db = client.db(MONGO_DB);
  const Companies = db.collection("companies");
  const Divisions = db.collection("divisions");
  const Employees = db.collection("employees");
  const Users = db.collection("users");
  const Periods = db.collection("pay_periods");

  // 1. Company
  const { doc: company } = await upsert(Companies, { name: COMPANY_NAME }, {
    name: COMPANY_NAME, abbreviation: "DEMO", pay_interval: "fortnightly",
    default_hours: 80, currency: "PGK", is_active: 1, bank_code: "088",
    payslip_message: "Demo company for app review.", is_demo: true,
  }, { created_by: "seed-demo-supervisor" });
  const cid = company._id;

  // 2. Division (supervisor submits hours). Supervisor linked in step 4.
  const { doc: division } = await upsert(Divisions, { company_id: cid, name: DIVISION_NAME }, {
    company_id: cid, name: DIVISION_NAME, supervisor_submits_hours: true,
    default_hours: 80, timesheet_mode: false, is_active: 1, is_demo: true,
  }, { created_by: "seed-demo-supervisor" });
  const did = division._id;

  // 3. Team members (in the division; no login needed)
  const teamIds = [];
  for (const t of TEAM) {
    const { doc } = await upsert(Employees,
      { company_id: cid, first_name: t.first_name, last_name: t.last_name },
      { company_id: cid, first_name: t.first_name, last_name: t.last_name,
        email: null, pay_type: "hourly", hourly_rate: 6.5, default_hours: 80,
        fte_pct: 100, dependents: 0, residency_status: "resident",
        declaration_lodged: true, is_active: 1, division_id: did, is_demo: true });
    teamIds.push(doc._id);
  }

  // 4. Supervisor employee (NOT in the division, so they don't show in their
  //    own team list) — referenced by division.supervisor_employee_id.
  const { doc: supervisor } = await upsert(Employees,
    { company_id: cid, email: DEMO_EMAIL },
    { company_id: cid, first_name: "Demo", last_name: "Supervisor", email: DEMO_EMAIL,
      pay_type: "salary", annual_salary: 52000, default_hours: 80, fte_pct: 100,
      dependents: 0, residency_status: "resident", declaration_lodged: true,
      is_active: 1, division_id: null, is_demo: true });
  await Divisions.updateOne({ _id: did }, { $set: { supervisor_employee_id: supervisor._id } });

  // 5. Login for the supervisor (users collection). Employee role = clearance 0;
  //    the field app deep-links to the team screen regardless of clearance.
  //    No TOTP so the review sign-in isn't gated by 2FA.
  const { doc: user } = await upsert(Users, { email: DEMO_EMAIL }, {
    email: DEMO_EMAIL, role: "employee", company_id: cid, is_active: 1,
    first_name: "Demo", last_name: "Supervisor", totp_enabled: false, is_demo: true,
  });

  // 6. A recent approved pay period so the "next period" window looks real.
  const today = new Date();
  const end = new Date(today); end.setDate(end.getDate() - 1);
  const start = new Date(end); start.setDate(start.getDate() - 13);
  await upsert(Periods, { company_id: cid, period_start: ymd(start), period_end: ymd(end) }, {
    company_id: cid, period_start: ymd(start), period_end: ymd(end), pay_date: ymd(today),
    status: "approved", is_demo: true,
  });

  console.log("\n✅ Demo seeded into", MONGO_DB);
  console.log("   Company:    ", COMPANY_NAME, `(${cid})`);
  console.log("   Division:   ", DIVISION_NAME, "· supervisor_submits_hours = true");
  console.log("   Supervisor: ", `${supervisor.first_name} ${supervisor.last_name}`, "·", DEMO_EMAIL);
  console.log("   Team:       ", TEAM.map((t) => `${t.first_name} ${t.last_name}`).join(", "));
  console.log("   User login: ", user.email, `(role ${user.role})`);
  console.log("\n▶ Reviewer sign-in:  https://www.curriculate.net/teebeepay/app?view=team");
  console.log("  Email:", DEMO_EMAIL);
  console.log("  PIN:   set DEMO_REVIEW_EMAIL + DEMO_REVIEW_PIN on the server, then that PIN.\n");
} catch (e) {
  console.error("Seed failed:", e);
  process.exit(1);
} finally {
  await client.close();
}
