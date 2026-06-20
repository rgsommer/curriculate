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

// TEMP (testing 2026-06-10): finance pointed at rsommer@bramptoncs.org so Richard
// can receive the finance emails + xlsx. Revert to emcbride@bramptoncs.org after.
export const DEFAULT_FINANCE_EMAIL = "rsommer@bramptoncs.org";
export const DEFAULT_FINANCE_NAME = "Richard Sommer";
export const DEFAULT_SCHOOL_NAME = "Brampton Christian School";

export type OrdersConfig = {
  financeEmail: string;
  financeName: string;
  // Optional second finance person: also an admin.
  financeEmail2: string;
  financeName2: string;
  // Per-person toggle: receive the order emails (admin access is independent of this).
  financeNotify: boolean;
  financeNotify2: boolean;
  schoolName: string;
  // Optional "orders due by" date (YYYY-MM-DD), shown to teachers; "" = none.
  dueDate: string;
};

export async function getConfig(): Promise<OrdersConfig> {
  const db = await getDb();
  const fallback: OrdersConfig = {
    financeEmail: process.env.ORDERS_FINANCE_EMAIL || DEFAULT_FINANCE_EMAIL,
    financeName: process.env.ORDERS_FINANCE_NAME || DEFAULT_FINANCE_NAME,
    financeEmail2: process.env.ORDERS_FINANCE_EMAIL2 || "",
    financeName2: process.env.ORDERS_FINANCE_NAME2 || "",
    financeNotify: true,
    financeNotify2: true,
    schoolName: process.env.ORDERS_SCHOOL_NAME || DEFAULT_SCHOOL_NAME,
    dueDate: "",
  };
  if (!db) return fallback;
  const doc = await db.collection("bcs_config").findOne({ _id: "main" as any });
  return {
    financeEmail: (doc?.financeEmail as string) || fallback.financeEmail,
    financeName: (doc?.financeName as string) || fallback.financeName,
    financeEmail2: (doc?.financeEmail2 as string) ?? fallback.financeEmail2,
    financeName2: (doc?.financeName2 as string) ?? fallback.financeName2,
    financeNotify: (doc?.financeNotify ?? fallback.financeNotify) as boolean,
    financeNotify2: (doc?.financeNotify2 ?? fallback.financeNotify2) as boolean,
    schoolName: (doc?.schoolName as string) || fallback.schoolName,
    dueDate: (doc?.dueDate as string) ?? fallback.dueDate,
  };
}

// Normalised list of finance/admin emails (primary + optional second).
export function financeEmails(cfg: OrdersConfig): string[] {
  return [cfg.financeEmail, cfg.financeEmail2]
    .filter(Boolean)
    .map((e) => String(e).trim().toLowerCase());
}

// True when an email belongs to a finance/admin account.
export function isFinanceEmail(email: string, cfg: OrdersConfig): boolean {
  return financeEmails(cfg).includes(String(email || "").trim().toLowerCase());
}

// Order-email recipients formatted as "Name <email>" — only finance people whose
// "receive emails" box is checked. Admin access is separate (see isFinanceEmail).
export function financeRecipients(cfg: OrdersConfig): string[] {
  const out: string[] = [];
  if (cfg.financeEmail && cfg.financeNotify) out.push(cfg.financeName ? `${cfg.financeName} <${cfg.financeEmail}>` : cfg.financeEmail);
  if (cfg.financeEmail2 && cfg.financeNotify2) out.push(cfg.financeName2 ? `${cfg.financeName2} <${cfg.financeEmail2}>` : cfg.financeEmail2);
  return out;
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
