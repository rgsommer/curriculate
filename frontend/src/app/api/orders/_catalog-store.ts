// Active catalog resolver. The bundled catalog (orders/_catalog.ts) is the
// baseline; finance can override it for a new year by uploading a CSV/XLSX, which
// is stored in the `bcs_catalog` collection. getActiveCatalog() returns whichever
// is current, with stable ids + lookup maps used by submit + the public catalog API.

import { getDb } from "./_db";
import { CATALOG as BUNDLED, CatalogItem } from "../../orders/_catalog";

export type ActiveCatalog = {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
  bySku: Map<string, CatalogItem>;
  source: "uploaded" | "bundled";
  updatedAt: string | null;
};

// Ids are positional ("I1"..) so the order page and submit agree as long as both
// read the same source/order. SKU is also kept for a fallback match.
function withIds(rows: Omit<CatalogItem, "id">[]): CatalogItem[] {
  return rows.map((r, i) => ({ id: "I" + (i + 1), ...r }));
}

function buildMaps(items: CatalogItem[]): Pick<ActiveCatalog, "byId" | "bySku"> {
  const byId = new Map<string, CatalogItem>();
  const bySku = new Map<string, CatalogItem>();
  for (const it of items) {
    byId.set(it.id, it);
    if (!bySku.has(it.sku)) bySku.set(it.sku, it);
  }
  return { byId, bySku };
}

export async function getActiveCatalog(): Promise<ActiveCatalog> {
  const db = await getDb();
  if (db) {
    const doc = await db.collection("bcs_catalog").findOne({ _id: "main" as any });
    const rows = Array.isArray(doc?.items) ? (doc!.items as Omit<CatalogItem, "id">[]) : null;
    if (rows && rows.length > 0) {
      const items = withIds(rows);
      return {
        items,
        ...buildMaps(items),
        source: "uploaded",
        updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
      };
    }
  }
  return { items: BUNDLED, ...buildMaps(BUNDLED), source: "bundled", updatedAt: null };
}

// Persist an uploaded catalog (already parsed + validated into rows).
export async function saveCatalog(
  rows: Omit<CatalogItem, "id">[],
  updatedBy: string
): Promise<{ ok: boolean; count: number; persisted: boolean }> {
  const db = await getDb();
  if (!db) return { ok: true, count: rows.length, persisted: false };
  await db.collection("bcs_catalog").updateOne(
    { _id: "main" as any },
    { $set: { items: rows, updatedBy, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ok: true, count: rows.length, persisted: true };
}
