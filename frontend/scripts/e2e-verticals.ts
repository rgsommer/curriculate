// End-to-end live verification of the three new verticals (Tax, Loans, Audit)
// against a REAL Next.js dev server + REAL local Mongo (throwaway db).
//
// Driven by scripts/e2e-verticals.sh, which stands up mongod + `next dev` with:
//   MONGO_URI / MONGODB_URI → local mongod
//   MONGO_DB = teebee_demo_test   (throwaway — never the production cluster)
//   TEEBEEPAY_SECRET = (shared with this script so the minted token verifies)
//
// Run indirectly:  bash scripts/e2e-verticals.sh
import { MongoClient, ObjectId } from "mongodb";
import { signToken } from "../src/app/api/teebeepay/_auth.ts";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const SECRET = process.env.TEEBEEPAY_SECRET || "test-secret-e2e";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27018";
const DB_NAME = process.env.MONGO_DB || "teebee_demo_test";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: any) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  (got ${JSON.stringify(got)})` : ""}`); }
}
const near = (a: number, b: number, t = 0.01) => Math.abs(a - b) < t;

// Principal token (clearance 3). Routes only verify the signature — no user row needed.
const token = signToken({
  uid: "e2e-principal", email: "principal@e2e.test", role: "principal",
  clearance: 3, company_id: null, exp: Date.now() + 60 * 60 * 1000,
}, SECRET);
// A second Principal — used to prove the preparer cannot self-review.
const reviewerToken = signToken({
  uid: "e2e-reviewer", email: "reviewer@e2e.test", role: "principal",
  clearance: 3, company_id: null, exp: Date.now() + 60 * 60 * 1000,
}, SECRET);
const lowToken = signToken({
  uid: "e2e-bookkeeper", email: "bk@e2e.test", role: "bookkeeper",
  clearance: 2, company_id: null, exp: Date.now() + 60 * 60 * 1000,
}, SECRET);

async function api(method: string, path: string, body?: any, tok = token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`E2E against ${BASE} (db ${DB_NAME})\n`);

  // ── Auth guards ───────────────────────────────────────────────
  console.log("auth guards");
  {
    const noTok = await fetch(BASE + "/api/tax/returns").then((r) => r.status);
    check("no token → 401", noTok === 401, noTok);
    const low = await api("GET", "/api/tax/returns", undefined, lowToken);
    check("bookkeeper (clearance 2) → 403", low.status === 403, low.status);
    const ok = await api("GET", "/api/tax/me");
    check("principal → 200 on /tax/me", ok.status === 200, ok.status);
  }

  // ── TAX vertical ──────────────────────────────────────────────
  console.log("\ntax: company income-tax return lifecycle");
  let taxId = "";
  {
    const c = await api("POST", "/api/tax/returns", {
      taxpayer_name: "Highlands Trading Ltd", tin: "500123456",
      tax_type: "cit", period: "FY2025", fy_end: "2025-12-31",
    });
    check("create CIT return → draft", c.status === 200 && c.json?.return?.status === "draft", c.json);
    taxId = c.json?.return?.id;
    check("got return id", !!taxId);

    const save = await api("PATCH", `/api/tax/returns/${taxId}`, {
      action: "save_inputs",
      inputs: {
        accounting_profit: 1_000_000, resident: true,
        adjustments: [
          { label: "Entertainment (non-deductible)", kind: "add_back", amount: 200_000 },
          { label: "Tax depreciation", kind: "deduction", amount: 50_000 },
        ],
        credits: [],
      },
    });
    // taxable = 1,000,000 + 200,000 − 50,000 = 1,150,000 ; tax @30% = 345,000
    const result = save.json?.return?.result;
    check("save_inputs computes taxable 1,150,000", result && near(result.taxable_income, 1_150_000, 1), result);
    check("CIT tax @30% = 345,000", result && near(result.tax_payable ?? result.tax, 345_000, 1), result);

    const prep = await api("PATCH", `/api/tax/returns/${taxId}`, { action: "prepare" });
    check("prepare → prepared", prep.json?.return?.status === "prepared", prep.json?.return?.status);

    const selfReview = await api("PATCH", `/api/tax/returns/${taxId}`, { action: "review" });
    check("preparer cannot self-review → 409", selfReview.status === 409, selfReview);

    const review = await api("PATCH", `/api/tax/returns/${taxId}`, { action: "review" }, reviewerToken);
    check("different principal reviews → reviewed", review.json?.return?.status === "reviewed", review.json?.return?.status);

    const fileNoRef = await api("PATCH", `/api/tax/returns/${taxId}`, { action: "file" });
    check("file without IRC ref → 400", fileNoRef.status === 400, fileNoRef.status);

    const filed = await api("PATCH", `/api/tax/returns/${taxId}`, { action: "file", irc_reference: "IRC-2025-0001" });
    check("file with ref → filed", filed.json?.return?.status === "filed", filed.json?.return?.status);

    const del = await api("DELETE", `/api/tax/returns/${taxId}`);
    check("filed return cannot be deleted → 409", del.status === 409, del.status);
  }

  // ── LOANS vertical ────────────────────────────────────────────
  console.log("\nloans: readiness assessment + package pipeline");
  let loanId = "";
  {
    const c = await api("POST", "/api/loans/applications", {
      business_name: "Momase Hardware Ltd", contact_name: "J. Kaupa",
      loan_amount: 300_000, term_years: 5, interest_rate: 10, purpose: "expansion",
    });
    check("create application → intake", c.status === 200 && c.json?.application?.status === "intake", c.json);
    loanId = c.json?.application?.id;
    check("got application id", !!loanId);

    const assessEarly = await api("PATCH", `/api/loans/applications/${loanId}`, { action: "assess" });
    check("assess before financials → 409", assessEarly.status === 409, assessEarly.status);

    const save = await api("PATCH", `/api/loans/applications/${loanId}`, {
      action: "save_financials",
      financials: {
        current_assets: 300_000, current_liabilities: 150_000, inventory: 50_000,
        total_assets: 1_000_000, total_liabilities: 400_000, total_equity: 600_000,
        revenue: 800_000, net_profit: 120_000, ebitda: 250_000,
        existing_annual_debt_service: 20_000, collateral_value: 600_000,
      },
    });
    const app = save.json?.application;
    check("strong borrower scores ready", app && app.score_band === "ready" && app.score >= 75, { score: app?.score, band: app?.score_band });

    const assess = await api("PATCH", `/api/loans/applications/${loanId}`, { action: "assess" });
    check("assess → assessed", assess.json?.application?.status === "assessed", assess.json?.application?.status);

    const pkgEarly = await api("PATCH", `/api/loans/applications/${loanId}`, { action: "package_ready" });
    check("package_ready w/ incomplete checklist → 409", pkgEarly.status === 409, pkgEarly.status);

    // Tick every checklist item.
    const meta = await api("GET", "/api/loans/me");
    const checklist = meta.json?.meta?.package_checklist || [];
    check("checklist has items", checklist.length > 0, checklist.length);
    for (const item of checklist) {
      await api("PATCH", `/api/loans/applications/${loanId}`, { action: "toggle_doc", key: item.key, value: true });
    }
    const pkg = await api("PATCH", `/api/loans/applications/${loanId}`, { action: "package_ready" });
    check("package_ready w/ full checklist → package_ready", pkg.json?.application?.status === "package_ready", pkg.json?.application?.status);

    const submit = await api("PATCH", `/api/loans/applications/${loanId}`, { action: "submit", lender: "BSP" });
    check("submit → submitted", submit.json?.application?.status === "submitted", submit.json?.application?.status);

    const del = await api("DELETE", `/api/loans/applications/${loanId}`);
    check("submitted application cannot be deleted → 409", del.status === 409, del.status);
  }

  // ── AUDIT vertical ────────────────────────────────────────────
  console.log("\naudit: planning materiality + risk register + working papers");
  {
    // Seed an engagement directly (created elsewhere via the public brief intake).
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const eid = new ObjectId();
    await client.db(DB_NAME).collection("audit_engagements").insertOne({
      _id: eid, status: "engaged", company_name: "Pacific Foods Ltd",
      contact_name: "M. Tau", contact_email: "m.tau@pacfoods.test",
      audit_type: "financial_statements", revenue_band: "5m_20m",
      created_at: new Date(),
    } as any);
    await client.close();
    const id = eid.toString();

    const plan = await api("PUT", `/api/audit/engagements/${id}/planning`, {
      benchmark: "pbt", benchmark_amount: 1_000_000, pct: 7,
    });
    // planning materiality = 7% of 1,000,000 = 70,000
    check("planning PUT computes materiality 70,000", plan.status === 200 && near(plan.json?.materiality?.planning_materiality, 70_000, 1), plan.json);

    const planGet = await api("GET", `/api/audit/engagements/${id}/planning`);
    check("planning persists materiality", planGet.json?.materiality != null, planGet.json);

    const risks = await api("GET", `/api/audit/engagements/${id}/risks`);
    check("risk register auto-seeds", Array.isArray(risks.json?.risks) && risks.json.risks.length > 0, risks.json?.risks?.length);
    const firstRisk = risks.json?.risks?.[0];
    const rPatch = await api("PATCH", `/api/audit/engagements/${id}/risks`, { risk_id: firstRisk?.id, status: "addressed", response: "Substantive testing of revenue cut-off." });
    check("risk PATCH ok", rPatch.status === 200, rPatch.status);

    const wps = await api("GET", `/api/audit/engagements/${id}/workpapers`);
    check("working papers auto-seed", Array.isArray(wps.json?.workpapers) && wps.json.workpapers.length > 0, wps.json?.workpapers?.length);
    const wp = wps.json?.workpapers?.[0];

    const signEarly = await api("PATCH", `/api/audit/engagements/${id}/workpapers`, { wp_id: wp?.id, action: "sign_off" });
    check("sign_off before review → 409", signEarly.status === 409, signEarly.status);

    const prepare = await api("PATCH", `/api/audit/engagements/${id}/workpapers`, { wp_id: wp?.id, action: "prepare" });
    check("WP prepare → prepared", prepare.json?.workpaper?.status === "prepared", prepare.json?.workpaper?.status);
    const reviewWp = await api("PATCH", `/api/audit/engagements/${id}/workpapers`, { wp_id: wp?.id, action: "review" }, reviewerToken);
    check("WP review → reviewed", reviewWp.json?.workpaper?.status === "reviewed", reviewWp.json?.workpaper?.status);
    const signOff = await api("PATCH", `/api/audit/engagements/${id}/workpapers`, { wp_id: wp?.id, action: "sign_off" });
    check("WP sign_off → signed_off", signOff.json?.workpaper?.status === "signed_off", signOff.json?.workpaper?.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
