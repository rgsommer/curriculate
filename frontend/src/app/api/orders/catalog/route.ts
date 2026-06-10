// GET  -> active catalog { items, source, updatedAt }  (public; the order page needs it)
// POST { session, dataB64, filename } -> finance uploads a CSV/XLSX to replace the
//        catalog for a new year. Parsed with SheetJS; flexible column headers.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { sessionEmail } from "../_auth";
import { getConfig, isFinanceEmail } from "../_db";
import { getActiveCatalog, saveCatalog } from "../_catalog-store";

export const runtime = "nodejs";

export async function GET() {
  const c = await getActiveCatalog();
  return NextResponse.json({ items: c.items, source: c.source, updatedAt: c.updatedAt });
}

// Map a row's loosely-named headers to our fields.
function pick(row: Record<string, any>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keys.includes(norm)) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = sessionEmail(body.session);
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const cfg = await getConfig();
  if (!isFinanceEmail(email, cfg)) {
    return NextResponse.json(
      { error: `Only a finance account can update the catalog.` },
      { status: 403 }
    );
  }

  const dataB64 = String(body.dataB64 || "");
  if (!dataB64) return NextResponse.json({ error: "No file received." }, { status: 400 });

  let rows: Array<Record<string, any>>;
  try {
    const buf = Buffer.from(dataB64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch {
    return NextResponse.json({ error: "Could not read that file. Use a .csv or .xlsx export." }, { status: 400 });
  }

  const items: Array<{ supplier: string; po: string; category: string; sku: string; description: string; uom: string; price: number }> = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const supplier = pick(row, ["supplier", "vendor"]);
    const po = pick(row, ["po", "blanketpo", "ponumber", "purchaseorder"]);
    const category = pick(row, ["category", "section"]);
    const sku = pick(row, ["sku", "ewaysku", "product", "productno", "productnumber", "itemnumber", "code"]);
    const description = pick(row, ["description", "item", "itemdescription", "name"]);
    const uom = pick(row, ["uom", "unitofmeasure", "unit", "pack"]);
    const priceStr = pick(row, ["price", "unitprice", "cost"]).replace(/[$,]/g, "");
    const price = Number(priceStr);

    if (!sku || !description || !Number.isFinite(price)) {
      if (sku || description) skipped.push(sku || description);
      continue;
    }
    items.push({
      supplier: supplier || "Catalog",
      po,
      category: category || "OTHER",
      sku,
      description,
      uom: uom || "EACH",
      price: Math.round(price * 100) / 100,
    });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found. Expected columns: supplier, po, category, sku, description, uom, price." },
      { status: 400 }
    );
  }

  const res = await saveCatalog(items, email);
  return NextResponse.json({
    ok: true,
    count: items.length,
    skipped: skipped.length,
    persisted: res.persisted,
  });
}
