// Cached MongoDB client for the /orders feature, mirroring the pattern in
// frontend/src/app/api/contact/route.ts. Collections used (schemaless, no migration):
//   bcs_orders  — one document per submitted teacher order
//   bcs_config  — single config document (key: "main") with the finance email etc.
//
// MONGODB_URI lives only on the server/Vercel, so getDb() returns null locally and
// callers degrade gracefully (and `next build` never touches a live connection).

import { MongoClient, Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _ordersMongoClientPromise: Promise<MongoClient> | undefined;
}

function clientPromise(): Promise<MongoClient> | null {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!global._ordersMongoClientPromise) {
    global._ordersMongoClientPromise = new MongoClient(uri).connect();
  }
  return global._ordersMongoClientPromise;
}

export async function getDb(): Promise<Db | null> {
  const p = clientPromise();
  if (!p) return null;
  const client = await p;
  // Default DB from the connection string, or fall back to a named one.
  return client.db(process.env.MONGODB_DB || undefined);
}

export const DEFAULT_FINANCE_EMAIL = "emcbride@bramptoncs.org";
export const DEFAULT_FINANCE_NAME = "Evelyn McBride";
export const DEFAULT_SCHOOL_NAME = "Brampton Christian School";

export type OrdersConfig = {
  financeEmail: string;
  financeName: string;
  schoolName: string;
};

export async function getConfig(): Promise<OrdersConfig> {
  const db = await getDb();
  const fallback: OrdersConfig = {
    financeEmail: process.env.ORDERS_FINANCE_EMAIL || DEFAULT_FINANCE_EMAIL,
    financeName: process.env.ORDERS_FINANCE_NAME || DEFAULT_FINANCE_NAME,
    schoolName: process.env.ORDERS_SCHOOL_NAME || DEFAULT_SCHOOL_NAME,
  };
  if (!db) return fallback;
  const doc = await db.collection("bcs_config").findOne({ _id: "main" as any });
  return {
    financeEmail: (doc?.financeEmail as string) || fallback.financeEmail,
    financeName: (doc?.financeName as string) || fallback.financeName,
    schoolName: (doc?.schoolName as string) || fallback.schoolName,
  };
}

export async function saveConfig(patch: Partial<OrdersConfig>): Promise<OrdersConfig> {
  const db = await getDb();
  const current = await getConfig();
  const next: OrdersConfig = { ...current, ...patch };
  if (db) {
    await db
      .collection("bcs_config")
      .updateOne({ _id: "main" as any }, { $set: { ...next, updatedAt: new Date() } }, { upsert: true });
  }
  return next;
}
