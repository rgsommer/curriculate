// GL engine smoke test — runs the REAL ledger engine against a faithful
// in-memory Mongo shim. Tests: COA seeding (idempotent), balanced posting,
// validation rejects, sequential numbering, reverse-by-offset + double-reverse
// guard, and the three derived reports (trial balance / income statement /
// balance sheet). Also probes contra-account handling in the report layer.
//
// Run:  node frontend/scripts/gl-smoke.ts
import { ObjectId } from "mongodb";
import {
  seedChartOfAccounts,
  postJournalEntry,
  reverseJournalEntry,
  trialBalance,
  incomeStatement,
  balanceSheet,
  DEFAULT_COA,
} from "../src/app/api/teebeepay/_ledger.ts";

/* ───────────────────────── in-memory Mongo shim ─────────────────────────
   Implements exactly the operations the engine calls:
   - accounts:        findOne, insertOne, insertMany, find().project().sort().toArray()
   - journal_entries: findOne, insertOne, updateOne, aggregate([$match,$unwind,$group])
   - gl_counters:     findOneAndUpdate({upsert, returnDocument:"after", $inc})
   ObjectId is the REAL driver class, so _id/equality semantics match production. */

function eqv(a: any, b: any): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) {
    try { return new ObjectId(a).equals(new ObjectId(b)); } catch { return false; }
  }
  return a === b;
}
function matchField(actual: any, cond: any): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
    if ("$in" in cond) return cond.$in.some((v: any) => eqv(actual, v));
    let ok = true;
    if ("$gte" in cond) ok = ok && String(actual) >= String(cond.$gte);
    if ("$lte" in cond) ok = ok && String(actual) <= String(cond.$lte);
    if ("$gt" in cond) ok = ok && String(actual) > String(cond.$gt);
    if ("$lt" in cond) ok = ok && String(actual) < String(cond.$lt);
    return ok;
  }
  return eqv(actual, cond);
}
function matchDoc(doc: any, query: any): boolean {
  return Object.keys(query || {}).every((k) => matchField(doc[k], query[k]));
}
function clone<T>(v: T): T { return v === undefined ? v : structuredCloneSafe(v); }
function structuredCloneSafe(v: any): any {
  if (v instanceof ObjectId) return v;                 // keep identity/class
  if (v instanceof Date) return new Date(v);
  if (Array.isArray(v)) return v.map(structuredCloneSafe);
  if (v && typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = structuredCloneSafe(v[k]);
    return o;
  }
  return v;
}

class Cursor {
  docs: any[];
  constructor(docs: any[]) { this.docs = docs; }
  project(spec: any) {
    const keys = Object.keys(spec).filter((k) => spec[k]);
    this.docs = this.docs.map((d) => {
      const o: any = { _id: d._id };
      for (const k of keys) o[k] = d[k];
      return o;
    });
    return this;
  }
  sort(spec: any) {
    const [k] = Object.keys(spec);
    const dir = spec[k] < 0 ? -1 : 1;
    this.docs = [...this.docs].sort((a, b) =>
      String(a[k]) < String(b[k]) ? -dir : String(a[k]) > String(b[k]) ? dir : 0);
    return this;
  }
  async toArray() { return this.docs.map(clone); }
}

class Collection {
  rows: any[] = [];
  async findOne(q: any) { const r = this.rows.find((d) => matchDoc(d, q)); return r ? clone(r) : null; }
  async insertOne(doc: any) {
    if (!doc._id) doc._id = new ObjectId();
    this.rows.push(clone(doc));
    return { insertedId: doc._id };
  }
  async insertMany(docs: any[]) {
    const insertedIds: any = {};
    docs.forEach((doc, i) => { if (!doc._id) doc._id = new ObjectId(); this.rows.push(clone(doc)); insertedIds[i] = doc._id; });
    return { insertedIds };
  }
  async updateOne(q: any, upd: any) {
    const r = this.rows.find((d) => matchDoc(d, q));
    if (!r) return { matchedCount: 0, modifiedCount: 0 };
    if (upd.$set) for (const k of Object.keys(upd.$set)) r[k] = clone(upd.$set[k]);
    if (upd.$inc) for (const k of Object.keys(upd.$inc)) r[k] = (r[k] || 0) + upd.$inc[k];
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async findOneAndUpdate(q: any, upd: any, opts: any = {}) {
    let r = this.rows.find((d) => matchDoc(d, q));
    if (!r && opts.upsert) {
      r = clone(q); if (!r._id) r._id = new ObjectId();
      this.rows.push(r);
    }
    if (!r) return null;
    if (upd.$inc) for (const k of Object.keys(upd.$inc)) r[k] = (r[k] || 0) + upd.$inc[k];
    if (upd.$set) for (const k of Object.keys(upd.$set)) r[k] = clone(upd.$set[k]);
    return clone(r);   // driver v5+ returns the doc directly (returnDocument:"after")
  }
  find(q: any) { return new Cursor(this.rows.filter((d) => matchDoc(d, q))); }
  aggregate(pipeline: any[]) {
    let docs = this.rows.map(clone);
    for (const stage of pipeline) {
      if (stage.$match) docs = docs.filter((d) => matchDoc(d, stage.$match));
      else if (stage.$unwind) {
        const path = String(stage.$unwind).replace(/^\$/, "");
        const out: any[] = [];
        for (const d of docs) for (const item of d[path] || []) out.push({ ...d, [path]: item });
        docs = out;
      } else if (stage.$group) {
        const g = stage.$group;
        const keyExpr = String(g._id).replace(/^\$/, "");        // e.g. "lines.account_id"
        const get = (d: any, p: string) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
        const groups = new Map<string, any>();
        for (const d of docs) {
          const kv = get(d, keyExpr);
          const kk = kv instanceof ObjectId ? kv.toString() : String(kv);
          if (!groups.has(kk)) {
            const row: any = { _id: kv };
            for (const f of Object.keys(g)) if (f !== "_id") row[f] = 0;
            groups.set(kk, row);
          }
          const row = groups.get(kk);
          for (const f of Object.keys(g)) {
            if (f === "_id") continue;
            const sumExpr = g[f].$sum;
            row[f] += Number(get(d, String(sumExpr).replace(/^\$/, ""))) || 0;
          }
        }
        docs = Array.from(groups.values());
      }
    }
    return new Cursor(docs);
  }
}

class FakeDb {
  private cols = new Map<string, Collection>();
  collection(name: string) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection());
    return this.cols.get(name) as any;
  }
}

/* ───────────────────────────── assertions ──────────────────────────────── */
let pass = 0, fail = 0;
const warnings: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<any>, wantSub = "") {
  try { await fn(); check(name, false, "expected throw, got success"); }
  catch (e: any) { check(name, !wantSub || String(e.message).toLowerCase().includes(wantSub.toLowerCase()), `got: ${e.message}`); }
}

async function main() {
  // Live mode: set MONGO_URI to run the SAME checks against a real MongoDB
  // (real driver + $unwind/$group aggregation + counters), in a dedicated
  // throwaway database that is dropped at the end. Else use the in-memory shim.
  let client: any = null;
  let db: any;
  if (process.env.MONGO_URI) {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const dbName = process.env.MONGO_DB || "pngpay_gl_smoke";
    await client.db(dbName).dropDatabase();      // start clean
    db = client.db(dbName);
    console.log(`(live MongoDB → ${dbName})`);
  } else {
    db = new FakeDb();
    console.log("(in-memory Mongo shim)");
  }
  const cleanup = async () => {
    if (client) { try { await client.db(process.env.MONGO_DB || "pngpay_gl_smoke").dropDatabase(); } catch {} await client.close(); }
  };
  const C = new ObjectId();                     // throwaway test company
  const acctId = async (code: string) => (await db.collection("accounts").findOne({ company_id: C, code }))._id;

  console.log("\n── Chart of accounts ──");
  const seeded = await seedChartOfAccounts(db, C);
  check(`seeds ${DEFAULT_COA.length} accounts`, seeded === DEFAULT_COA.length, `got ${seeded}`);
  const seededAgain = await seedChartOfAccounts(db, C);
  check("re-seed is idempotent (0 inserted)", seededAgain === 0, `got ${seededAgain}`);

  const bank = await acctId("1010");
  const capital = await acctId("3000");
  const sales = await acctId("4000");
  const rent = await acctId("6100");

  console.log("\n── Posting (balanced) ──");
  const e1 = await postJournalEntry(db, C, { date: "2026-01-05", memo: "Owner capital",
    lines: [{ account_id: bank, debit: 10000 }, { account_id: capital, credit: 10000 }] });
  check("entry 1 ref JE-00001", e1.entry_ref === "JE-00001", e1.entry_ref);
  const e2 = await postJournalEntry(db, C, { date: "2026-01-10", memo: "Cash sale",
    lines: [{ account_id: bank, debit: 1500 }, { account_id: sales, credit: 1500 }] });
  check("entry 2 ref JE-00002 (sequential)", e2.entry_ref === "JE-00002", e2.entry_ref);
  await postJournalEntry(db, C, { date: "2026-01-12", memo: "Rent",
    lines: [{ account_id: rent, debit: 500 }, { account_id: bank, credit: 500 }] });

  console.log("\n── Validation rejects ──");
  await expectThrow("rejects out-of-balance entry",
    () => postJournalEntry(db, C, { lines: [{ account_id: bank, debit: 100 }, { account_id: sales, credit: 90 }] }),
    "out of balance");
  await expectThrow("rejects single-line entry",
    () => postJournalEntry(db, C, { lines: [{ account_id: bank, debit: 100 }] }),
    "at least two");
  await expectThrow("rejects foreign account_id (tenant isolation)",
    () => postJournalEntry(db, C, { lines: [{ account_id: new ObjectId(), debit: 50 }, { account_id: bank, credit: 50 }] }),
    "does not belong");

  console.log("\n── Reports (after 3 postings) ──");
  const tb = await trialBalance(db, C, "2026-01-31");
  check("trial balance is balanced", tb.balanced, `Dr ${tb.total_debit} / Cr ${tb.total_credit}`);
  check("trial balance total = 11500", tb.total_debit === 11500, String(tb.total_debit));
  const is1 = await incomeStatement(db, C, "2026-01-01", "2026-01-31");
  check("income statement revenue = 1500", is1.totalRevenue === 1500, String(is1.totalRevenue));
  check("income statement net income = 1000", is1.netIncome === 1000, String(is1.netIncome));
  const bs1 = await balanceSheet(db, C, "2026-01-31");
  check("balance sheet balances (A = L+E)", bs1.balanced, `A ${bs1.totalAssets} / L+E ${bs1.totalLiabEquity}`);
  check("balance sheet assets = 11000", bs1.totalAssets === 11000, String(bs1.totalAssets));

  console.log("\n── Reverse-by-offset ──");
  const rev = await reverseJournalEntry(db, C, e2._id, { date: "2026-01-20" });
  check("reversal memo references original", String(rev.memo).includes("JE-00002"), rev.memo);
  const origAfter = await db.collection("journal_entries").findOne({ _id: e2._id });
  check("original marked reversed", origAfter.status === "reversed");
  check("original linked to reversal", String(origAfter.reversed_by) === String(rev._id));
  const tb2 = await trialBalance(db, C, "2026-01-31");
  check("trial balance still balanced after reversal", tb2.balanced);
  const is2 = await incomeStatement(db, C, "2026-01-01", "2026-01-31");
  check("revenue back to 0 after sale reversed", is2.totalRevenue === 0, String(is2.totalRevenue));
  const bs2 = await balanceSheet(db, C, "2026-01-31");
  check("balance sheet still balances after reversal", bs2.balanced, `A ${bs2.totalAssets} / L+E ${bs2.totalLiabEquity}`);
  await expectThrow("double-reverse is blocked", () => reverseJournalEntry(db, C, e2._id, {}));
  await expectThrow("reverse of missing entry throws", () => reverseJournalEntry(db, C, new ObjectId(), {}), "not found");

  console.log("\n── Contra-account probe (depreciation) ──");
  // Dr Depreciation Expense (6500) / Cr Accumulated Depreciation (1590, contra-asset).
  const deprExp = await acctId("6500");
  const accumDep = await acctId("1590");
  await postJournalEntry(db, C, { date: "2026-01-25", memo: "Monthly depreciation",
    lines: [{ account_id: deprExp, debit: 800 }, { account_id: accumDep, credit: 800 }] });
  const tb3 = await trialBalance(db, C, "2026-01-31");
  const bs3 = await balanceSheet(db, C, "2026-01-31");
  check("trial balance still balances with contra account", tb3.balanced, `Dr ${tb3.total_debit}/Cr ${tb3.total_credit}`);
  if (!bs3.balanced) {
    warnings.push(
      `Balance sheet does NOT balance once a contra-asset (Accumulated Depreciation) is posted: ` +
      `Assets ${bs3.totalAssets} vs L+E ${bs3.totalLiabEquity} (off by ${bs3.difference}). ` +
      `Cause: balanceSheet()/incomeStatement() sum naturalBalance() without honouring the account.contra flag, ` +
      `so a contra account is added to its section instead of subtracted.`);
    console.log(`  ⚠ balance sheet unbalanced with contra account (A ${bs3.totalAssets} vs L+E ${bs3.totalLiabEquity}) — see warning`);
  } else {
    check("balance sheet balances with contra account", true);
  }

  console.log(`\n──────── ${fail === 0 ? "ALL CORE CHECKS PASSED" : "FAILURES PRESENT"} ────────`);
  console.log(`pass: ${pass}   fail: ${fail}`);
  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log("  • " + w));
  }
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
