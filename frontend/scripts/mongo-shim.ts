// In-memory Mongo shim shared by the payroll-GL and AR smoke tests. Implements
// exactly the operations those modules + the ledger engine call, using the REAL
// ObjectId so _id/equality semantics match production. Adds $push and $unset on
// top of what the engine needs ($set/$inc/$in/date range/$unwind/$group).
import { ObjectId } from "mongodb";

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
  if (v instanceof ObjectId) return v;
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
    const ks = Object.keys(spec);
    this.docs = [...this.docs].sort((a, b) => {
      for (const k of ks) {
        const dir = spec[k] < 0 ? -1 : 1;
        if (String(a[k]) < String(b[k])) return -dir;
        if (String(a[k]) > String(b[k])) return dir;
      }
      return 0;
    });
    return this;
  }
  limit(n: number) { this.docs = this.docs.slice(0, n); return this; }
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
  private apply(r: any, upd: any) {
    if (upd.$set) for (const k of Object.keys(upd.$set)) r[k] = clone(upd.$set[k]);
    if (upd.$inc) for (const k of Object.keys(upd.$inc)) r[k] = (r[k] || 0) + upd.$inc[k];
    if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete r[k];
    if (upd.$push) for (const k of Object.keys(upd.$push)) { if (!Array.isArray(r[k])) r[k] = []; r[k].push(clone(upd.$push[k])); }
  }
  async updateOne(q: any, upd: any) {
    const r = this.rows.find((d) => matchDoc(d, q));
    if (!r) return { matchedCount: 0, modifiedCount: 0 };
    this.apply(r, upd);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async findOneAndUpdate(q: any, upd: any, opts: any = {}) {
    let r = this.rows.find((d) => matchDoc(d, q));
    if (!r && opts.upsert) { r = clone(q); if (!r._id) r._id = new ObjectId(); this.rows.push(r); }
    if (!r) return null;
    this.apply(r, upd);
    return clone(r);
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
        const keyExpr = String(g._id).replace(/^\$/, "");
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

export class FakeDb {
  private cols = new Map<string, Collection>();
  collection(name: string) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection());
    return this.cols.get(name) as any;
  }
}

// Returns { db, cleanup }. Live mode (MONGO_URI set) runs against a throwaway
// database that is dropped before and after; else the in-memory shim.
export async function getTestDb(dbNameFallback: string) {
  if (process.env.MONGO_URI) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const dbName = process.env.MONGO_DB || dbNameFallback;
    await client.db(dbName).dropDatabase();
    console.log(`(live MongoDB → ${dbName})`);
    return {
      db: client.db(dbName),
      cleanup: async () => { try { await client.db(dbName).dropDatabase(); } catch {} await client.close(); },
    };
  }
  console.log("(in-memory Mongo shim)");
  return { db: new FakeDb() as any, cleanup: async () => {} };
}

export { ObjectId };
